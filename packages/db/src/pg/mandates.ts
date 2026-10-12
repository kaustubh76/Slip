import {
  type AgentRepo,
  ConflictError,
  classifyMove,
  InvariantError,
  MANDATE_TRANSITIONS,
  MandateNotActiveError,
  type MandateRepo,
  NotFoundError,
  type OwnerRepo,
  PolicySchema,
} from "@slip/domain";
import { and, asc, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Db } from "../client.js";
import { Conflict } from "../codes.js";
import type { VaultCipher } from "../crypto.js";
import { agents, mandates, owners, policies } from "../schema.js";
import { guarded } from "./errors.js";
import { toAgent, toMandate, toOwner, toPolicy } from "./rows.js";

export function pgOwners(db: Db): OwnerRepo {
  return {
    create: (input) =>
      guarded(async () => {
        const [row] = await db
          .insert(owners)
          .values({ id: input.id, email: input.email, createdAt: input.now })
          .returning();
        return toOwner(row as typeof owners.$inferSelect);
      }),
    get: (id) =>
      guarded(async () => {
        const [row] = await db.select().from(owners).where(eq(owners.id, id));
        return row === undefined ? null : toOwner(row);
      }),
  };
}

async function latestPolicy(db: Db, mandateId: string) {
  const [row] = await db
    .select()
    .from(policies)
    .where(eq(policies.mandateId, mandateId))
    .orderBy(desc(policies.version))
    .limit(1);
  return row;
}

export function pgMandates(db: Db, cipher: VaultCipher): MandateRepo {
  const lockMandate = async (tx: Db, id: string) => {
    const [row] = await tx.select().from(mandates).where(eq(mandates.id, id)).for("update");
    if (row === undefined) {
      throw new NotFoundError("mandate", id);
    }
    return row;
  };

  return {
    create: (input) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const [owner] = await tx.select().from(owners).where(eq(owners.id, input.ownerId));
          if (owner === undefined) {
            throw new InvariantError(`owner ${input.ownerId} does not exist`);
          }
          const policy = PolicySchema.safeParse({ ...input.limits, version: 1 });
          if (!policy.success) {
            throw new InvariantError(`invalid policy: ${policy.error.message}`);
          }
          const [mandate] = await tx
            .insert(mandates)
            .values({
              id: input.id,
              ownerId: input.ownerId,
              status: "PENDING",
              createdAt: input.now,
            })
            .returning();
          const [policyRow] = await tx
            .insert(policies)
            .values({ mandateId: input.id, ...policy.data, createdAt: input.now })
            .returning();
          return {
            mandate: toMandate(mandate as typeof mandates.$inferSelect),
            policy: toPolicy(policyRow as typeof policies.$inferSelect),
          };
        }),
      ),

    get: (id) =>
      guarded(async () => {
        const [row] = await db.select().from(mandates).where(eq(mandates.id, id));
        return row === undefined ? null : toMandate(row);
      }),

    findBySetupOrderId: (orderId) =>
      guarded(async () => {
        const [row] = await db.select().from(mandates).where(eq(mandates.setupOrderId, orderId));
        return row === undefined ? null : toMandate(row);
      }),

    findByVaultId: (vaultId) =>
      guarded(async () => {
        const [row] = await db
          .select()
          .from(mandates)
          .where(eq(mandates.vaultIdHmac, cipher.blindIndex(vaultId)));
        return row === undefined ? null : toMandate(row);
      }),

    attachSetupOrder: (id, orderId, _now) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const row = await lockMandate(tx, id);
          if (row.setupOrderId === orderId) {
            return toMandate(row);
          }
          if (row.status !== "PENDING") {
            throw new ConflictError(Conflict.MANDATE_NOT_PENDING, `mandate ${id} is ${row.status}`);
          }
          if (row.setupOrderId !== null) {
            throw new ConflictError(
              Conflict.SETUP_ORDER_SET,
              `mandate ${id} already has setup order ${row.setupOrderId}`,
            );
          }
          const [updated] = await tx
            .update(mandates)
            .set({ setupOrderId: orderId })
            .where(eq(mandates.id, id))
            .returning();
          return toMandate(updated as typeof mandates.$inferSelect);
        }),
      ),

    activate: (id, vault, now) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const row = await lockMandate(tx, id);
          const kind = classifyMove(MANDATE_TRANSITIONS, row.status as never, "ACTIVE");
          if (kind === "stale") {
            return { value: toMandate(row), result: "stale" as const };
          }
          if (kind === "unchanged") {
            if (row.vaultIdHmac !== null && cipher.matches(vault.vaultId, row.vaultIdHmac)) {
              return { value: toMandate(row), result: "unchanged" as const };
            }
            throw new ConflictError(
              Conflict.MANDATE_VAULT_SET,
              `mandate ${id} is already active with a different vault id`,
            );
          }
          const [updated] = await tx
            .update(mandates)
            .set({
              status: "ACTIVE",
              vaultIdCiphertext: cipher.encrypt(vault.vaultId, id),
              vaultIdHmac: cipher.blindIndex(vault.vaultId),
              paypalCustomerId: vault.paypalCustomerId,
              activatedAt: now,
            })
            .where(eq(mandates.id, id))
            .returning();
          return {
            value: toMandate(updated as typeof mandates.$inferSelect),
            result: "applied" as const,
          };
        }),
      ),

    revoke: (id, now) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const row = await lockMandate(tx, id);
          if (row.status === "REVOKED") {
            return { value: toMandate(row), result: "unchanged" as const };
          }
          const [updated] = await tx
            .update(mandates)
            .set({ status: "REVOKED", revokedAt: now })
            .where(eq(mandates.id, id))
            .returning();
          return {
            value: toMandate(updated as typeof mandates.$inferSelect),
            result: "applied" as const,
          };
        }),
      ),

    vaultIdForCharge: (id) =>
      guarded(async () => {
        const [row] = await db.select().from(mandates).where(eq(mandates.id, id));
        if (row === undefined || row.status !== "ACTIVE" || row.vaultIdCiphertext === null) {
          return null;
        }
        return cipher.decrypt(row.vaultIdCiphertext, row.id);
      }),

    vaultIdForDeletion: (id) =>
      guarded(async () => {
        const [row] = await db.select().from(mandates).where(eq(mandates.id, id));
        if (
          row === undefined ||
          row.status !== "REVOKED" ||
          row.vaultIdCiphertext === null ||
          row.vaultDeletedAt !== null
        ) {
          return null;
        }
        return cipher.decrypt(row.vaultIdCiphertext, row.id);
      }),

    markVaultDeleted: (id, now) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const row = await lockMandate(tx, id);
          if (row.vaultDeletedAt !== null) {
            return { value: toMandate(row), result: "unchanged" as const };
          }
          if (row.status !== "REVOKED" || row.vaultIdCiphertext === null) {
            throw new InvariantError(
              `mandate ${id}: only a revoked mandate's vaulted method is deleted (status ${row.status})`,
            );
          }
          const [updated] = await tx
            .update(mandates)
            .set({ vaultDeletedAt: now })
            .where(eq(mandates.id, id))
            .returning();
          return {
            value: toMandate(updated as typeof mandates.$inferSelect),
            result: "applied" as const,
          };
        }),
      ),

    listAwaitingVaultDeletion: (limit) =>
      guarded(async () => {
        const rows = await db
          .select()
          .from(mandates)
          .where(
            and(
              eq(mandates.status, "REVOKED"),
              isNotNull(mandates.vaultIdCiphertext),
              isNull(mandates.vaultDeletedAt),
            ),
          )
          .orderBy(asc(mandates.revokedAt), asc(mandates.id))
          .limit(limit);
        return rows.map(toMandate);
      }),

    listPendingSetup: (createdBefore, limit) =>
      guarded(async () => {
        const rows = await db
          .select()
          .from(mandates)
          .where(
            and(
              eq(mandates.status, "PENDING"),
              isNotNull(mandates.setupOrderId),
              lt(mandates.createdAt, createdBefore),
            ),
          )
          .orderBy(asc(mandates.createdAt), asc(mandates.id))
          .limit(limit);
        return rows.map(toMandate);
      }),

    currentPolicy: (id) =>
      guarded(async () => {
        const row = await latestPolicy(db, id);
        if (row === undefined) {
          throw new NotFoundError("mandate", id);
        }
        return toPolicy(row);
      }),

    policy: (id, version) =>
      guarded(async () => {
        const [row] = await db
          .select()
          .from(policies)
          .where(and(eq(policies.mandateId, id), eq(policies.version, version)));
        return row === undefined ? null : toPolicy(row);
      }),

    updatePolicy: (id, changes, now) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const mandate = await lockMandate(tx, id);
          if (mandate.status === "REVOKED") {
            throw new MandateNotActiveError(id, mandate.status);
          }
          const current = await latestPolicy(tx, id);
          if (current === undefined) {
            throw new InvariantError(`mandate ${id} has no policy`);
          }
          const next = PolicySchema.safeParse({
            ...toPolicy(current),
            ...changes,
            version: current.version + 1,
          });
          if (!next.success) {
            throw new InvariantError(`invalid policy: ${next.error.message}`);
          }
          const [row] = await tx
            .insert(policies)
            .values({ mandateId: id, ...next.data, createdAt: now })
            .returning();
          return toPolicy(row as typeof policies.$inferSelect);
        }),
      ),
  };
}

export function pgAgents(db: Db): AgentRepo {
  return {
    create: (input) =>
      guarded(async () => {
        const [mandate] = await db.select().from(mandates).where(eq(mandates.id, input.mandateId));
        if (mandate === undefined) {
          throw new InvariantError(`mandate ${input.mandateId} does not exist`);
        }
        const [row] = await db
          .insert(agents)
          .values({
            id: input.id,
            mandateId: input.mandateId,
            name: input.name,
            apiKeyHash: input.apiKeyHash,
            apiKeyPrefix: input.apiKeyPrefix,
            createdAt: input.now,
          })
          .returning();
        return toAgent(row as typeof agents.$inferSelect);
      }),

    get: (id) =>
      guarded(async () => {
        const [row] = await db.select().from(agents).where(eq(agents.id, id));
        return row === undefined ? null : toAgent(row);
      }),

    authenticate: (apiKeyHash) =>
      guarded(async () => {
        const [row] = await db
          .select({ agent: agents, mandate: mandates })
          .from(agents)
          .innerJoin(mandates, eq(mandates.id, agents.mandateId))
          .where(and(eq(agents.apiKeyHash, apiKeyHash), isNull(agents.revokedAt)));
        if (row === undefined) {
          return null;
        }
        const policy = await latestPolicy(db, row.mandate.id);
        if (policy === undefined) {
          throw new InvariantError(`mandate ${row.mandate.id} has no policy`);
        }
        return {
          agent: toAgent(row.agent),
          mandate: toMandate(row.mandate),
          policy: toPolicy(policy),
        };
      }),

    listByMandate: (id) =>
      guarded(async () => {
        const rows = await db
          .select()
          .from(agents)
          .where(eq(agents.mandateId, id))
          .orderBy(agents.createdAt, agents.id);
        return rows.map(toAgent);
      }),

    revoke: (id, now) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const [row] = await tx.select().from(agents).where(eq(agents.id, id)).for("update");
          if (row === undefined) {
            throw new NotFoundError("agent", id);
          }
          if (row.revokedAt !== null) {
            return { value: toAgent(row), result: "unchanged" as const };
          }
          const [updated] = await tx
            .update(agents)
            .set({ revokedAt: now })
            .where(eq(agents.id, id))
            .returning();
          return {
            value: toAgent(updated as typeof agents.$inferSelect),
            result: "applied" as const,
          };
        }),
      ),
  };
}
