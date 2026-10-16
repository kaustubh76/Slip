import { randomUUID } from "node:crypto";
import {
  agentId,
  ConflictError,
  type Cursor,
  DEFAULT_POLICY,
  type DecidedCursor,
  HoldAlreadyDecidedError,
  HoldExpiredError,
  HoldNotReadyError,
  IllegalTransitionError,
  InvariantError,
  LeaseLostError,
  MandateNotActiveError,
  mandateId,
  NotFoundError,
  ownerId,
  PolicyChangedError,
  policyVersion,
  type StaleCursor,
  type Store,
  stampToken,
} from "@slip/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Conflict } from "../codes.js";
import {
  at,
  authorize,
  capture,
  decided,
  followUpFor,
  markets,
  NOW,
  newAttemptId,
  newProductId,
  newRequestId,
  offer,
  record,
  recordInput,
  type World,
  world,
} from "./fixtures.js";

export interface Harness {
  store: Store;
  close(): Promise<void>;
}

async function expectConflict(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConflictError);
  expect((error as ConflictError).code).toBe(code);
}

/**
 * The behaviour every `Store` must have. Run against the in-memory fake, PGlite and real
 * Postgres; a difference between them is a bug in one of them.
 */
export function describeStoreContract(label: string, make: () => Promise<Harness>): void {
  describe(`Store contract · ${label}`, () => {
    let harness: Harness;
    let store: Store;

    beforeAll(async () => {
      harness = await make();
      store = harness.store;
    });
    afterAll(async () => {
      await harness.close();
    });

    describe("owners", () => {
      it("round-trips and refuses duplicates", async () => {
        const id = ownerId(randomUUID());
        const email = `${randomUUID()}@example.com`;
        const owner = await store.owners.create({ id, email, now: NOW });
        expect(owner).toEqual({ id, email, createdAt: NOW });
        expect(await store.owners.get(id)).toEqual(owner);
        expect(await store.owners.get(ownerId(randomUUID()))).toBeNull();
        await expectConflict(
          store.owners.create({ id, email: null, now: NOW }),
          Conflict.OWNER_EXISTS,
        );
        await expectConflict(
          store.owners.create({ id: ownerId(randomUUID()), email, now: NOW }),
          Conflict.EMAIL_IN_USE,
        );
      });
    });

    describe("mandates", () => {
      it("starts PENDING with policy v1 from the limits", async () => {
        const owner = ownerId(randomUUID());
        await store.owners.create({ id: owner, email: null, now: NOW });
        const id = mandateId(randomUUID());
        const { version: _v, ...limits } = DEFAULT_POLICY;
        const { mandate, policy } = await store.mandates.create({
          id,
          ownerId: owner,
          limits,
          now: NOW,
        });
        expect(mandate).toMatchObject({ id, ownerId: owner, status: "PENDING", hasVaultId: false });
        expect(policy).toEqual(DEFAULT_POLICY);
        expect(await store.mandates.currentPolicy(id)).toEqual(DEFAULT_POLICY);
        expect(await store.mandates.vaultIdForCharge(id)).toBeNull();
      });

      it("refuses an unknown owner and invalid limits", async () => {
        const { version: _v, ...limits } = DEFAULT_POLICY;
        await expect(
          store.mandates.create({
            id: mandateId(randomUUID()),
            ownerId: ownerId(randomUUID()),
            limits,
            now: NOW,
          }),
        ).rejects.toBeInstanceOf(InvariantError);
        const owner = ownerId(randomUUID());
        await store.owners.create({ id: owner, email: null, now: NOW });
        await expect(
          store.mandates.create({
            id: mandateId(randomUUID()),
            ownerId: owner,
            limits: { ...limits, orderCapCents: -1 as never },
            now: NOW,
          }),
        ).rejects.toBeInstanceOf(InvariantError);
      });

      it("activates once; the vault id comes back only while ACTIVE", async () => {
        const w = await world(store, { activate: false });
        const first = await store.mandates.activate(
          w.mandateId,
          { vaultId: w.vaultId, paypalCustomerId: "C1" },
          at(1),
        );
        expect(first.result).toBe("applied");
        expect(first.value).toMatchObject({
          status: "ACTIVE",
          hasVaultId: true,
          activatedAt: at(1),
          paypalCustomerId: "C1",
        });
        expect(await store.mandates.vaultIdForCharge(w.mandateId)).toBe(w.vaultId);
        expect(await store.mandates.findByVaultId(w.vaultId)).toEqual(first.value);
        expect(await store.mandates.findByVaultId("VAULT-unknown")).toBeNull();

        const again = await store.mandates.activate(
          w.mandateId,
          { vaultId: w.vaultId, paypalCustomerId: "C1" },
          at(2),
        );
        expect(again.result).toBe("unchanged");
        expect(again.value.activatedAt).toEqual(at(1));
        await expectConflict(
          store.mandates.activate(
            w.mandateId,
            { vaultId: "VAULT-other", paypalCustomerId: null },
            at(3),
          ),
          Conflict.MANDATE_VAULT_SET,
        );

        const other = await world(store, { activate: false });
        await expectConflict(
          store.mandates.activate(
            other.mandateId,
            { vaultId: w.vaultId, paypalCustomerId: null },
            at(3),
          ),
          Conflict.VAULT_ID_IN_USE,
        );
      });

      it("revoke is the kill switch: idempotent, and a late activation is ignored", async () => {
        const w = await world(store);
        const revoked = await store.mandates.revoke(w.mandateId, at(5));
        expect(revoked).toMatchObject({
          result: "applied",
          value: { status: "REVOKED", revokedAt: at(5) },
        });
        expect(await store.mandates.vaultIdForCharge(w.mandateId)).toBeNull();
        expect((await store.mandates.revoke(w.mandateId, at(6))).result).toBe("unchanged");
        const late = await store.mandates.activate(
          w.mandateId,
          { vaultId: w.vaultId, paypalCustomerId: null },
          at(7),
        );
        expect(late.result).toBe("stale");
        expect(late.value.status).toBe("REVOKED");
      });

      it("after a revoke the vault id is available for deletion until PayPal confirms it", async () => {
        const w = await world(store);
        expect(await store.mandates.vaultIdForDeletion(w.mandateId)).toBeNull();
        await expect(store.mandates.markVaultDeleted(w.mandateId, at(1))).rejects.toBeInstanceOf(
          InvariantError,
        );
        await store.mandates.revoke(w.mandateId, at(2));
        expect(await store.mandates.vaultIdForCharge(w.mandateId)).toBeNull();
        expect(await store.mandates.vaultIdForDeletion(w.mandateId)).toBe(w.vaultId);
        const awaiting = async () =>
          (await store.mandates.listAwaitingVaultDeletion(1000)).map((m) => m.id);
        expect(await awaiting()).toContain(w.mandateId);

        const marked = await store.mandates.markVaultDeleted(w.mandateId, at(3));
        expect(marked.result).toBe("applied");
        expect(marked.value.vaultDeletedAt).toEqual(at(3));
        expect(await store.mandates.vaultIdForDeletion(w.mandateId)).toBeNull();
        expect(await awaiting()).not.toContain(w.mandateId);
        const again = await store.mandates.markVaultDeleted(w.mandateId, at(4));
        expect(again.result).toBe("unchanged");
        expect(again.value.vaultDeletedAt).toEqual(at(3));
      });

      it("a mandate revoked before it was vaulted has nothing to delete", async () => {
        const w = await world(store, { activate: false });
        await store.mandates.revoke(w.mandateId, at(1));
        expect(await store.mandates.vaultIdForDeletion(w.mandateId)).toBeNull();
        expect(
          (await store.mandates.listAwaitingVaultDeletion(1000)).map((m) => m.id),
        ).not.toContain(w.mandateId);
        await expect(store.mandates.markVaultDeleted(w.mandateId, at(2))).rejects.toBeInstanceOf(
          InvariantError,
        );
      });

      it("an edit based on a version that has moved is refused, and nothing is written", async () => {
        const w = await world(store);
        const first = await store.mandates.updatePolicy(
          w.mandateId,
          { orderCapCents: 30_000 as never },
          at(1),
          { basedOnVersion: policyVersion(1) },
        );
        expect(first.version).toBe(2);
        // A second page still showing version 1 cannot overwrite version 2.
        await expect(
          store.mandates.updatePolicy(w.mandateId, { orderCapCents: 1_000 as never }, at(2), {
            basedOnVersion: policyVersion(1),
          }),
        ).rejects.toBeInstanceOf(PolicyChangedError);
        const current = await store.mandates.currentPolicy(w.mandateId);
        expect(current).toMatchObject({ version: 2, orderCapCents: 30_000 });
        // Based on what is actually in force, it goes through.
        const third = await store.mandates.updatePolicy(
          w.mandateId,
          { orderCapCents: 1_000 as never },
          at(3),
          { basedOnVersion: policyVersion(2) },
        );
        expect(third.version).toBe(3);
        // With no version given, the last writer still wins, as every other caller expects.
        expect(
          (await store.mandates.updatePolicy(w.mandateId, { orderCapCents: 2_000 as never }, at(4)))
            .version,
        ).toBe(4);
      });

      it("listPendingSetup finds mandates still waiting for PayPal setup", async () => {
        const waiting = await world(store, { activate: false });
        const noReference = await world(store, { activate: false });
        const done = await world(store, { activate: false });
        await store.mandates.attachSetupOrder(waiting.mandateId, `SETUP-${randomUUID()}`, NOW);
        await store.mandates.attachSetupOrder(done.mandateId, `SETUP-${randomUUID()}`, NOW);
        await store.mandates.activate(
          done.mandateId,
          { vaultId: done.vaultId, paypalCustomerId: null },
          at(1),
        );
        const ids = (await store.mandates.listPendingSetup(at(1), { limit: 1000 })).map(
          (m) => m.id,
        );
        expect(ids).toContain(waiting.mandateId);
        expect(ids).not.toContain(noReference.mandateId);
        expect(ids).not.toContain(done.mandateId);
        expect(
          (await store.mandates.listPendingSetup(NOW, { limit: 1000 })).map((m) => m.id),
        ).not.toContain(waiting.mandateId);
      });

      it("listPendingSetup pages by cursor: each waiting mandate once, ties broken by id", async () => {
        const mine: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          const w = await world(store, { activate: false });
          await store.mandates.attachSetupOrder(w.mandateId, `SETUP-${randomUUID()}`, NOW);
          mine.push(w.mandateId);
        }
        const seen: string[] = [];
        let after: Cursor | undefined;
        for (;;) {
          const page = await store.mandates.listPendingSetup(at(1), {
            limit: 2,
            ...(after === undefined ? {} : { after }),
          });
          const last = page.at(-1);
          if (last === undefined) {
            break;
          }
          seen.push(...page.map((m) => m.id));
          after = { createdAt: last.createdAt, id: last.id };
        }
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen.filter((id) => mine.includes(id))).toEqual([...mine].sort());
      });

      it("attaches the setup order once", async () => {
        const w = await world(store, { activate: false });
        const order = `ORDER-SETUP-${randomUUID()}`;
        expect((await store.mandates.attachSetupOrder(w.mandateId, order, NOW)).setupOrderId).toBe(
          order,
        );
        expect((await store.mandates.attachSetupOrder(w.mandateId, order, NOW)).setupOrderId).toBe(
          order,
        );
        expect((await store.mandates.findBySetupOrderId(order))?.id).toBe(w.mandateId);
        await expectConflict(
          store.mandates.attachSetupOrder(w.mandateId, "ORDER-OTHER", NOW),
          Conflict.SETUP_ORDER_SET,
        );
        const other = await world(store, { activate: false });
        await expectConflict(
          store.mandates.attachSetupOrder(other.mandateId, order, NOW),
          Conflict.SETUP_ORDER_IN_USE,
        );
        const active = await world(store);
        await expectConflict(
          store.mandates.attachSetupOrder(active.mandateId, `ORDER-${randomUUID()}`, NOW),
          Conflict.MANDATE_NOT_PENDING,
        );
      });

      it("policy edits append versions; old versions stay readable", async () => {
        const w = await world(store);
        const v2 = await store.mandates.updatePolicy(
          w.mandateId,
          { maxOverpayPctHundredths: 750 as never },
          at(1),
        );
        const v3 = await store.mandates.updatePolicy(
          w.mandateId,
          { orderCapCents: 50_000 as never },
          at(2),
        );
        expect(v2).toEqual({ ...DEFAULT_POLICY, version: 2, maxOverpayPctHundredths: 750 });
        expect(v3).toEqual({
          ...DEFAULT_POLICY,
          version: 3,
          maxOverpayPctHundredths: 750,
          orderCapCents: 50_000,
        });
        expect(await store.mandates.currentPolicy(w.mandateId)).toEqual(v3);
        expect(await store.mandates.policy(w.mandateId, 1 as never)).toEqual(DEFAULT_POLICY);
        expect(await store.mandates.policy(w.mandateId, 9 as never)).toBeNull();
        await expect(
          store.mandates.updatePolicy(w.mandateId, { flagPctHundredths: -5 as never }, at(3)),
        ).rejects.toBeInstanceOf(InvariantError);
        await store.mandates.revoke(w.mandateId, at(4));
        await expect(store.mandates.updatePolicy(w.mandateId, {}, at(5))).rejects.toBeInstanceOf(
          MandateNotActiveError,
        );
      });

      it("acting on an unknown mandate is NotFound", async () => {
        const id = mandateId(randomUUID());
        expect(await store.mandates.get(id)).toBeNull();
        await expect(store.mandates.revoke(id, NOW)).rejects.toBeInstanceOf(NotFoundError);
        await expect(
          store.mandates.activate(id, { vaultId: "V", paypalCustomerId: null }, NOW),
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(store.mandates.currentPolicy(id)).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe("agents", () => {
      it("authenticates by key hash with the mandate and current policy", async () => {
        const w = await world(store);
        const auth = await store.agents.authenticate(w.apiKeyHash);
        expect(auth?.agent).toMatchObject({
          id: w.agentId,
          mandateId: w.mandateId,
          apiKeyPrefix: "slip_te",
          revokedAt: null,
        });
        expect(auth?.mandate.status).toBe("ACTIVE");
        expect(auth?.policy).toEqual(DEFAULT_POLICY);
        expect(await store.agents.authenticate("hash-unknown")).toBeNull();
        expect(await store.agents.get(w.agentId)).toEqual(auth?.agent);
      });

      it("returns a revoked mandate as-is so the caller can say why it refuses", async () => {
        const w = await world(store);
        await store.mandates.revoke(w.mandateId, at(1));
        expect((await store.agents.authenticate(w.apiKeyHash))?.mandate.status).toBe("REVOKED");
      });

      it("a revoked agent no longer authenticates; revoking twice is unchanged", async () => {
        const w = await world(store);
        expect((await store.agents.revoke(w.agentId, at(1))).result).toBe("applied");
        expect((await store.agents.revoke(w.agentId, at(2))).result).toBe("unchanged");
        expect(await store.agents.authenticate(w.apiKeyHash)).toBeNull();
        await expect(store.agents.revoke(agentId(randomUUID()), NOW)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it("refuses a reused key and an unknown mandate; lists by mandate in creation order", async () => {
        const w = await world(store);
        await expectConflict(
          store.agents.create({
            id: agentId(randomUUID()),
            mandateId: w.mandateId,
            name: "copy",
            apiKeyHash: w.apiKeyHash,
            apiKeyPrefix: "x",
            now: NOW,
          }),
          Conflict.API_KEY_IN_USE,
        );
        await expect(
          store.agents.create({
            id: agentId(randomUUID()),
            mandateId: mandateId(randomUUID()),
            name: "orphan",
            apiKeyHash: `hash-${randomUUID()}`,
            apiKeyPrefix: "x",
            now: NOW,
          }),
        ).rejects.toBeInstanceOf(InvariantError);
        const second = agentId(randomUUID());
        await store.agents.create({
          id: second,
          mandateId: w.mandateId,
          name: "second",
          apiKeyHash: `hash-${randomUUID()}`,
          apiKeyPrefix: "slip_2",
          now: at(1),
        });
        expect((await store.agents.listByMandate(w.mandateId)).map((a) => a.id)).toEqual([
          w.agentId,
          second,
        ]);
      });
    });

    describe("snapshots", () => {
      it("round-trips the snapshot and its raw response; refuses a duplicate", async () => {
        const w = await world(store);
        const productId = newProductId();
        const attempt = await decided(store, w, { ...markets.paid(), productId });
        const id = attempt.decision.checkResult.snapshotId;
        if (id === null) {
          throw new Error("expected a snapshot id");
        }
        const stored = await store.snapshots.get(id);
        expect(stored?.productId).toBe(productId);
        expect(stored?.fetchedAt).toEqual(NOW);
        expect(await store.snapshots.getRaw(id)).toEqual({ raw: { source: "test", productId } });
        if (stored !== null) {
          await expectConflict(store.snapshots.save(stored, null), Conflict.SNAPSHOT_EXISTS);
        }
      });

      it("latestForProduct is the newest", async () => {
        const w = await world(store);
        const productId = newProductId();
        await decided(store, w, { ...markets.paid(), productId, now: at(1) });
        const newer = await decided(store, w, { ...markets.paid(), productId, now: at(5) });
        expect((await store.snapshots.latestForProduct(productId))?.id).toBe(
          newer.decision.checkResult.snapshotId,
        );
        expect(await store.snapshots.latestForProduct("prod-none")).toBeNull();
      });
    });

    describe("attempts.record", () => {
      it("REJECTED: decision only, no payment, no vault id", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.overpaid());
        const { receipt, vaultId } = await record(store, attempt);
        expect(receipt).toEqual({ attempt, payment: null, hold: null });
        expect(vaultId).toBeNull();
        expect(await store.attempts.get(attempt.id)).toEqual(receipt);
      });

      it("PAID: write-ahead payment priced from the snapshot, ORDER request id, vault id returned", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        const requestId = newRequestId();
        const { receipt, vaultId } = await record(store, attempt, {
          payment: { intent: "CAPTURE", requestId },
        });
        expect(vaultId).toBe(w.vaultId);
        expect(receipt.payment).toMatchObject({
          attemptId: attempt.id,
          status: "INITIATED",
          intent: "CAPTURE",
          amountCents: 4799,
          currency: "USD",
          operations: [{ kind: "ORDER", requestId, createdAt: NOW }],
        });
        expect(receipt.hold).toBeNull();
        expect(await store.attempts.get(attempt.id)).toEqual(receipt);
        expect(await store.payments.events(attempt.id)).toEqual([
          {
            attemptId: attempt.id,
            fromStatus: "NONE",
            toStatus: "INITIATED",
            detail: { requestId },
            at: NOW,
          },
        ]);
        expect(await store.payments.findByRequestId(requestId)).toEqual(receipt.payment);
      });

      it("HELD with an order: AUTHORIZE payment and a PENDING hold", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.aboveCap());
        const { receipt, vaultId } = await record(store, attempt, { holdExpiresAt: at(60) });
        expect(attempt.decision.ruleCode).toBe("R6_ABOVE_ORDER_CAP");
        expect(vaultId).toBe(w.vaultId);
        expect(receipt.payment).toMatchObject({
          intent: "AUTHORIZE",
          status: "INITIATED",
          amountCents: 25000,
        });
        expect(receipt.hold).toEqual({
          attemptId: attempt.id,
          status: "PENDING",
          createdAt: NOW,
          expiresAt: at(60),
          decidedAt: null,
          decidedBy: null,
        });
      });

      it("HELD without an order: hold only, no vault id", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.conflict());
        const { receipt, vaultId } = await record(store, attempt, { withOrder: false });
        expect(receipt.payment).toBeNull();
        expect(receipt.hold?.status).toBe("PENDING");
        expect(vaultId).toBeNull();
      });

      it.each([
        ["no lease at all", { takeLease: false }],
        ["a lease held by someone else", "other"],
        ["an expired lease", "expired"],
      ] as const)("refuses with %s and writes nothing", async (_label, mode) => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        const key = { agentId: w.agentId, productId: attempt.productId };
        let promise: Promise<unknown>;
        if (mode === "other") {
          await store.leases.acquire(key, "someone-else", 60_000, NOW);
          promise = store.attempts.record(recordInput(attempt, "me"));
        } else if (mode === "expired") {
          await store.leases.acquire(key, "me", 60_000, at(-2));
          promise = store.attempts.record(recordInput(attempt, "me"));
        } else {
          promise = store.attempts.record(recordInput(attempt, "me"));
        }
        await expect(promise).rejects.toBeInstanceOf(LeaseLostError);
        expect(await store.attempts.get(attempt.id)).toBeNull();
        expect(await store.payments.get(attempt.id)).toBeNull();
      });

      it("refuses once the mandate is revoked, and writes nothing", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        await store.mandates.revoke(w.mandateId, NOW);
        await expect(record(store, attempt)).rejects.toBeInstanceOf(MandateNotActiveError);
        expect(await store.attempts.get(attempt.id)).toBeNull();
      });

      it("refuses a decision checked under an older policy", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        await store.mandates.updatePolicy(w.mandateId, { orderCapCents: 30_000 as never }, NOW);
        await expect(record(store, attempt)).rejects.toBeInstanceOf(PolicyChangedError);
      });

      it("refuses a revoked agent", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        await store.agents.revoke(w.agentId, NOW);
        await expectConflict(record(store, attempt), Conflict.AGENT_REVOKED);
      });

      it("refuses a duplicate attempt id without touching the first", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.overpaid());
        const first = await record(store, attempt);
        await expectConflict(record(store, attempt), Conflict.ATTEMPT_EXISTS);
        expect(await store.attempts.get(attempt.id)).toEqual(first.receipt);
      });

      it("refuses a decision whose snapshot was never stored", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, { ...markets.paid(), saveSnapshot: false });
        await expect(record(store, attempt)).rejects.toBeInstanceOf(InvariantError);
        expect(await store.attempts.get(attempt.id)).toBeNull();
      });

      it("refuses a second in-flight payment for the same agent and product, atomically", async () => {
        const w = await world(store);
        const productId = newProductId();
        const first = await decided(store, w, { ...markets.paid(), productId });
        await record(store, first);
        const second = await decided(store, w, { ...markets.paid(), productId, now: at(1) });
        await expectConflict(record(store, second), Conflict.PAYMENT_IN_FLIGHT);
        expect(await store.attempts.get(second.id)).toBeNull();

        // Once the first payment is final, the next one may go.
        await capture(store, first.id);
        const third = await decided(store, w, { ...markets.paid(), productId, now: at(2) });
        expect((await record(store, third)).receipt.payment?.status).toBe("INITIATED");
      });

      it("refuses a reused PayPal-Request-Id and writes nothing", async () => {
        const w = await world(store);
        const requestId = newRequestId();
        await record(store, await decided(store, w, markets.paid()), {
          payment: { intent: "CAPTURE", requestId },
        });
        const again = await decided(store, w, markets.paid());
        await expectConflict(
          record(store, again, { payment: { intent: "CAPTURE", requestId } }),
          Conflict.REQUEST_ID_IN_USE,
        );
        expect(await store.attempts.get(again.id)).toBeNull();
      });

      it("refuses inputs that break the record invariants", async () => {
        const w = await world(store);
        const rejected = await decided(store, w, markets.overpaid());
        await expect(
          record(store, rejected, { payment: { intent: "CAPTURE" } }),
        ).rejects.toBeInstanceOf(InvariantError);
        const paid = await decided(store, w, markets.paid());
        await expect(record(store, paid, { payment: null })).rejects.toBeInstanceOf(InvariantError);
      });

      it("an OWNER_APPROVAL attempt cannot be recorded on its own", async () => {
        const w = await world(store);
        const parent = await decided(store, w, markets.aboveCap());
        await record(store, parent, { withOrder: false });
        const followUp = await followUpFor(store, w, parent);
        await expect(store.attempts.record(followUp)).rejects.toBeInstanceOf(InvariantError);
        expect(await store.attempts.findChild(parent.id)).toBeNull();
      });
    });

    describe("attempts listing", () => {
      it("listRecent: this agent and product, inside the window, newest first", async () => {
        const w = await world(store);
        const productId = newProductId();
        const old = await decided(store, w, { ...markets.overpaid(), productId, now: at(-30) });
        const a = await decided(store, w, { ...markets.overpaid(), productId, now: at(1) });
        const b = await decided(store, w, { ...markets.overpaid(), productId, now: at(2) });
        const elsewhere = await decided(store, w, { ...markets.overpaid(), now: at(2) });
        for (const attempt of [old, a, b, elsewhere]) {
          await record(store, attempt);
        }
        const recent = await store.attempts.listRecent(w.agentId, productId, at(-10));
        expect(recent.map((r) => r.attempt.id)).toEqual([b.id, a.id]);
      });

      it("pages newest first with no skips or repeats, even with equal timestamps", async () => {
        const w = await world(store);
        const ids: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          const attempt = await decided(store, w, {
            ...markets.overpaid(),
            now: at(i < 3 ? 1 : 2),
          });
          await record(store, attempt);
          ids.push(attempt.id);
        }
        const seen: string[] = [];
        let before: { createdAt: Date; id: string } | undefined;
        for (;;) {
          const page = await store.attempts.listByAgent(w.agentId, {
            limit: 2,
            ...(before === undefined ? {} : { before }),
          });
          seen.push(...page.items.map((r) => r.attempt.id));
          if (page.next === null) {
            break;
          }
          before = page.next;
        }
        expect(seen).toHaveLength(5);
        expect(new Set(seen).size).toBe(5);
        expect([...seen].sort()).toEqual([...ids].sort());
        const byMandate = await store.attempts.listByMandate(w.mandateId, { limit: 10 });
        expect(byMandate.items.map((r) => r.attempt.id)).toEqual(seen);
        expect(byMandate.next).toBeNull();
        await expect(store.attempts.listByAgent(w.agentId, { limit: 0 })).rejects.toBeInstanceOf(
          InvariantError,
        );
      });
    });

    describe("payments.transition", () => {
      it("applies, repeats as unchanged, ignores a late report, and refuses a contradiction", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        await record(store, attempt);

        const captured = await capture(store, attempt.id, at(1));
        expect(captured.result).toBe("applied");
        expect(captured.value).toMatchObject({
          status: "CAPTURED",
          captureId: `CAP-${attempt.id}`,
          updatedAt: at(1),
        });
        expect(await store.payments.get(attempt.id)).toEqual(captured.value);

        const repeat = await capture(store, attempt.id, at(2));
        expect(repeat.result).toBe("unchanged");
        expect(repeat.value.updatedAt).toEqual(at(1));

        const late = await store.payments.transition(attempt.id, "PENDING", { now: at(3) });
        expect(late.result).toBe("stale");
        expect(late.value.status).toBe("CAPTURED");

        await expect(
          store.payments.transition(attempt.id, "FAILED", {
            patch: { failureReason: "x" },
            now: at(4),
          }),
        ).rejects.toBeInstanceOf(IllegalTransitionError);

        const history = await store.payments.events(attempt.id);
        expect(history.map((e) => `${e.fromStatus}→${e.toStatus}`)).toEqual([
          "NONE→INITIATED",
          "INITIATED→CAPTURED",
        ]);
        expect(await store.payments.findByPaypalOrderId(`ORDER-${attempt.id}`)).toEqual(
          captured.value,
        );
      });

      it("refuses missing PayPal ids and changing a set one", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        await record(store, attempt);
        await expect(
          store.payments.transition(attempt.id, "CAPTURED", { now: at(1) }),
        ).rejects.toBeInstanceOf(InvariantError);
        await store.payments.transition(attempt.id, "PENDING", {
          patch: { paypalOrderId: "ORDER-A" },
          now: at(1),
        });
        await expectConflict(
          store.payments.transition(attempt.id, "CAPTURED", {
            patch: { paypalOrderId: "ORDER-B", captureId: "CAP-B" },
            now: at(2),
          }),
          Conflict.PAYMENT_FIELD_SET,
        );
        expect((await store.payments.get(attempt.id))?.status).toBe("PENDING");
      });

      it("refuses a PayPal id that belongs to another payment", async () => {
        const w = await world(store);
        const one = await decided(store, w, markets.paid());
        const two = await decided(store, w, markets.paid());
        await record(store, one);
        await record(store, two);
        const shared = `ORDER-${randomUUID()}`;
        await store.payments.transition(one.id, "PENDING", {
          patch: { paypalOrderId: shared },
          now: at(1),
        });
        await expectConflict(
          store.payments.transition(two.id, "PENDING", {
            patch: { paypalOrderId: shared },
            now: at(1),
          }),
          Conflict.PAYPAL_ID_IN_USE,
        );
      });

      it("unknown payment is NotFound", async () => {
        await expect(
          store.payments.transition(newAttemptId(), "CAPTURED", { now: NOW }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(await store.payments.get(newAttemptId())).toBeNull();
      });

      it("listStale returns payments stuck in the asked statuses, least recently changed first", async () => {
        const w = await world(store);
        const stuck = await decided(store, w, { ...markets.paid(), now: at(-100) });
        const fresh = await decided(store, w, { ...markets.paid(), now: at(-1) });
        const done = await decided(store, w, { ...markets.paid(), now: at(-200) });
        await record(store, stuck);
        await record(store, fresh);
        await record(store, done);
        await store.payments.transition(stuck.id, "UNKNOWN", { now: at(-90) });
        await capture(store, done.id, at(-150));
        const stale = await store.payments.listStale(["INITIATED", "UNKNOWN"], at(-30), {
          limit: 1000,
        });
        const ids = stale.map((p) => p.attemptId);
        expect(ids).toContain(stuck.id);
        expect(ids).not.toContain(fresh.id);
        expect(ids).not.toContain(done.id);
        expect(stale.find((p) => p.attemptId === stuck.id)?.operations[0]?.kind).toBe("ORDER");
      });

      it("listStale pages by cursor: each stuck payment once, in order, ties broken by id", async () => {
        const w = await world(store);
        const mine: { id: string; at: number }[] = [];
        for (const minutes of [-300, -300, -300, -280, -260]) {
          const attempt = await decided(store, w, { ...markets.paid(), now: at(minutes) });
          await record(store, attempt);
          mine.push({ id: attempt.id, at: minutes });
        }
        const seen: string[] = [];
        let after: StaleCursor | undefined;
        for (;;) {
          const page = await store.payments.listStale(["INITIATED"], at(-30), {
            limit: 2,
            ...(after === undefined ? {} : { after }),
          });
          const last = page.at(-1);
          if (last === undefined) {
            break;
          }
          seen.push(...page.map((p) => p.attemptId));
          after = { updatedAt: last.updatedAt, attemptId: last.attemptId };
        }
        expect(new Set(seen).size).toBe(seen.length);
        const expected = [...mine]
          .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
          .map((m) => m.id);
        expect(seen.filter((id) => expected.includes(id))).toEqual(expected);
      });
    });

    describe("the change stamp", () => {
      /** Every write that matters moves it; nothing else does. */
      it("moves for each kind of write, and not for a no-op", async () => {
        const w = await world(store, { activate: false });
        const moves: string[] = [];
        let last = stampToken(await store.live.stamp(w.mandateId));
        const after = async (what: string, write: () => Promise<unknown>) => {
          await write();
          const now = stampToken(await store.live.stamp(w.mandateId));
          if (now !== last) {
            moves.push(what);
          }
          last = now;
        };
        const unmoved = async (what: string, write: () => Promise<unknown>) => {
          await write();
          const now = stampToken(await store.live.stamp(w.mandateId));
          expect(now, what).toBe(last);
        };

        await after("mandate activated", () =>
          store.mandates.activate(w.mandateId, { vaultId: w.vaultId, paypalCustomerId: null }, NOW),
        );
        await after("agent created", () =>
          store.agents.create({
            id: agentId(randomUUID()),
            mandateId: w.mandateId,
            name: "second",
            apiKeyHash: `hash-${randomUUID()}`,
            apiKeyPrefix: "slip_te",
            now: at(1),
          }),
        );
        const held = await decided(store, w, markets.aboveCap());
        await after("attempt recorded", () => record(store, held, { holdExpiresAt: at(60) }));
        await after("payment moved", () => authorize(store, held.id, at(2)));
        await after("hold decided", () =>
          store.holds.decline(held.id, { by: "owner", now: at(3), voidRequestId: newRequestId() }),
        );
        // A report of a status the payment has already passed writes nothing.
        await unmoved("stale payment report", () =>
          store.payments.transition(held.id, "AUTHORIZED", { now: at(4) }),
        );
        // Reading does not count as happening.
        await unmoved("reads", async () => {
          await store.attempts.get(held.id);
          await store.holds.listPending(w.mandateId);
        });
        await after("payment voided", () =>
          store.payments.transition(held.id, "VOIDED", { now: at(5) }),
        );
        // After the attempt, because an attempt checked under one version cannot be recorded
        // against another (the store refuses it, PolicyChangedError).
        await after("limits changed", () =>
          store.mandates.updatePolicy(w.mandateId, { orderCapCents: 30_000 as never }, at(6)),
        );
        await after("agent revoked", () => store.agents.revoke(w.agentId, at(6)));
        await after("mandate revoked", () => store.mandates.revoke(w.mandateId, at(7)));
        await after("vault deletion confirmed", () =>
          store.mandates.markVaultDeleted(w.mandateId, at(8)),
        );

        expect(moves).toEqual([
          "mandate activated",
          "agent created",
          "attempt recorded",
          "payment moved",
          "hold decided",
          "payment voided",
          "limits changed",
          "agent revoked",
          "mandate revoked",
          "vault deletion confirmed",
        ]);
      });

      it("a move that only records a PayPal id still moves it", async () => {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        await record(store, attempt);
        const before = stampToken(await store.live.stamp(w.mandateId));
        // Same status, but PayPal's order id is now known: no event is written, so the ids are
        // what notices.
        await store.payments.transition(attempt.id, "INITIATED", {
          patch: { paypalOrderId: `ORDER-${attempt.id}` },
          now: at(1),
        });
        expect(stampToken(await store.live.stamp(w.mandateId))).not.toBe(before);
      });

      it("only grows, and only for its own mandate", async () => {
        const mine = await world(store);
        const theirs = await world(store);
        const before = await store.live.stamp(mine.mandateId);
        const attempt = await decided(store, theirs, markets.paid());
        await record(store, attempt);
        await capture(store, attempt.id, at(1));
        expect(await store.live.stamp(mine.mandateId)).toEqual(before);

        const ours = await decided(store, mine, markets.paid());
        await record(store, ours);
        await capture(store, ours.id, at(1));
        const now = await store.live.stamp(mine.mandateId);
        for (const key of Object.keys(now) as (keyof typeof now)[]) {
          expect(now[key], key).toBeGreaterThanOrEqual(before[key]);
        }
        expect(now.attempts).toBe(before.attempts + 1);
      });

      it("an unknown mandate has a stamp of its own, all zeros but comparable", async () => {
        const stamp = await store.live.stamp(mandateId(randomUUID()));
        expect(stampToken(stamp)).toBe("0.0.0.0.0.0.0.0.0");
      });
    });

    describe("holds", () => {
      async function heldWithAuthorization(w: World, expiresAt = at(60)) {
        const attempt = await decided(store, w, markets.aboveCap());
        await record(store, attempt, { holdExpiresAt: expiresAt });
        return attempt;
      }

      it("approve with a confirmed authorization starts the capture atomically", async () => {
        const w = await world(store);
        const attempt = await heldWithAuthorization(w);
        await authorize(store, attempt.id);
        const captureRequestId = newRequestId();
        const decision = await store.holds.approve(attempt.id, {
          by: "owner@example.com",
          now: at(5),
          captureRequestId,
        });
        expect(decision.result).toBe("applied");
        expect(decision.hold).toMatchObject({
          status: "APPROVED",
          decidedAt: at(5),
          decidedBy: "owner@example.com",
        });
        expect(decision.payment?.status).toBe("CAPTURING");
        expect(decision.payment?.operations.map((op) => op.kind)).toEqual(["ORDER", "CAPTURE"]);
        expect((await store.payments.findByRequestId(captureRequestId))?.attemptId).toBe(
          attempt.id,
        );
        const again = await store.holds.approve(attempt.id, {
          by: "owner@example.com",
          now: at(6),
          captureRequestId: newRequestId(),
        });
        expect(again.result).toBe("unchanged");
        expect(again.payment?.operations).toHaveLength(2);
      });

      it("approve before the authorization is confirmed is not ready, and changes nothing", async () => {
        const w = await world(store);
        const attempt = await heldWithAuthorization(w);
        await expect(
          store.holds.approve(attempt.id, {
            by: "owner",
            now: at(5),
            captureRequestId: newRequestId(),
          }),
        ).rejects.toBeInstanceOf(HoldNotReadyError);
        expect((await store.holds.get(attempt.id))?.status).toBe("PENDING");
      });

      it("approve exactly at the expiry is too late", async () => {
        const w = await world(store);
        const attempt = await heldWithAuthorization(w, at(30));
        await authorize(store, attempt.id);
        await expect(
          store.holds.approve(attempt.id, {
            by: "owner",
            now: at(30),
            captureRequestId: newRequestId(),
          }),
        ).rejects.toBeInstanceOf(HoldExpiredError);
      });

      it("listDecided returns finished holds, newest decision first, and pages by cursor", async () => {
        const w = await world(store);
        const decided: { id: string; at: number }[] = [];
        // Three decided at the same instant (ties), then two later, plus one left waiting.
        for (const minutes of [5, 5, 5, 20, 40]) {
          const attempt = await heldWithAuthorization(w, at(minutes + 60));
          await authorize(store, attempt.id, at(1));
          await store.holds.decline(attempt.id, {
            by: "owner",
            now: at(minutes),
            voidRequestId: newRequestId(),
          });
          decided.push({ id: attempt.id, at: minutes });
        }
        const waiting = await heldWithAuthorization(w);

        const seen: string[] = [];
        let after: DecidedCursor | undefined;
        for (;;) {
          const page = await store.holds.listDecided(w.mandateId, {
            limit: 2,
            ...(after === undefined ? {} : { after }),
          });
          seen.push(...page.items.map((r) => r.attempt.id));
          if (page.next === null) {
            break;
          }
          after = page.next;
        }
        // Every decided hold once, newest decision first; never the one still waiting.
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toHaveLength(decided.length);
        expect(seen).not.toContain(waiting.id);
        const order = seen.map((id) => decided.find((d) => d.id === id)?.at);
        expect(order).toEqual([...order].sort((a, b) => (b ?? 0) - (a ?? 0)));
        // The receipts come back whole, with their decided hold.
        const first = await store.holds.listDecided(w.mandateId, { limit: 1 });
        expect(first.items[0]?.hold).toMatchObject({ status: "DECLINED", decidedBy: "owner" });
        expect(first.items[0]?.payment?.status).toBe("VOIDING");
      });

      it("listDecided sees only this mandate's holds, and refuses a silly page size", async () => {
        const mine = await world(store);
        const theirs = await world(store);
        const ours = await heldWithAuthorization(mine);
        await store.holds.expire(ours.id, { now: at(120), voidRequestId: newRequestId() });
        const attempt = await decided(store, theirs, markets.aboveCap());
        await record(store, attempt, { holdExpiresAt: at(60) });
        await store.holds.expire(attempt.id, { now: at(120), voidRequestId: newRequestId() });
        expect(
          (await store.holds.listDecided(mine.mandateId, { limit: 50 })).items.map(
            (r) => r.attempt.id,
          ),
        ).toEqual([ours.id]);
        await expect(store.holds.listDecided(mine.mandateId, { limit: 0 })).rejects.toBeInstanceOf(
          InvariantError,
        );
      });

      it("an authorization confirmed after its hold closed is listed until its void is written", async () => {
        const w = await world(store);
        const declinedFirst = await heldWithAuthorization(w);
        await store.holds.decline(declinedFirst.id, {
          by: "owner",
          now: at(2),
          voidRequestId: newRequestId(),
        });
        const expiredFirst = await heldWithAuthorization(w, at(3));
        await store.holds.expire(expiredFirst.id, { now: at(4), voidRequestId: newRequestId() });
        const stillOpen = await heldWithAuthorization(w);
        const declinedAfter = await heldWithAuthorization(w);
        for (const attempt of [declinedFirst, expiredFirst, stillOpen, declinedAfter]) {
          await authorize(store, attempt.id, at(5));
        }
        await store.holds.decline(declinedAfter.id, {
          by: "owner",
          now: at(6),
          voidRequestId: newRequestId(),
        });

        const ours = new Set<string>([
          declinedFirst.id,
          expiredFirst.id,
          stillOpen.id,
          declinedAfter.id,
        ]);
        const listed = async () =>
          (await store.payments.listAuthorizedOnClosedHolds(1000))
            .map((p) => p.attemptId)
            .filter((id) => ours.has(id));
        expect((await listed()).sort()).toEqual([declinedFirst.id, expiredFirst.id].sort());

        await store.payments.transition(declinedFirst.id, "VOIDING", {
          operationRequestId: newRequestId(),
          now: at(7),
        });
        expect(await listed()).toEqual([expiredFirst.id]);
      });

      it("decline voids a confirmed authorization; the decision is final", async () => {
        const w = await world(store);
        const attempt = await heldWithAuthorization(w);
        await authorize(store, attempt.id);
        const declined = await store.holds.decline(attempt.id, {
          by: "owner",
          now: at(5),
          voidRequestId: newRequestId(),
        });
        expect(declined.hold.status).toBe("DECLINED");
        expect(declined.payment?.status).toBe("VOIDING");
        await expect(
          store.holds.approve(attempt.id, {
            by: "owner",
            now: at(6),
            captureRequestId: newRequestId(),
          }),
        ).rejects.toBeInstanceOf(HoldAlreadyDecidedError);
        expect(
          (
            await store.holds.decline(attempt.id, {
              by: "owner",
              now: at(7),
              voidRequestId: newRequestId(),
            })
          ).result,
        ).toBe("unchanged");
      });

      it("expire only once due; listed when due; unconfirmed authorization left for the resolver", async () => {
        const w = await world(store);
        const attempt = await heldWithAuthorization(w, at(30));
        await expectConflict(
          store.holds.expire(attempt.id, { now: at(29), voidRequestId: newRequestId() }),
          Conflict.HOLD_NOT_EXPIRED,
        );
        expect(
          (await store.holds.listExpiring(at(29), 1000)).map((h) => h.attemptId),
        ).not.toContain(attempt.id);
        expect((await store.holds.listExpiring(at(30), 1000)).map((h) => h.attemptId)).toContain(
          attempt.id,
        );
        const expired = await store.holds.expire(attempt.id, {
          now: at(30),
          voidRequestId: newRequestId(),
        });
        expect(expired.hold).toMatchObject({ status: "EXPIRED", decidedBy: "system" });
        expect(expired.payment?.status).toBe("INITIATED");
      });

      it("the kill switch: no approval after a revoke, but decline still releases the hold", async () => {
        const w = await world(store);
        const attempt = await heldWithAuthorization(w);
        await authorize(store, attempt.id);
        await store.mandates.revoke(w.mandateId, at(2));
        await expect(
          store.holds.approve(attempt.id, {
            by: "owner",
            now: at(5),
            captureRequestId: newRequestId(),
          }),
        ).rejects.toBeInstanceOf(MandateNotActiveError);
        expect((await store.holds.get(attempt.id))?.status).toBe("PENDING");
        expect((await store.payments.get(attempt.id))?.status).toBe("AUTHORIZED");
        const declined = await store.holds.decline(attempt.id, {
          by: "system:revoked",
          now: at(6),
          voidRequestId: newRequestId(),
        });
        expect(declined.hold.status).toBe("DECLINED");
        expect(declined.payment?.status).toBe("VOIDING");
      });

      it("an approval made before a revoke repeats as unchanged after it", async () => {
        const w = await world(store);
        const attempt = await heldWithAuthorization(w);
        await authorize(store, attempt.id);
        await store.holds.approve(attempt.id, {
          by: "owner",
          now: at(5),
          captureRequestId: newRequestId(),
        });
        await store.mandates.revoke(w.mandateId, at(6));
        const again = await store.holds.approve(attempt.id, {
          by: "owner",
          now: at(7),
          captureRequestId: newRequestId(),
        });
        expect(again.result).toBe("unchanged");
        expect(again.payment?.status).toBe("CAPTURING");
      });

      it("a reused request id refuses the whole decision", async () => {
        const w = await world(store);
        const one = await heldWithAuthorization(w);
        const two = await heldWithAuthorization(w);
        await authorize(store, one.id);
        await authorize(store, two.id);
        const shared = newRequestId();
        await store.holds.decline(one.id, { by: "owner", now: at(5), voidRequestId: shared });
        await expectConflict(
          store.holds.decline(two.id, { by: "owner", now: at(5), voidRequestId: shared }),
          Conflict.REQUEST_ID_IN_USE,
        );
        expect((await store.holds.get(two.id))?.status).toBe("PENDING");
        expect((await store.payments.get(two.id))?.status).toBe("AUTHORIZED");
      });

      it("order-less hold: approval and its one-step follow-up land together", async () => {
        const w = await world(store);
        const parent = await decided(store, w, markets.aboveCap());
        await record(store, parent, { withOrder: false });
        const followUp = await followUpFor(store, w, parent);
        const { hold, recorded } = await store.holds.approveWithFollowUp({
          attemptId: parent.id,
          by: "owner@example.com",
          followUp,
        });
        expect(hold).toMatchObject({
          status: "APPROVED",
          decidedBy: "owner@example.com",
          decidedAt: at(10),
        });
        expect(recorded.vaultId).toBe(w.vaultId);
        expect(recorded.receipt.attempt).toMatchObject({
          origin: "OWNER_APPROVAL",
          parentAttemptId: parent.id,
        });
        expect(recorded.receipt.payment).toMatchObject({
          intent: "CAPTURE",
          status: "INITIATED",
          amountCents: 25000,
        });
        expect((await store.attempts.findChild(parent.id))?.attempt.id).toBe(followUp.attempt.id);
        expect((await store.holds.get(parent.id))?.status).toBe("APPROVED");

        // Approving again (a double click) is refused; nothing more is written.
        await expect(
          store.holds.approveWithFollowUp({
            attemptId: parent.id,
            by: "owner@example.com",
            followUp: await followUpFor(store, w, parent, { now: at(11) }),
          }),
        ).rejects.toBeInstanceOf(HoldAlreadyDecidedError);
      });

      it.each([
        ["failed", "FAILED"],
        ["voided by PayPal", "VOIDED"],
      ] as const)(
        "a hold whose authorization %s can be approved with a follow-up",
        async (_label, end) => {
          const w = await world(store);
          const parent = await decided(store, w, markets.aboveCap());
          await record(store, parent);
          if (end === "FAILED") {
            await store.payments.transition(parent.id, "FAILED", {
              patch: { failureReason: "DENIED" },
              now: at(1),
            });
          } else {
            await authorize(store, parent.id);
            await store.payments.transition(parent.id, "VOIDED", { now: at(2) });
          }
          const { hold } = await store.holds.approveWithFollowUp({
            attemptId: parent.id,
            by: "owner",
            followUp: await followUpFor(store, w, parent),
          });
          expect(hold.status).toBe("APPROVED");
        },
      );

      it("a live or unsettled authorization is never followed up", async () => {
        const w = await world(store);
        const unsettled = await decided(store, w, markets.aboveCap());
        await record(store, unsettled);
        await expect(
          store.holds.approveWithFollowUp({
            attemptId: unsettled.id,
            by: "owner",
            followUp: await followUpFor(store, w, unsettled),
          }),
        ).rejects.toBeInstanceOf(HoldNotReadyError);
        const live = await decided(store, w, markets.aboveCap());
        await record(store, live);
        await authorize(store, live.id);
        await expect(
          store.holds.approveWithFollowUp({
            attemptId: live.id,
            by: "owner",
            followUp: await followUpFor(store, w, live),
          }),
        ).rejects.toBeInstanceOf(InvariantError);
        expect((await store.holds.get(live.id))?.status).toBe("PENDING");
      });

      it("a declined capture is never followed up: that approval was already given", async () => {
        const w = await world(store);
        const parent = await decided(store, w, markets.aboveCap());
        await record(store, parent);
        await authorize(store, parent.id);
        await store.holds.approve(parent.id, {
          by: "owner",
          now: at(5),
          captureRequestId: newRequestId(),
        });
        await store.payments.transition(parent.id, "FAILED", {
          patch: { failureReason: "CAPTURE_DECLINED" },
          now: at(6),
        });
        await expect(
          store.holds.approveWithFollowUp({
            attemptId: parent.id,
            by: "owner",
            followUp: await followUpFor(store, w, parent),
          }),
        ).rejects.toBeInstanceOf(HoldAlreadyDecidedError);
        expect(await store.attempts.findChild(parent.id)).toBeNull();
      });

      it.each([
        ["the lease is lost", "lease"],
        ["the mandate is revoked", "revoked"],
        ["the policy changed", "policy"],
        ["the hold expired", "expired"],
      ] as const)(
        "atomic: when %s the hold stays PENDING and nothing is written",
        async (_label, mode) => {
          const w = await world(store);
          const parent = await decided(store, w, markets.aboveCap());
          await record(store, parent, { withOrder: false, holdExpiresAt: at(30) });
          const followUp = await followUpFor(store, w, parent, {
            now: mode === "expired" ? at(30) : at(10),
          });
          const key = { agentId: w.agentId, productId: parent.productId };
          let expected: new (...args: never[]) => Error = LeaseLostError;
          if (mode === "lease") {
            await store.leases.release(key, followUp.leaseHolder);
            await store.leases.acquire(key, "someone-else", 60_000, at(10));
          } else if (mode === "revoked") {
            await store.mandates.revoke(w.mandateId, at(9));
            expected = MandateNotActiveError;
          } else if (mode === "policy") {
            await store.mandates.updatePolicy(
              w.mandateId,
              { orderCapCents: 30_000 as never },
              at(9),
            );
            expected = PolicyChangedError;
          } else {
            expected = HoldExpiredError;
          }
          await expect(
            store.holds.approveWithFollowUp({ attemptId: parent.id, by: "owner", followUp }),
          ).rejects.toBeInstanceOf(expected);
          expect((await store.holds.get(parent.id))?.status).toBe("PENDING");
          expect(await store.attempts.findChild(parent.id)).toBeNull();
          expect(await store.payments.get(followUp.attempt.id)).toBeNull();
        },
      );

      it("listOpen sees a pending hold at any age, for this agent and product only", async () => {
        const w = await world(store);
        const productId = newProductId();
        const old = await decided(store, w, { ...markets.aboveCap(), productId, now: at(-600) });
        await record(store, old, { withOrder: false, holdExpiresAt: at(600) });
        const decidedHold = await decided(store, w, {
          ...markets.aboveCap(),
          productId,
          now: at(-5),
        });
        await record(store, decidedHold, { withOrder: false });
        await store.holds.decline(decidedHold.id, {
          by: "owner",
          now: at(-4),
          voidRequestId: newRequestId(),
        });
        const elsewhere = await decided(store, w, markets.aboveCap());
        await record(store, elsewhere, { withOrder: false });
        const open = await store.holds.listOpen(w.agentId, productId);
        expect(open.map((r) => r.attempt.id)).toEqual([old.id]);
        expect(open[0]?.hold?.status).toBe("PENDING");
      });

      it("listPendingOnRevokedMandates finds holds a revoke left open", async () => {
        const w = await world(store);
        const left = await heldWithAuthorization(w);
        const closed = await heldWithAuthorization(w);
        const active = await world(store);
        const untouched = await heldWithAuthorization(active);
        await store.mandates.revoke(w.mandateId, at(1));
        await store.holds.decline(closed.id, {
          by: "system:revoked",
          now: at(2),
          voidRequestId: newRequestId(),
        });
        const ids = (await store.holds.listPendingOnRevokedMandates(1000)).map((r) => r.attempt.id);
        expect(ids).toContain(left.id);
        expect(ids).not.toContain(closed.id);
        expect(ids).not.toContain(untouched.id);
      });

      it("listPending shows the mandate's open holds; unknown hold is NotFound", async () => {
        const w = await world(store);
        const open = await heldWithAuthorization(w);
        const closed = await heldWithAuthorization(w);
        await store.holds.decline(closed.id, {
          by: "owner",
          now: at(1),
          voidRequestId: newRequestId(),
        });
        const pending = await store.holds.listPending(w.mandateId);
        expect(pending.map((r) => r.attempt.id)).toEqual([open.id]);
        expect(pending[0]?.hold?.status).toBe("PENDING");
        await expect(
          store.holds.approve(newAttemptId(), {
            by: "x",
            now: NOW,
            captureRequestId: newRequestId(),
          }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe("webhooks", () => {
      it("stores each event once and remembers whether it was processed", async () => {
        const id = `WH-${randomUUID()}`;
        const event = {
          id,
          eventType: "PAYMENT.CAPTURE.COMPLETED",
          resourceId: "CAP-1",
          payload: { id, resource: { id: "CAP-1", amount: { value: "47.99" } } },
          receivedAt: NOW,
        };
        expect(await store.webhooks.recordOnce(event)).toEqual({
          inserted: true,
          processedAt: null,
        });
        expect(await store.webhooks.recordOnce(event)).toEqual({
          inserted: false,
          processedAt: null,
        });
        expect(
          (await store.webhooks.listUnprocessed(1000)).find((e) => e.id === id)?.payload,
        ).toEqual(event.payload);
        await store.webhooks.markProcessed(id, at(1));
        await store.webhooks.markProcessed(id, at(2));
        expect(await store.webhooks.recordOnce(event)).toEqual({
          inserted: false,
          processedAt: at(1),
        });
        expect((await store.webhooks.listUnprocessed(1000)).map((e) => e.id)).not.toContain(id);
        await expect(store.webhooks.markProcessed("WH-unknown", NOW)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });
    });

    describe("leases", () => {
      it("one holder at a time; the holder extends; expiry frees; only the holder releases", async () => {
        const w = await world(store);
        const key = { agentId: w.agentId, productId: newProductId() };
        expect(await store.leases.acquire(key, "a", 60_000, NOW)).toBe(true);
        expect(await store.leases.acquire(key, "b", 60_000, at(0.5))).toBe(false);
        expect(await store.leases.acquire(key, "a", 60_000, at(0.5))).toBe(true);
        expect(await store.leases.acquire(key, "b", 60_000, at(1))).toBe(false);
        expect(await store.leases.acquire(key, "b", 60_000, at(1.5))).toBe(true);
        await store.leases.release(key, "a");
        expect(await store.leases.acquire(key, "c", 60_000, at(1.6))).toBe(false);
        await store.leases.release(key, "b");
        expect(await store.leases.acquire(key, "c", 60_000, at(1.6))).toBe(true);
      });

      it("refuses a lease for an unknown agent", async () => {
        await expect(
          store.leases.acquire({ agentId: agentId(randomUUID()), productId: "p" }, "a", 1000, NOW),
        ).rejects.toBeInstanceOf(InvariantError);
      });
    });

    describe("reports", () => {
      it("counts decisions, price gaps, steering and conflicts; ignores owner follow-ups", async () => {
        const w = await world(store);
        const run = async (
          market: ReturnType<(typeof markets)[keyof typeof markets]>,
          extra: object = {},
        ) => {
          const attempt = await decided(store, w, { ...market, ...extra });
          await record(store, attempt);
          return attempt;
        };
        const paid = await run(markets.paid()); // gap 0
        await capture(store, paid.id);
        await run(markets.overpaid()); // 12 % / $15 → R4
        await run(markets.conflict()); // 3 % → R5 held, conflict
        const steeredChosen = offer({ price: 51 });
        await run(
          { offers: [offer({ price: 50 }), steeredChosen], chosen: steeredChosen },
          { classifier: { instruction_like: true } },
        ); // 2 % → R3

        const report = await store.reports.agentReport(w.agentId);
        expect(report).toEqual({
          agentId: w.agentId,
          attempted: 4,
          paid: 1,
          rejected: 2,
          held: 1,
          captured: 1,
          notCheapest: 3,
          // gaps 1200, 300, 200 → lower median 300
          medianGapPctHundredths: 300,
          worstGapPctHundredths: 1200,
          worstGapAbsCents: 1500,
          steered: 1,
          conflicts: 1,
        });
      });

      it("lower median with an even count; empty report for a quiet agent", async () => {
        const w = await world(store);
        const two = async (best: number, chosen: number) => {
          const c = offer({ price: chosen });
          const attempt = await decided(store, w, {
            offers: [offer({ price: best }), c],
            chosen: c,
          });
          await record(store, attempt);
        };
        await two(100, 102); // 200
        await two(100, 106); // 600
        expect((await store.reports.agentReport(w.agentId)).medianGapPctHundredths).toBe(200);

        const quiet = await world(store);
        expect(await store.reports.agentReport(quiet.agentId)).toEqual({
          agentId: quiet.agentId,
          attempted: 0,
          paid: 0,
          rejected: 0,
          held: 0,
          captured: 0,
          notCheapest: 0,
          medianGapPctHundredths: null,
          worstGapPctHundredths: null,
          worstGapAbsCents: null,
          steered: 0,
          conflicts: 0,
        });
      });
    });
  });
}
