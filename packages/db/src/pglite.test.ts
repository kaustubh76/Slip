import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

describe("a PGlite database on disk", () => {
  it("is created with the directories above it on its first run", async () => {
    const root = await mkdtemp(join(tmpdir(), "slip-pglite-"));
    try {
      const dir = join(root, "not", "there", "yet", "slip");
      const handle = await openDatabase(`pglite://${dir}`);
      await handle.migrate();
      await handle.close();
      expect((await stat(dir)).isDirectory()).toBe(true);
      // And it opens again, already migrated.
      const again = await openDatabase(`pglite://${dir}`);
      await again.migrate();
      await again.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
