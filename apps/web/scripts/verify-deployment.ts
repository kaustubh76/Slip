import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { chromium } from "@playwright/test";

/**
 * `pnpm verify:deployment [https://host]` — drives a real deployment and reports which wires carry
 * current, rather than which were configured.
 *
 *   pnpm verify:deployment                        # the production address below
 *   pnpm verify:deployment https://slip.example   # anywhere else
 *
 * `pnpm doctor:keys` asks the outside services what they think of this deployment's credentials and
 * grants. It cannot tell you whether a *write* works, because it writes nothing: after a deploy with
 * green credentials, a database with no tables, a session cookie issued without `Secure`, or an
 * agent key that resolves to nothing would all look exactly like a working site. This starts an
 * owner, takes a real PayPal setup token, issues a real agent key and speaks MCP with it.
 *
 * **It stops where the sandbox buyer's consent begins.** `checkout` is refused with
 * `MANDATE_NOT_ACTIVE` until somebody approves the vault (`packages/app/src/checkout/gate.ts`), so
 * this proves every wire *up to* a purchase and then says so plainly. The approval link it prints
 * is the one that finishes the job — and because the owner it makes lives on the deployment rather
 * than in a local PGlite directory, approving it leaves a mandate the deployment can charge.
 *
 * **It costs nothing.** A checkout prices from Channel3's free product-detail endpoint, and search —
 * the one call that spends a credit — is never made: the deployment does not even offer the tool
 * unless `SLIP_AGENT_SEARCH` is set (D106), and this asserts that rather than relying on it.
 *
 * It leaves a real owner behind each run. That is the point and not a leak: nothing can prove a
 * sign-up works without signing up.
 *
 * No credential is printed — not the key it issues, not the passphrase it sets, not a prefix of
 * either.
 */

const DEFAULT_BASE = "https://slip-two-chi.vercel.app";

/** A cold serverless instance plus a first query against a fresh Postgres connection. */
const PATIENCE_MS = 90_000;

type State = "ok" | "absent" | "refused" | "FAILED";

interface Line {
  what: string;
  state: State;
  detail: string;
}

const lines: Line[] = [];
const say = (what: string, state: State, detail: string) => {
  lines.push({ what, state, detail });
};

const base = (process.argv[2] ?? DEFAULT_BASE).replace(/\/+$/, "");
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** A fresh owner per run, and a passphrase that exists only in this process. */
const address = `verify-${stamp}@slip.invalid`;
const passphrase = `verify ${stamp} ${Math.random().toString(36).slice(2)}`;

let approval: string | null = null;
let mandateId: string | null = null;
let agentKey: string | null = null;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ baseURL: base });
  page.setDefaultTimeout(PATIENCE_MS);

  // 1 · An owner, a permission, and PayPal's own approval link.
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#start-email").fill(address);
  await page.locator("#start-password").fill(passphrase);
  await Promise.all([
    page.waitForURL((url) => url.href !== `${base}/sign-in`, { timeout: PATIENCE_MS }),
    page.getByRole("button", { name: /Start with PayPal/ }).click(),
  ]);
  const landed = new URL(page.url());
  if (landed.hostname.endsWith("paypal.com")) {
    // The real thing: Slip handed the browser to PayPal, which is what a stand-in cannot do.
    approval = landed.href;
    say("owner started", "ok", `PayPal took the browser to ${landed.hostname}`);
  } else {
    say(
      "owner started",
      landed.pathname === "/mandate" ? "ok" : "FAILED",
      `landed on ${landed.pathname} rather than at PayPal — payment may be a stand-in here`,
    );
  }

  // 2 · The permission, read back from the deployment's own database.
  const summary = await page.request.get(`${base}/api/v1/mandate`);
  if (summary.ok()) {
    const body = (await summary.json()) as { id?: string; status?: string };
    mandateId = body.id ?? null;
    say(
      "permission stored",
      body.id === undefined ? "FAILED" : "ok",
      `${body.status ?? "unknown"} · ${body.id ?? "no id"}`,
    );
  } else {
    say("permission stored", "FAILED", `GET /api/v1/mandate answered ${summary.status()}`);
  }

  // 3 · A real agent key, which Slip shows exactly once.
  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  const main = page.getByRole("main");
  const where = new URL(page.url()).pathname;
  if (where !== "/agents") {
    // Worth separating from a missing control: this is the session not surviving the trip.
    say("agent key issued", "FAILED", `/agents redirected to ${where} — no session here`);
  } else {
    const name = page.locator("#agent-name");
    await name.waitFor({ state: "visible", timeout: PATIENCE_MS });
    await name.fill(`verify-${stamp}`);
    const issue = page.getByRole("button", { name: /Issue a key/ });
    // A disabled button makes `click` wait for the whole timeout and then say only "timeout", so
    // the state is read first and reported as what it is.
    if (await issue.isDisabled()) {
      say("agent key issued", "FAILED", `the button stayed disabled with the name filled in`);
    } else {
      await issue.click();
      const shown = main.locator(".slip-key").first();
      try {
        await shown.waitFor({ timeout: PATIENCE_MS });
        agentKey = (await shown.textContent())?.trim() ?? null;
      } catch {
        agentKey = null;
      }
      say(
        "agent key issued",
        agentKey?.startsWith("slip_live_") === true ? "ok" : "FAILED",
        agentKey === null
          ? `no key appeared · page said: ${first(await main.innerText())}`
          : "shown once, and not printed here",
      );
    }
  }
} catch (error) {
  say("the owner flow", "FAILED", message(error));
} finally {
  await browser.close();
}

// 4 · MCP, with the key that was just issued.
if (agentKey !== null) {
  const client = new Client({ name: "slip-verify-deployment", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${agentKey}` } },
      }),
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    say("MCP handshake", "ok", `${names.length} tools: ${names.join(", ")}`);
    // Not a nicety: the tool is the only thing an agent can call that spends money (D106).
    say(
      "search_products",
      names.includes("search_products") ? "ok" : "absent",
      names.includes("search_products")
        ? "offered — SLIP_AGENT_SEARCH is set, so each search spends a Channel3 credit"
        : "not offered, so no agent here can spend a credit",
    );

    // 5 · The gate. A purchase needs an approved vault, so a refusal is the correct answer and
    // proves the whole chain behind it: key → agent → permission → gate.
    const answer = (await client.callTool({
      name: "checkout",
      arguments: {
        product_id: process.env["CHANNEL3_TEST_PRODUCT_ID"] ?? "t1SLQyj",
        chosen_offer_url: "https://example.invalid/offer",
        reason: "verifying this deployment's wiring",
      },
    })) as { isError?: boolean; content?: { text?: string }[] };
    const text = answer.content?.map((part) => part.text ?? "").join(" ") ?? "";
    const refused = /MANDATE_NOT_ACTIVE|not active|revoked/i.test(text);
    say(
      "checkout",
      refused ? "refused" : answer.isError === true ? "FAILED" : "ok",
      refused
        ? "MANDATE_NOT_ACTIVE — correct, and only the vault approval is missing"
        : first(text),
    );
    await client.close();
  } catch (error) {
    say("MCP handshake", "FAILED", message(error));
  }
}

process.stdout.write(render());
process.exit(lines.some((line) => line.state === "FAILED") ? 1 : 0);

function render(): string {
  const width = Math.max(...lines.map((line) => line.what.length), 18);
  const out = [
    `Slip deployment check — ${base}`,
    "",
    ...lines.map((line) => `  ${line.what.padEnd(width)}  ${line.state.padEnd(8)} ${line.detail}`),
    "",
  ];
  const failed = lines.filter((line) => line.state === "FAILED");
  if (failed.length > 0) {
    out.push(
      `${failed.length} of ${lines.length} did not work: ${failed.map((f) => f.what).join(", ")}`,
    );
  } else {
    out.push("Every wire that can work without a buyer's consent does.");
  }
  if (approval !== null) {
    out.push(
      "",
      "One step is left, and it is a person's: approve the vault signed in as a **sandbox buyer**",
      "(PayPal dashboard → Testing tools → Sandbox accounts → a Personal account).",
      `  ${approval}`,
      ...(mandateId === null
        ? []
        : [
            `Then: PAYPAL_TEST_VAULT_ID=$(pnpm -s paypal:vault-id ${mandateId}) pnpm test:live:paypal`,
          ]),
    );
  }
  return `${out.join("\n")}\n`;
}

function first(text: string): string {
  const line = text.split("\n").find((part) => part.trim() !== "") ?? "(nothing said)";
  return line.length > 96 ? `${line.slice(0, 95)}…` : line;
}

function message(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? String(error)) : String(error);
}
