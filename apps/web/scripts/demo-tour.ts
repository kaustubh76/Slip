import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

/**
 * `pnpm demo:tour [base]` — drives a running demo and writes a captioned walkthrough of the owner's
 * interface doing things, as one self-contained HTML page.
 *
 *   DATABASE_URL= SLIP_DEMO=1 SLIP_BASE_URL=http://localhost:3200 pnpm exec next start -p 3200
 *   pnpm demo:tour http://localhost:3200
 *
 * Why it exists: every other check in this repository proves the product to a *terminal*. None of
 * them shows anybody the interface, and the deployment that would — the demo, with its thirty
 * seeded receipts and its four waiting holds — is the one nobody has hosted. So this is the
 * substitute for a demo URL, and a script rather than a handful of screenshots because the UI will
 * change and the tour should be regenerable rather than re-taken.
 *
 * **It shows the interface and the state machine. It shows nothing about real money.** Demo mode
 * forces the stand-ins for Channel3, PayPal and the steering check whatever keys are set
 * (`resolveServices`), which is what makes the tour safe to run and what the page says at the top.
 *
 * Screenshots land in `test-results/tour/`, which is already ignored, so no binaries reach the
 * repository.
 */

const base = (process.argv[2] ?? "http://localhost:3200").replace(/\/+$/, "");
const outDir = fileURLToPath(new URL("../test-results/tour/", import.meta.url));
mkdirSync(outDir, { recursive: true });

interface Shot {
  file: string;
  title: string;
  caption: string;
}

const shots: Shot[] = [];
let n = 0;
/** Set when a step threw, so the sheet says the tour is partial instead of looking complete. */
let failed: string | null = null;

async function shot(page: Page, title: string, caption: string, fullPage = false): Promise<void> {
  n += 1;
  const file = `${String(n).padStart(2, "0")}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
  await page.screenshot({ path: join(outDir, file), fullPage });
  shots.push({ file, title, caption });
  process.stdout.write(`  ${file}\n`);
}

/** Demo PayPal takes 2 s by default, so the in-flight states are reachable rather than theoretical. */
const SETTLE_MS = 3_500;

/**
 * `networkidle` is the wrong wait here: the owner's pages poll a stamp to know what changed, so the
 * network never goes idle and the wait times out on a page that is already drawn. Wait for the main
 * landmark, then let the first paint settle.
 */
async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.getByRole("main").first().waitFor({ state: "visible" });
  await page.waitForTimeout(700);
}

const browser = await chromium.launch();
const page = await browser.newPage({ baseURL: base, viewport: { width: 1280, height: 920 } });
page.setDefaultTimeout(60_000);

try {
  // 1 · The front door. The only page that renders with no session, no database and no keys, which
  // is why it is also the deployment's health check.
  await visit(page, "/sign-in");
  await shot(
    page,
    "The front door",
    "`/sign-in`. An owner can start with PayPal, or open a throwaway demo desk. This is the one page that renders with no session, no database and no key — which is why it is the deployment's health check.",
  );

  // 2 · A desk: an owner, a permission in force, three agents, thirty receipts.
  await page.getByRole("button", { name: "Open a demo desk →" }).click();
  await page.waitForURL("**/receipts");
  await page.getByRole("region", { name: "Receipts" }).waitFor();
  await shot(
    page,
    "The Till Roll",
    "`/receipts`. Every receipt this desk has, newest first, with a date separator between days and an agent filter filled from who actually bought. The left rail counts what happened — checked, paid, rejected, held, and how often the agent's pick was not the cheapest. Each row says what Slip decided and why; the roll reads top to bottom like a till receipt.",
    true,
  );

  // 3 · One receipt in full: what an owner is actually shown about a decision.
  const roll = page.getByRole("region", { name: "Receipts" });
  await roll.getByRole("listitem").first().getByRole("link").first().click();
  await page.waitForURL(/\/receipts\//);
  await shot(
    page,
    "One receipt, in full",
    "A single receipt. The offer the agent chose, every offer Slip compared it against, the owner's limits as they stood at that moment, and the rule that decided it. `Behind the receipt` opens the evidence rather than summarising it.",
    true,
  );

  // 4 · The holds, which is the half of the product that exists because a check can say "ask them".
  await visit(page, "/holds");
  await shot(
    page,
    "Holds waiting",
    "`/holds`. Two purchases waiting on the owner: $239 against a $200 cap, and one where no fresh prices could be compared. Neither is charged — the first is *authorized*, reserved and not taken, with 47h 59m left to decide, and no decision releases it on its own. Below the tray are the holds already decided: approved, declined, released.",
    true,
  );

  // 5 · Approving one. The dialog is the point: it states the amount before anything moves.
  const approve = page.getByRole("button", { name: "Approve…" }).first();
  if ((await approve.count()) > 0) {
    await approve.click();
    await page.getByRole("dialog").waitFor();
    await shot(
      page,
      "Approving a hold",
      "The confirmation. It names the amount before anything is charged, and the button says what it will do rather than `OK`. Declining releases the authorization instead of charging it.",
    );
    const confirm = page
      .getByRole("dialog")
      .getByRole("button", { name: /^Approve/ })
      .last();
    await confirm.click();
    await page.waitForTimeout(SETTLE_MS);
    await shot(
      page,
      "After approving",
      "The same tray once PayPal has been asked. Demo PayPal takes two seconds on purpose, so the in-flight states an owner would otherwise never see — `CAPTURING`, `INITIATED` — are visible here rather than theoretical.",
      true,
    );
  }

  // 6 · The limits, which every receipt above was decided against.
  await visit(page, "/limits");
  await shot(
    page,
    "The limits",
    "`/limits`. The owner's policy: what an agent may spend, per purchase and per day, and how far above the cheapest offer it may go. Changing it writes a new version rather than editing the old one, so a receipt is always readable against the limits it was decided under.",
    true,
  );

  // 7 · The agents, and how one is pointed at Slip.
  await visit(page, "/agents");
  await shot(
    page,
    "The agents",
    "`/agents`. A card per agent with its own report card, and the panel that says where to point one: the MCP endpoint, the one command a client takes, and the same thing as a config file. A key is shown once and stored as a hash.",
    true,
  );

  // 8 · The permission slip and the kill switch.
  await visit(page, "/mandate");
  await shot(
    page,
    "The permission",
    "`/mandate`. The permission slip: what PayPal has been asked to save, and the kill switch. Revoking stops every agent at once and deletes the saved payment method — the thing an owner wants to be one click when they want it at all.",
    true,
  );

  // 9 · The console: make something happen, with PayPal misbehaving on purpose.
  await visit(page, "/demo");
  await shot(
    page,
    "The console",
    "`/demo`. The console sends this desk's own agent shopping, and decides how PayPal answers — properly, slowly, declining, or leaving the payment pending. The point of the demo is the cases a desk that only ever succeeds never reaches.",
    true,
  );

  await page.getByLabel("When Slip pays").selectOption("times-out");
  await page.getByRole("button", { name: "Buys the cheapest desk lamp" }).click();
  await page.waitForTimeout(SETTLE_MS);
  await shot(
    page,
    "PayPal times out",
    "The console with PayPal set to time out, beside the table of every call the stand-in was asked for and what it answered — captured, authorized, voided, declined, pending. The errand is sent from here; what it became is the next screen. Note the nav: `Holds 1`, down from two, because the hold was approved a moment ago.",
    true,
  );

  await visit(page, "/receipts");
  await shot(
    page,
    "The new receipt",
    "The errand has arrived at the top as `shopper-2`, reading `INITIATED — sending the order to PayPal. Nothing is final yet.` That is the in-flight state a desk which only ever succeeds never shows. The checked counter has gone up by one, `WAITING FOR YOU` has fallen by a hold, and the $239 hold now reads `CAPTURED — paid at Store K`. Three state changes, none of them staged.",
    true,
  );

  // 10 · Every state of the kit, in one page.
  await visit(page, "/kit");
  await shot(
    page,
    "Every state of the kit",
    "`/kit`. Every component in every state it can reach, including the ones a happy path never shows: the four ways a page says it could not read the receipts, a stamp per outcome, a hold that **expired** undecided, an authorization **released**, an empty roll with nothing checked yet, and a receipt spelling out the commission that made the agent's pick the dearer one. Gated behind demo mode — on a real deployment it would be a page of invented receipts beside real ones.",
    true,
  );

  // 11 · SlipBench.
  await visit(page, "/bench");
  await shot(
    page,
    "SlipBench",
    "`/bench`. What the benchmark measured about agents shopping with and without Slip in front of them, from the run's own data rather than retyped.",
    true,
  );

  // 12 · The other theme, since it is half the look.
  await page.emulateMedia({ colorScheme: "dark" });
  await visit(page, "/receipts");
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "dark";
  });
  await page.waitForTimeout(400);
  await shot(
    page,
    "The same roll, dark",
    "The roll again in dark mode. Both themes are built from the same tokens, so nothing is a second stylesheet that drifts — and the axe pass in CI runs over every page in both.",
    true,
  );
} catch (error) {
  failed = error instanceof Error ? (error.message.split("\n")[0] ?? String(error)) : String(error);
  process.stdout.write(`\n  stopped early: ${failed}\n`);
} finally {
  await browser.close();
}

writeFileSync(join(outDir, "index.html"), sheet(), "utf8");
process.stdout.write(`\n  ${shots.length} shots → ${join(outDir, "index.html")}\n`);

function sheet(): string {
  const figures = shots
    .map((s) => {
      const data = readFileSync(join(outDir, s.file)).toString("base64");
      return `<figure>
      <h2>${s.title}</h2>
      <img alt="${s.title}" src="data:image/png;base64,${data}" />
      <figcaption>${s.caption.replace(/`([^`]+)`/g, "<code>$1</code>")}</figcaption>
    </figure>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Slip, seen</title>
<style>
  :root { --ink:#1a1a1a; --paper:#faf8f5; --rule:#d8d2c8; --quiet:#6b645a; }
  @media (prefers-color-scheme: dark) { :root { --ink:#ece7df; --paper:#17181a; --rule:#34363a; --quiet:#9a948a; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 16px 64px; background:var(--paper); color:var(--ink);
    font:16px/1.55 ui-serif, Georgia, serif; }
  main { max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .lede { color: var(--quiet); margin: 0 0 24px; }
  .warn { border:1px solid var(--rule); border-left:4px solid var(--ink); padding:14px 16px;
    margin: 0 0 32px; background: transparent; }
  figure { margin: 0 0 44px; }
  h2 { font-size: 18px; margin: 0 0 8px; font-family: ui-sans-serif, system-ui, sans-serif; }
  img { width:100%; height:auto; display:block; border:1px solid var(--rule); border-radius:3px; }
  figcaption { color: var(--quiet); margin-top: 10px; font-size: 15px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  footer { color: var(--quiet); border-top:1px solid var(--rule); padding-top:16px; font-size:14px; }
</style></head>
<body><main>
  <h1>Slip, seen</h1>
  <p class="lede">The owner's interface, driven rather than described. ${shots.length} steps, in order.</p>
  ${
    failed === null
      ? ""
      : `<div class="warn"><strong>This tour is incomplete.</strong> A step failed and the rest were
    not taken: <code>${failed}</code>. What is below was captured before that point.</div>`
  }
  <div class="warn">
    <strong>This is demo mode, and it shows nothing about real money.</strong> Demo mode forces the
    stand-ins for Channel3, PayPal and the steering check whatever keys are set, which is what makes
    this safe to run on a laptop. What it shows faithfully is the interface and the state machine —
    every screen, and the states a happy path never reaches. The real-money path is proven
    separately, and its last step is still a sandbox buyer's approval.
  </div>
  ${figures}
  <footer>Generated by <code>pnpm demo:tour</code> against <code>${base}</code>. Re-run it after any
  UI change rather than re-taking screenshots by hand.</footer>
</main></body></html>
`;
}
