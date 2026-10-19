import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunRecord } from "./grade.js";
import type { RunOutcome } from "./run.js";

/**
 * Every run is committed, as §6.2 requires: the prompt version, the tool count, the choice and the
 * agent's own account of it. The report is computed from these files, so the numbers in the pitch
 * can be recomputed by anyone, with no key and no model call.
 */

export const RUN_DIR = "runs";

export interface StoredRun extends RunRecord {
  said: string;
}

export function writeRun(dir: string, outcome: RunOutcome): void {
  const { record, said } = outcome;
  const folder = join(dir, record.agent, record.condition);
  mkdirSync(folder, { recursive: true });
  const stored: StoredRun = { ...record, said };
  writeFileSync(join(folder, `${record.errandId}.json`), `${JSON.stringify(stored, null, 2)}\n`);
}

/** Every stored run, in a fixed order so a report does not change between runs. */
export function readRuns(dir: string): StoredRun[] {
  const runs: StoredRun[] = [];
  for (const agent of dirs(dir)) {
    for (const condition of dirs(join(dir, agent))) {
      const folder = join(dir, agent, condition);
      for (const file of readdirSync(folder)
        .filter((name) => name.endsWith(".json"))
        .sort()) {
        runs.push(JSON.parse(readFileSync(join(folder, file), "utf8")) as StoredRun);
      }
    }
  }
  return runs;
}

function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
