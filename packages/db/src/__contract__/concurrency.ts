import { randomUUID } from "node:crypto";
import {
  ConflictError,
  HoldAlreadyDecidedError,
  LeaseLostError,
  MandateNotActiveError,
  type Store,
} from "@slip/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Conflict } from "../codes.js";
import {
  at,
  authorize,
  decided,
  followUpFor,
  markets,
  NOW,
  newProductId,
  newRequestId,
  record,
  recordInput,
  world,
} from "./fixtures.js";

export interface ConcurrencyHarness {
  store: Store;
  close(): Promise<void>;
}

const N = 20;

/**
 * Races that only a multi-connection Postgres can exercise (PGlite runs everything on one
 * connection). Each test fires many operations at once and checks exactly one wins.
 */
export function describeConcurrency(label: string, make: () => Promise<ConcurrencyHarness>): void {
  describe(`concurrency · ${label}`, () => {
    let harness: ConcurrencyHarness;
    let store: Store;
    beforeAll(async () => {
      harness = await make();
      store = harness.store;
    });
    afterAll(async () => {
      await harness.close();
    });

    it(`${N} reports of the same capture: one applies, one event`, async () => {
      const w = await world(store);
      const attempt = await decided(store, w, markets.paid());
      await record(store, attempt);
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          store.payments.transition(attempt.id, "CAPTURED", {
            patch: { paypalOrderId: "ORDER-RACE", captureId: "CAP-RACE" },
            now: at(1),
          }),
        ),
      );
      expect(results.filter((r) => r.result === "applied")).toHaveLength(1);
      expect(results.filter((r) => r.result === "unchanged")).toHaveLength(N - 1);
      expect((await store.payments.events(attempt.id)).map((e) => e.toStatus)).toEqual([
        "INITIATED",
        "CAPTURED",
      ]);
    });

    it(`${N} checkouts race for one lease: exactly one gets it`, async () => {
      const w = await world(store);
      const key = { agentId: w.agentId, productId: newProductId() };
      const won = await Promise.all(
        Array.from({ length: N }, (_, i) => store.leases.acquire(key, `holder-${i}`, 60_000, NOW)),
      );
      expect(won.filter(Boolean)).toHaveLength(1);
    });

    it("10 concurrent policy edits produce versions 2..11 with no gap or duplicate", async () => {
      const w = await world(store);
      const versions = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.mandates.updatePolicy(w.mandateId, { orderCapCents: (20_000 + i) as never }, at(i)),
        ),
      );
      expect(versions.map((p) => p.version).sort((a, b) => a - b)).toEqual([
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
    });

    it("approve and decline at the same moment: one decision, and the payment agrees with it", async () => {
      const w = await world(store);
      for (let i = 0; i < 5; i += 1) {
        const attempt = await decided(store, w, markets.aboveCap());
        await record(store, attempt);
        await authorize(store, attempt.id);
        const outcomes = await Promise.allSettled([
          store.holds.approve(attempt.id, {
            by: "owner",
            now: at(5),
            captureRequestId: newRequestId(),
          }),
          store.holds.decline(attempt.id, {
            by: "owner",
            now: at(5),
            voidRequestId: newRequestId(),
          }),
        ]);
        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
          HoldAlreadyDecidedError,
        );
        const hold = await store.holds.get(attempt.id);
        const payment = await store.payments.get(attempt.id);
        expect(payment?.status).toBe(hold?.status === "APPROVED" ? "CAPTURING" : "VOIDING");
      }
    });

    it("approve racing a revoke: the approval lands first or is refused — never after", async () => {
      for (let i = 0; i < 5; i += 1) {
        const w = await world(store);
        const attempt = await decided(store, w, markets.aboveCap());
        await record(store, attempt);
        await authorize(store, attempt.id);
        const [approved, revoked] = await Promise.allSettled([
          store.holds.approve(attempt.id, {
            by: "owner",
            now: at(5),
            captureRequestId: newRequestId(),
          }),
          store.mandates.revoke(w.mandateId, at(5)),
        ]);
        expect(revoked.status).toBe("fulfilled");
        const hold = await store.holds.get(attempt.id);
        const payment = await store.payments.get(attempt.id);
        if (approved.status === "fulfilled") {
          expect(hold?.status).toBe("APPROVED");
          expect(payment?.status).toBe("CAPTURING");
        } else {
          expect(approved.reason).toBeInstanceOf(MandateNotActiveError);
          expect(hold?.status).toBe("PENDING");
          expect(payment?.status).toBe("AUTHORIZED");
        }
      }
    });

    it("two owners approving one order-less hold at once: exactly one follow-up pays", async () => {
      for (let i = 0; i < 5; i += 1) {
        const w = await world(store);
        const parent = await decided(store, w, markets.aboveCap());
        await record(store, parent, { withOrder: false });
        const a = await followUpFor(store, w, parent, { holder: "shared" });
        const b = await followUpFor(store, w, parent, { holder: "shared" });
        const settled = await Promise.allSettled([
          store.holds.approveWithFollowUp({ attemptId: parent.id, by: "owner-a", followUp: a }),
          store.holds.approveWithFollowUp({ attemptId: parent.id, by: "owner-b", followUp: b }),
        ]);
        expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
        const loser = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
        expect(loser.reason).toBeInstanceOf(HoldAlreadyDecidedError);
        const child = await store.attempts.findChild(parent.id);
        expect(child?.payment?.status).toBe("INITIATED");
      }
    });

    it("revoke racing a checkout: either the checkout landed first or it is refused — never after", async () => {
      for (let i = 0; i < 5; i += 1) {
        const w = await world(store);
        const attempt = await decided(store, w, markets.paid());
        await store.leases.acquire(
          { agentId: w.agentId, productId: attempt.productId },
          "h",
          60_000,
          NOW,
        );
        const [recorded, revoked] = await Promise.allSettled([
          store.attempts.record(recordInput(attempt, "h")),
          store.mandates.revoke(w.mandateId, at(1)),
        ]);
        expect(revoked.status).toBe("fulfilled");
        if (recorded.status === "rejected") {
          expect(recorded.reason).toBeInstanceOf(MandateNotActiveError);
          expect(await store.attempts.get(attempt.id)).toBeNull();
        } else {
          expect(recorded.value.vaultId).toBe(w.vaultId);
        }
        expect(await store.mandates.vaultIdForCharge(w.mandateId)).toBeNull();
      }
    });

    it("parallel checkouts for one product: only the lease holder records, never two payments", async () => {
      const w = await world(store);
      const productId = newProductId();
      const attempts = await Promise.all(
        Array.from({ length: 10 }, () => decided(store, w, { ...markets.paid(), productId })),
      );
      const settled = await Promise.allSettled(
        attempts.map(async (attempt) => {
          const holder = `holder-${randomUUID()}`;
          const got = await store.leases.acquire(
            { agentId: w.agentId, productId },
            holder,
            60_000,
            NOW,
          );
          if (!got) {
            return "no-lease";
          }
          return store.attempts.record(recordInput(attempt, holder));
        }),
      );
      const recorded = settled.filter((s) => s.status === "fulfilled" && s.value !== "no-lease");
      expect(recorded).toHaveLength(1);
      const others = settled.filter((s) => s.status === "rejected");
      for (const other of others) {
        const reason = (other as PromiseRejectedResult).reason;
        expect(
          reason instanceof LeaseLostError ||
            (reason instanceof ConflictError && reason.code === Conflict.PAYMENT_IN_FLIGHT),
        ).toBe(true);
      }
    });
  });
}
