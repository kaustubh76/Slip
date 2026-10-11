import { describe, it } from "vitest";
import { describeConcurrency } from "./__contract__/concurrency.js";
import { createTestDatabase, TEST_DATABASE_URL } from "./__contract__/postgres-db.js";
import { describeSqlGuards } from "./__contract__/sql-guards.js";
import { describeStoreContract } from "./__contract__/store-contract.js";
import { VaultCipher } from "./crypto.js";
import { createPgStore } from "./pg/store.js";

// Real Postgres (docker compose: `pnpm db:up`, then `pnpm test:pg`). Same contract and guards as
// PGlite, plus the races only multiple connections can produce.

if (TEST_DATABASE_URL === undefined || TEST_DATABASE_URL === "") {
  describe("real Postgres", () => {
    it.skip("skipped: set SLIP_TEST_DATABASE_URL (pnpm db:up && pnpm test:pg)", () => {});
  });
} else {
  const adminUrl = TEST_DATABASE_URL;

  describeStoreContract("Postgres", async () => {
    const db = await createTestDatabase(adminUrl);
    return { store: createPgStore(db.handle.db, VaultCipher.random()), close: db.drop };
  });

  describeSqlGuards("Postgres", async () => {
    const db = await createTestDatabase(adminUrl);
    return { handle: db.handle, close: db.drop };
  });

  describeConcurrency("Postgres", async () => {
    const db = await createTestDatabase(adminUrl, { maxConnections: 25 });
    return { store: createPgStore(db.handle.db, VaultCipher.random()), close: db.drop };
  });
}
