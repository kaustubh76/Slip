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

/**
 * The runs already on disk for this prompt version, as `agent\u0000condition\u0000errandId` keys.
 *
 * The prompt version is the whole point of the filter. Skipping an errand because a file exists
 * would quietly mix answers to two different prompts into one table, and the report names only one
 * prompt in its header — so a run recorded under an older prompt is not something to keep, it is
 * something to pay for again.
 */
export function recordedFor(dir: string, promptVersion: string): Set<string> {
  const keys = new Set<string>();
  for (const run of readRuns(dir)) {
    if (run.promptVersion === promptVersion) {
      keys.add(`${run.agent}\u0000${run.condition}\u0000${run.errandId}`);
    }
  }
  return keys;
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
