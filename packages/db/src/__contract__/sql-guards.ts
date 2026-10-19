import { randomUUID } from "node:crypto";
import {
  HOLD_TRANSITIONS,
  InvariantError,
  MANDATE_TRANSITIONS,
  PAYMENT_INTENTS,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  RULE_CODES,
  type Store,
} from "@slip/domain";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../client.js";
import { VaultCipher } from "../crypto.js";
import { translateDbError } from "../pg/errors.js";
import { attemptValues, rowsOf } from "../pg/rows.js";
import { createPgStore } from "../pg/store.js";
import * as schema from "../schema.js";
import { capture, decided, markets, record, world } from "./fixtures.js";

export interface SqlHarness {
  handle: DatabaseHandle;
  close(): Promise<void>;
}

/**
 * Guarantees that live in the database itself, below the store code: transition tables that
 * mirror the domain, triggers, constraints, and encryption at rest. Each test writes SQL directly,
 * the way a buggy future change or a manual edit would.
 */
export function describeSqlGuards(label: string, make: () => Promise<SqlHarness>): void {
  describe(`database guards · ${label}`, () => {
    let harness: SqlHarness;
    let store: Store;
    const cipher = VaultCipher.random();

    const exec = async (query: string) => rowsOf(await harness.handle.db.execute(sql.raw(query)));

    /** The statement must fail, and the store's translation must be an InvariantError. */
    const refused = async (operation: () => Promise<unknown>) => {
      const error = await operation().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, "the database accepted a write it must refuse").not.toBeNull();
      expect(translateDbError(error)).toBeInstanceOf(InvariantError);
    };

    beforeAll(async () => {
      harness = await make();
      store = createPgStore(harness.handle.db, cipher);
    });
    afterAll(async () => {
      await harness.close();
    });

    it("migrations are idempotent", async () => {
      await harness.handle.migrate();
      await harness.handle.migrate();
    });

    it("the payment transition table mirrors the domain exactly", async () => {
      const rows = await exec(
        `select intent, from_status, to_status from slip_payment_transitions`,
      );
      const inDb = rows.map((r) => `${r["intent"]}:${r["from_status"]}→${r["to_status"]}`).sort();
      const inDomain = PAYMENT_INTENTS.flatMap((intent) =>
        PAYMENT_STATUSES.filter((s) => s !== "NONE").flatMap((from) =>
          PAYMENT_TRANSITIONS[intent][from].map((to) => `${intent}:${from}→${to}`),
        ),
      ).sort();
      expect(inDb).toEqual(inDomain);
    });

    it("the mandate and hold transition tables mirror the domain exactly", async () => {
      const edges = (table: Record<string, readonly string[]>) =>
        Object.entries(table)
          .flatMap(([from, tos]) => tos.map((to) => `${from}→${to}`))
          .sort();
      const mandateRows = await exec(`select from_status, to_status from slip_mandate_transitions`);
      const holdRows = await exec(`select from_status, to_status from slip_hold_transitions`);
      expect(mandateRows.map((r) => `${r["from_status"]}→${r["to_status"]}`).sort()).toEqual(
        edges(MANDATE_TRANSITIONS),
      );
      expect(holdRows.map((r) => `${r["from_status"]}→${r["to_status"]}`).sort()).toEqual(
        edges(HOLD_TRANSITIONS),
      );
      await refused(() =>
        exec(`insert into slip_hold_transitions values ('DECLINED', 'APPROVED')`),
      );
    });

    it("the rule-code check accepts every rule the domain can decide", async () => {
      // A rule added to the domain without regenerating the migration passes every in-memory test
      // and then fails in Postgres the first time that rule decides something. That is exactly
      // what happened to R2A_GAP_IMPLAUSIBLE (D68), so the constraint is held to the domain here
      // the way the transition tables are.
      const [row] = await exec(
        `select pg_get_constraintdef(oid) as def from pg_constraint
         where conname = 'attempts_rule_codes_valid'`,
      );
      const definition = String(row?.["def"] ?? "");
      expect(definition).not.toBe("");
      for (const code of RULE_CODES) {
        expect(definition, `${code} is missing from attempts_rule_codes_valid`).toContain(code);
      }
    });

    it("payments: illegal moves, immutable amounts and deletes are refused", async () => {
      const w = await world(store);
      const attempt = await decided(store, w, markets.paid());
      await record(store, attempt);
      const id = attempt.id;
      await refused(() => exec(`update payments set status = 'VOIDED' where attempt_id = '${id}'`));
      await refused(() => exec(`update payments set amount_cents = 1 where attempt_id = '${id}'`));
      await refused(() =>
        exec(`update payments set intent = 'AUTHORIZE' where attempt_id = '${id}'`),
      );
      await refused(() => exec(`delete from payments where attempt_id = '${id}'`));
      await capture(store, id);
      await refused(() =>
        exec(`update payments set capture_id = 'CAP-OTHER' where attempt_id = '${id}'`),
      );
      await refused(() =>
        exec(
          `update payments set status = 'FAILED', failure_reason = 'x' where attempt_id = '${id}'`,
        ),
      );
      expect((await store.payments.get(id))?.status).toBe("CAPTURED");
    });

    it("payments: a row can only be born INITIATED, for a PAID or HELD attempt, at the chosen price", async () => {
      const w = await world(store);
      const rejected = await decided(store, w, markets.overpaid());
      await record(store, rejected);
      const insert = (
        attemptId: string,
        outcome: string,
        intent: string,
        amount: number,
        status = "INITIATED",
      ) =>
        exec(
          `insert into payments (attempt_id, attempt_outcome, agent_id, product_id, intent, status, amount_cents, currency, created_at, updated_at)
           select id, '${outcome}', agent_id, product_id, '${intent}', '${status}', ${amount}, 'USD', now(), now()
           from attempts where id = '${attemptId}'`,
        );
      // REJECTED attempt: neither pretending it was PAID nor matching its outcome works.
      await refused(() => insert(rejected.id, "PAID", "CAPTURE", 14000));
      await refused(() => insert(rejected.id, "REJECTED", "CAPTURE", 14000));
      // Born in a later status.
      const fresh = await decided(store, w, markets.paid());
      await harness.handle.db.insert(schema.attempts).values(attemptValues(fresh));
      await refused(() => insert(fresh.id, "PAID", "CAPTURE", 4799, "CAPTURED"));
      // Wrong amount.
      await refused(() => insert(fresh.id, "PAID", "CAPTURE", 1));
      // Correct row is accepted.
      await insert(fresh.id, "PAID", "CAPTURE", 4799);
    });

    it("attempts, snapshots, policies, operations and events are append-only", async () => {
      const w = await world(store);
      const attempt = await decided(store, w, markets.paid());
      await record(store, attempt);
      const snapshotId = attempt.decision.checkResult.snapshotId;
      await refused(() => exec(`update attempts set reason = 'edited' where id = '${attempt.id}'`));
      await refused(() => exec(`delete from attempts where id = '${attempt.id}'`));
      await refused(() => exec(`truncate attempts cascade`));
      await refused(() =>
        exec(`update offer_snapshots set title = 'edited' where id = '${snapshotId}'`),
      );
      await refused(() => exec(`delete from policies where mandate_id = '${w.mandateId}'`));
      await refused(() =>
        exec(
          `update payment_operations set request_id = gen_random_uuid() where attempt_id = '${attempt.id}'`,
        ),
      );
      await refused(() => exec(`delete from payment_events where attempt_id = '${attempt.id}'`));
      expect((await store.attempts.get(attempt.id))?.attempt.reason).toBe(attempt.reason);
    });

    it("attempts: an unknown rule code or a mismatched outcome is refused", async () => {
      const w = await world(store);
      const attempt = await decided(store, w, markets.overpaid());
      await refused(() =>
        harness.handle.db.insert(schema.attempts).values({
          ...attemptValues(attempt),
          ruleCode: "MADE_UP",
          ruleCodes: ["MADE_UP"],
        }),
      );
      await refused(() =>
        harness.handle.db
          .insert(schema.attempts)
          .values({ ...attemptValues(attempt), outcome: "PAID" }),
      );
      await refused(() =>
        harness.handle.db
          .insert(schema.attempts)
          .values({ ...attemptValues(attempt), id: randomUUID(), mandateId: randomUUID() }),
      );
    });

    it("mandates: REVOKED is final and the vault id is set once", async () => {
      const w = await world(store);
      await refused(() =>
        exec(`update mandates set status = 'PENDING' where id = '${w.mandateId}'`),
      );
      await refused(() =>
        exec(`update mandates set vault_id_ciphertext = 'v1.a.b.c' where id = '${w.mandateId}'`),
      );
      await store.mandates.revoke(w.mandateId, new Date());
      await refused(() =>
        exec(`update mandates set status = 'ACTIVE' where id = '${w.mandateId}'`),
      );
      await refused(() => exec(`delete from mandates where id = '${w.mandateId}'`));
    });

    it("mandates: the vault deletion time is set once, and only after a revoke", async () => {
      const w = await world(store);
      await refused(() =>
        exec(`update mandates set vault_deleted_at = now() where id = '${w.mandateId}'`),
      );
      await store.mandates.revoke(w.mandateId, new Date());
      await store.mandates.markVaultDeleted(w.mandateId, new Date());
      await refused(() =>
        exec(`update mandates set vault_deleted_at = null where id = '${w.mandateId}'`),
      );
      await refused(() =>
        exec(
          `update mandates set vault_deleted_at = now() + interval '1 day' where id = '${w.mandateId}'`,
        ),
      );
    });

    it("holds: a decision is final", async () => {
      const w = await world(store);
      const attempt = await decided(store, w, markets.aboveCap());
      await record(store, attempt, { withOrder: false });
      await store.holds.decline(attempt.id, {
        by: "owner",
        now: new Date(),
        voidRequestId: randomUUID() as never,
      });
      await refused(() =>
        exec(`update holds set status = 'APPROVED' where attempt_id = '${attempt.id}'`),
      );
      await refused(() =>
        exec(`update holds set decided_by = 'someone' where attempt_id = '${attempt.id}'`),
      );
    });

    it("jsonb columns hold JSON objects, not double-encoded strings", async () => {
      const w = await world(store);
      const attempt = await decided(store, w, markets.paid());
      await record(store, attempt);
      const [row] = await exec(
        `select jsonb_typeof(a.check_result) as result, jsonb_typeof(s.offers) as offers,
                a.check_result->>'ruleCode' as rule
         from attempts a join offer_snapshots s on s.id = a.snapshot_id
         where a.id = '${attempt.id}'`,
      );
      expect(row).toEqual({ result: "object", offers: "array", rule: "R7_WITHIN_LIMITS" });
    });

    it("vault ids are encrypted at rest and bound to their mandate", async () => {
      const w = await world(store);
      const other = await world(store);
      const [row] = await harness.handle.db
        .select({ ciphertext: schema.mandates.vaultIdCiphertext })
        .from(schema.mandates)
        .where(eq(schema.mandates.id, w.mandateId));
      const ciphertext = row?.ciphertext ?? "";
      expect(ciphertext.startsWith("v1.")).toBe(true);
      expect(ciphertext).not.toContain(w.vaultId);
      expect(cipher.decrypt(ciphertext, w.mandateId)).toBe(w.vaultId);
      expect(() => cipher.decrypt(ciphertext, other.mandateId)).toThrow(InvariantError);
      expect(() => VaultCipher.random().decrypt(ciphertext, w.mandateId)).toThrow(InvariantError);
    });
  });
}
