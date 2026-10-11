/**
 * `pnpm db:migrate` — applies pending migrations to DATABASE_URL (postgres:// or pglite://).
 * Safe to run repeatedly: applied migrations are recorded in drizzle.__drizzle_migrations.
 */
import { openDatabase } from "../client.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || url.trim() === "") {
  console.error("DATABASE_URL is not set (postgres://… or pglite://<dir>)");
  process.exit(1);
}

const handle = await openDatabase(url);
try {
  const started = Date.now();
  await handle.migrate();
  console.log(`migrations applied to ${handle.kind} database in ${Date.now() - started} ms`);
} finally {
  await handle.close();
}
