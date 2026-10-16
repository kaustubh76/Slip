import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

export type Schema = typeof schema;

/** The driver-independent Drizzle database every repository is written against. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export type DatabaseKind = "postgres" | "pglite";

export interface DatabaseHandle {
  db: Db;
  kind: DatabaseKind;
  /** Applies every pending migration in one transaction; a no-op when up to date. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * `packages/db/drizzle`, resolved the same way from `src/` and from `dist/`. Joined from the
 * module's own directory rather than written as `new URL("../drizzle", import.meta.url)`, which a
 * bundler reads as a static asset reference and then fails to resolve (the web app bundles this
 * package, D42).
 */
export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export interface OpenOptions {
  /** Pool size for postgres.js. Default 10. */
  maxConnections?: number;
}

/**
 * Opens a database from a URL:
 * - `postgres://…` / `postgresql://…` — postgres.js pool (production, docker compose).
 * - `pglite://memory` — in-process Postgres in memory (tests, demos).
 * - `pglite://<path>` — in-process Postgres persisted to a directory (local dev, no Docker).
 *
 * PGlite is loaded only when asked for, so production never pays for the WASM bundle.
 */
export async function openDatabase(
  url: string,
  options: OpenOptions = {},
): Promise<DatabaseHandle> {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, {
      max: options.maxConnections ?? 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
    const db = drizzle({ client, schema });
    return {
      db: db as unknown as Db,
      kind: "postgres",
      migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.end({ timeout: 5 }),
    };
  }

  if (url.startsWith("pglite://")) {
    const location = url.slice("pglite://".length);
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = location === "" || location === "memory" ? new PGlite() : new PGlite(location);
    const db = drizzle({ client, schema });
    return {
      db: db as unknown as Db,
      kind: "pglite",
      migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.close(),
    };
  }

  throw new Error(
    `unsupported database URL: expected postgres://, postgresql:// or pglite://, got ${url.split(":")[0]}:`,
  );
}
