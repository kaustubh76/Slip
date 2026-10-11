import { describeSqlGuards } from "./__contract__/sql-guards.js";
import { describeStoreContract } from "./__contract__/store-contract.js";
import { openDatabase } from "./client.js";
import { VaultCipher } from "./crypto.js";
import { createPgStore } from "./pg/store.js";

// In-process Postgres (PGlite, Postgres 18): the full contract and the database guards on every
// `pnpm test`, no Docker needed. Concurrency needs real connections: see postgres.test.ts.

describeStoreContract("PGlite", async () => {
  const handle = await openDatabase("pglite://memory");
  await handle.migrate();
  return { store: createPgStore(handle.db, VaultCipher.random()), close: () => handle.close() };
});

describeSqlGuards("PGlite", async () => {
  const handle = await openDatabase("pglite://memory");
  await handle.migrate();
  return { handle, close: () => handle.close() };
});
