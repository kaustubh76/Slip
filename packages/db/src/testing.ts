import { PGlite } from "@electric-sql/pglite";
import type { Store } from "@slip/domain";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, MIGRATIONS_FOLDER } from "./client.js";
import { VaultCipher } from "./crypto.js";
import { createPgStore } from "./pg/store.js";
import * as schema from "./schema.js";

export interface FreshDatabase {
  store: Store;
  db: Db;
  close(): Promise<void>;
}

/**
 * An in-process Postgres migrated once. `fresh()` clones it, so each test gets its own migrated,
 * isolated database — about four times faster than migrating a new one — and nothing one test
 * writes (a stuck payment, an unprocessed webhook) is seen by the resolver in another.
 */
export class PgliteTemplate {
  readonly #base: PGlite;

  private constructor(base: PGlite) {
    this.#base = base;
  }

  static async create(): Promise<PgliteTemplate> {
    const base = new PGlite();
    await migrate(drizzle({ client: base, schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    return new PgliteTemplate(base);
  }

  async fresh(): Promise<FreshDatabase> {
    const client = (await this.#base.clone()) as PGlite;
    const db = drizzle({ client, schema }) as unknown as Db;
    return { db, store: createPgStore(db, VaultCipher.random()), close: () => client.close() };
  }

  close(): Promise<void> {
    return this.#base.close();
  }
}
