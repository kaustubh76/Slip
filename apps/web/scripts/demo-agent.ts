import { runAgent } from "./agent";

/**
 * `pnpm demo:agent --errand <name> [--url http://localhost:3000]`, with the key from the /demo
 * console in SLIP_AGENT_KEY. Without --errand it lists the errands. The key is read from the
 * environment only, never an argument, so it stays out of the process list.
 */

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? null);
};

const key = process.env.SLIP_AGENT_KEY?.trim() ?? "";
if (key === "") {
  console.error(
    "Set SLIP_AGENT_KEY to a key from the demo console (/demo → Issue a key for the script).",
  );
  process.exit(2);
}

const outcome = await runAgent({
  base: flag("url") ?? process.env.SLIP_BASE_URL ?? "http://localhost:3000",
  key,
  errand: flag("errand"),
  fetch,
  now: () => performance.now(),
});
console.log(outcome.lines.join("\n"));
process.exit(outcome.code);
