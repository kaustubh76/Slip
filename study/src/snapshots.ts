import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every response is kept on disk and committed, so the numbers can be recomputed by anyone without
 * a key and without spending a credit. The study is a measurement, and a measurement nobody can
 * repeat is an assertion.
 */

export interface Snapshot {
  slug: string;
  query: string;
  fetchedAt: string;
  /** sha256 of the response as it arrived, so a tampered snapshot is detectable. */
  rawHash: string;
  body: unknown;
}

export interface Manifest {
  /** When the sample was taken, for the pitch's "as measured on" line. */
  sampledAt: string;
  credits: number;
  queries: { slug: string; query: string; products: number }[];
}

export const SNAPSHOT_DIR = "snapshots";
const MANIFEST = "manifest.json";

export function hashOf(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function writeSnapshot(dir: string, snapshot: Snapshot): void {
  writeFileSync(join(dir, `${snapshot.slug}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function writeManifest(dir: string, manifest: Manifest): void {
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readManifest(dir: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(dir, MANIFEST), "utf8")) as Manifest;
  } catch {
    return null;
  }
}

/** Every snapshot in `dir`, in a fixed order so a report does not change between runs. */
export function readSnapshots(dir: string): Snapshot[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== MANIFEST)
    .sort();
  return files.map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Snapshot);
}

/** True when a snapshot's body still hashes to what was recorded. */
export function isIntact(snapshot: Snapshot): boolean {
  return hashOf(snapshot.body) === snapshot.rawHash;
}
