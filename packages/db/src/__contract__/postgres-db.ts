import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { type DatabaseHandle, openDatabase } from "../client.js";

/**
 * A throwaway database on the server named by `SLIP_TEST_DATABASE_URL`, migrated and dropped
 * afterwards. Each test file gets its own, so files run in parallel without sharing state.
 */
export async function createTestDatabase(
  adminUrl: string,
  options: { maxConnections?: number } = {},
): Promise<{ handle: DatabaseHandle; drop(): Promise<void> }> {
  const name = `slip_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const handle = await openDatabase(url.toString(), {
    maxConnections: options.maxConnections ?? 10,
  });
  await handle.migrate();
  return {
    handle,
    async drop() {
      await handle.close();
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}

export const TEST_DATABASE_URL = process.env["SLIP_TEST_DATABASE_URL"];
