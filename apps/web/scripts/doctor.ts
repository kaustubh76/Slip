import { fileURLToPath } from "node:url";
import { exitCodeFor, probeAll, renderCheckup } from "./credentials";

/**
 * `pnpm doctor:keys` — asks each outside service whether the credential this deployment holds
 * works.
 *
 *   pnpm doctor:keys
 *
 * Named `doctor:keys` and not `doctor`, because pnpm has a built-in `doctor` that would shadow it
 * silently: the script never runs and the exit code is pnpm's.
 *
 * Free, and no part of a credential is printed. Run it before a demo: a refused credential is
 * invisible from inside the application, because every adapter folds one into the same no-answer a
 * slow service produces, and the rules then hold the purchase for the owner (D92, SPEC §19.6).
 *
 * It also asks what PayPal has *granted* this application, which is a quieter question than
 * whether a key works: *Transaction Search* is off by default, and without it the daily reconcile
 * cannot read PayPal's records at all and will never say so (`search.ts` reads a refusal as "not
 * known", which is the only safe reading and a silent one).
 *
 * Exit 0 when everything configured was accepted, 1 when any of it was refused — a credential or a
 * feature — 2 when there is no `apps/web/.env.local` to read. A variable that is not set is
 * reported and is not a failure: "real prices, simulated payment" is a state Slip is meant to be
 * in.
 */

/** Long enough for three cold connections, short enough to be worth running before a demo. */
const DEADLINE_MS = 20_000;

const ENV_FILE = fileURLToPath(new URL("../.env.local", import.meta.url));
loadEnv(ENV_FILE);

/** The keys live in apps/web/.env.local; on a fresh clone there is no such file yet. */
function loadEnv(file: string): void {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    console.error(`No ${file}. Copy .env.example there and fill in the values first.`);
    process.exit(2);
  }
}

const checkup = await probeAll(process.env, AbortSignal.timeout(DEADLINE_MS));
process.stdout.write(renderCheckup(checkup));
process.exit(exitCodeFor(checkup.credentials, checkup.capabilities));
