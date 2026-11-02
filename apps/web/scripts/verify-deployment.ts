import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { chromium } from "@playwright/test";
import { createChannel3Offers } from "@slip/offers";

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
 * owner, takes a real PayPal setup token, issues a real agent key, and then exercises every surface
 * the deployment advertises — both agent paths, every owner read, the redirect leg PayPal uses, and
 * the credential that is the only way back in.
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

/** The owner read API, every route an owner's pages poll. `mandate` is read separately for its id. */
const OWNER_READS = ["stamp", "receipts", "policies", "holds", "agents"] as const;

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

// The keys live beside the app, as every other script here reads them. Absent is not a fault:
// without one the checkout below carries a placeholder offer and says so.
try {
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const base = (process.argv[2] ?? DEFAULT_BASE).replace(/\/+$/, "");
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** A fresh owner per run, and a passphrase that exists only in this process. */
const address = `verify-${stamp}@slip.invalid`;
const passphrase = `verify ${stamp} ${Math.random().toString(36).slice(2)}`;

let approval: string | null = null;
let mandateId: string | null = null;
let agentKey: string | null = null;
/** MCP's answer to a checkout, so the REST path can be held to the same one. */
let mcpRefusal: string | null = null;
/** True once a sandbox buyer has approved the vault, which is what lets a checkout pay. */
let mandateActive = false;
/** The receipt a purchase returned, so it can be read back and looked up at PayPal. */
let receiptId: string | null = null;
/** A real offer for the test product, so a run after approval is a purchase and not a rejection. */
let offerUrl = "https://example.invalid/offer";
let offerIsReal = false;

/**
 * A **sandbox** buyer, so the approval PayPal insists a person performs can be performed here.
 * Read from the gitignored `apps/web/.env.local` and never printed: `fill()` keeps the value in
 * memory, and this script starts no Playwright trace, video or screenshot — a failure screenshot of
 * a login form is how a password ends up in an artifact nobody meant to keep.
 */
const buyerEmail = process.env["PAYPAL_SANDBOX_BUYER_EMAIL"]?.trim() ?? "";
const buyerPassword = process.env["PAYPAL_SANDBOX_BUYER_PASSWORD"] ?? "";

const productId = process.env["CHANNEL3_TEST_PRODUCT_ID"] ?? "t1SLQyj";
const channel3Key = process.env["CHANNEL3_API_KEY"]?.trim() ?? "";
if (channel3Key !== "") {
  // Product detail, which is free — the paid call is search, and nothing here makes it (D106). An
  // agent handed a product id does exactly this to find an offer worth asking to pay for.
  const found = await createChannel3Offers({ apiKey: channel3Key }).fetchProduct(
    productId,
    AbortSignal.timeout(30_000),
  );
  const cheapest = found.ok
    ? [...found.product.offers]
        .filter((offer) => offer.priceCents !== null)
        .sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0))[0]
    : undefined;
  if (cheapest !== undefined) {
    offerUrl = cheapest.url;
    offerIsReal = true;
  }
  say(
    "a real offer to buy",
    offerIsReal ? "ok" : "absent",
    offerIsReal
      ? `the cheapest of ${found.ok ? found.product.offers.length : 0} offers for ${productId}, so a run after approval buys`
      : `no priced offer for ${productId}${found.ok ? "" : ` (${found.reason})`} — a run after approval would be rejected, not a purchase`,
  );
} else {
  say(
    "a real offer to buy",
    "absent",
    "no CHANNEL3_API_KEY here, so the checkout below carries a placeholder offer url",
  );
}

// ── The owner, in a browser, because sign-up and key issue are server actions ────────────────────

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ baseURL: base });
  page.setDefaultTimeout(PATIENCE_MS);

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

  // Every route the owner's pages poll, against a brand-new owner. The empty case is the point:
  // this owner has no receipts, and an aggregate over no rows is exactly where a Postgres
  // deployment can differ from the PGlite every local test runs on.
  const reads = await Promise.all(
    OWNER_READS.map(async (route) => {
      const got = await page.request.get(`${base}/api/v1/${route}`);
      return { route, status: got.status() };
    }),
  );
  const bad = reads.filter((r) => r.status !== 200);
  say(
    "owner read API",
    bad.length === 0 ? "ok" : "FAILED",
    bad.length === 0
      ? `${reads.length} of ${reads.length} answered 200 with nothing recorded yet: ${OWNER_READS.join(", ")}`
      : bad.map((r) => `${r.route} answered ${r.status}`).join("; "),
  );

  // The address Slip hands PayPal, which the owner's browser lands on after approving. It is the
  // leg the user's own click will take, and nothing has ever taken it on this deployment: if
  // `publicBaseUrl` or the session were wrong here they would approve and meet an error page.
  // Safe before approval — PayPal says the token is not approved and the route redirects anyway.
  if (mandateId !== null) {
    await page.goto(`/mandates/${mandateId}/return`, { waitUntil: "domcontentloaded" });
    const after = new URL(page.url());
    say(
      "PayPal's return leg",
      after.pathname === "/mandate" ? "ok" : "FAILED",
      after.pathname === "/mandate"
        ? `lands on /mandate${after.search} — the owner's approval will arrive here`
        : `went to ${after.pathname}, which is not where an approving owner should land`,
    );
  }

  // The one step PayPal insists a person takes. It cannot be done through the API — this app's
  // token carries no `sandbox` or `account` scope and `/v1/sandbox/accounts` answers 404 — so a
  // browser signs in as a sandbox buyer instead. The *same* context, because PayPal redirects to
  // `/mandates/<id>/return`, which reads the owner's session.
  if (approval !== null && buyerEmail !== "" && buyerPassword !== "") {
    try {
      await page.goto(approval, { waitUntil: "domcontentloaded" });
      const email = page.locator("#email");
      if ((await email.count()) > 0) {
        await email.fill(buyerEmail);
        const next = page.locator("#btnNext");
        if ((await next.count()) > 0 && (await next.isVisible())) {
          await next.click();
        }
      }
      const password = page.locator("#password");
      await password.waitFor({ state: "visible", timeout: PATIENCE_MS });
      await password.fill(buyerPassword);
      await page.locator("#btnLogin").click();
      // Either PayPal asks to confirm, or it redirects straight back to Slip.
      const agree = page.getByRole("button", { name: /Agree|Continue|Approve/i });
      await Promise.race([
        page.waitForURL((url) => url.origin === base, { timeout: PATIENCE_MS }),
        agree.first().waitFor({ state: "visible", timeout: PATIENCE_MS }),
      ]);
      if (new URL(page.url()).origin !== base) {
        await agree.first().click();
        await page.waitForURL((url) => url.origin === base, { timeout: PATIENCE_MS });
      }
      const after = await page.request.get(`${base}/api/v1/mandate`);
      const status = after.ok() ? ((await after.json()) as { status?: string }).status : undefined;
      mandateActive = status === "ACTIVE";
      say(
        "buyer approval",
        mandateActive ? "ok" : "FAILED",
        mandateActive
          ? `approved as a sandbox buyer; the permission reads ACTIVE and can be charged`
          : `came back to ${new URL(page.url()).pathname} with the permission ${status ?? "unreadable"}`,
      );
    } catch (error) {
      // A login form refusing automation is not a defect to work around: say so and let the
      // owner click the link themselves.
      say("buyer approval", "FAILED", `PayPal's login did not complete: ${message(error)}`);
    }
  } else {
    // Name which half is missing. "set both" is useless advice to somebody who has set one of
    // them and is looking at this line wondering which.
    const missing =
      approval === null
        ? "no approval link to follow"
        : buyerEmail === "" && buyerPassword === ""
          ? "set PAYPAL_SANDBOX_BUYER_EMAIL and PAYPAL_SANDBOX_BUYER_PASSWORD in apps/web/.env.local"
          : buyerPassword === ""
            ? "PAYPAL_SANDBOX_BUYER_EMAIL is set; PAYPAL_SANDBOX_BUYER_PASSWORD is not"
            : "PAYPAL_SANDBOX_BUYER_PASSWORD is set; PAYPAL_SANDBOX_BUYER_EMAIL is not";
    say("buyer approval", "absent", missing);
  }

  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  const main = page.getByRole("main");
  if (new URL(page.url()).pathname !== "/agents") {
    // Worth separating from a missing control: this is the session not surviving the trip.
    say("agent key issued", "FAILED", `/agents redirected away — no session here`);
  } else {
    const name = page.locator("#agent-name");
    await name.waitFor({ state: "visible", timeout: PATIENCE_MS });
    await name.fill(`verify-${stamp}`);
    const issue = page.getByRole("button", { name: /Issue a key/ });
    // A disabled button makes `click` wait for the whole timeout and then say only "timeout", so
    // the state is read first and reported as what it is.
    if (await issue.isDisabled()) {
      say("agent key issued", "FAILED", "the button stayed disabled with the name filled in");
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

  // D71: the credential an owner sets is the only way back in. Proven on PGlite locally and never
  // here, and an owner who cannot return is locked out of their own money.
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.waitForURL(/\/sign-in/, { timeout: PATIENCE_MS });
  await page.locator("#return-email").fill(address);
  await page.locator("#return-password").fill(passphrase);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(/\/receipts|\/mandate/, { timeout: PATIENCE_MS });
  const again = await page.request.get(`${base}/api/v1/mandate`);
  const back = again.ok() ? ((await again.json()) as { id?: string }).id : undefined;
  say(
    "sign out and back in",
    back !== undefined && back === mandateId ? "ok" : "FAILED",
    back === mandateId
      ? "the credential returns the owner to the same permission"
      : `came back to ${back ?? "nothing"} rather than the permission they left`,
  );
} catch (error) {
  say("the owner flow", "FAILED", message(error));
} finally {
  await browser.close();
}

// ── The agent, over both paths Slip advertises ──────────────────────────────────────────────────

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

    // The gate. A purchase needs an approved vault, so a refusal is the correct answer and proves
    // the whole chain behind it: key → agent → permission → gate.
    const bought = await call(client, "checkout", {
      product_id: productId,
      chosen_offer_url: offerUrl,
      reason: "verifying this deployment's wiring",
    });
    mcpRefusal = reasonIn(bought.text);
    receiptId = bought.receiptId;
    if (mandateActive) {
      // The permission can be charged, so a refusal is no longer the right answer. Any of PAID,
      // HELD or REJECTED is Slip deciding; only a refusal means the chain did not reach the rules.
      const decided = bought.outcome ?? (mcpRefusal === null ? "a decision" : null);
      say(
        "checkout over MCP",
        decided !== null && mcpRefusal !== "MANDATE_NOT_ACTIVE" ? "ok" : "FAILED",
        decided !== null && mcpRefusal !== "MANDATE_NOT_ACTIVE"
          ? `${decided}${receiptId === null ? "" : ` · receipt ${receiptId}`} — real prices, real classifier, real PayPal`
          : first(bought.text),
      );
    } else {
      say(
        "checkout over MCP",
        mcpRefusal === "MANDATE_NOT_ACTIVE" ? "refused" : "FAILED",
        mcpRefusal === "MANDATE_NOT_ACTIVE"
          ? "MANDATE_NOT_ACTIVE — correct, and only the vault approval is missing"
          : first(bought.text),
      );
    }

    // Read tools, never called on this deployment. `get_report` aggregates over an owner with no
    // purchases at all, which is the shape a Postgres deployment can get wrong where PGlite does not.
    const report = await callText(client, "get_report", {});
    say(
      "get_report",
      report === "" ? "FAILED" : "ok",
      report === ""
        ? "answered nothing"
        : `answers for an owner with no purchases: ${first(report)}`,
    );
    // With a receipt of its own, read that one back: it is the owner's record of the purchase and
    // what PayPal has said about it so far. Without one, an id that is not this agent's must be
    // declined, which proves the tool runs and scopes its answer.
    const askFor = receiptId ?? `verify-${stamp}`;
    const receipt = await callText(client, "get_receipt", { receipt_id: askFor });
    if (receiptId !== null) {
      say(
        "get_receipt",
        receipt === "" ? "FAILED" : "ok",
        receipt === "" ? "answered nothing for its own receipt" : first(receipt),
      );
    } else {
      const declined = /NOT_FOUND|no receipt|not yours|refused/i.test(receipt);
      say(
        "get_receipt",
        declined ? "refused" : receipt === "" ? "FAILED" : "ok",
        declined
          ? "declines an id that is not this agent's, which is the right answer"
          : first(receipt),
      );
    }
    await client.close();
  } catch (error) {
    say("MCP handshake", "FAILED", message(error));
  }

  // The MCP-free path. TOOLS.md offers it as "same decisions", and the only thing that makes that
  // safe to advertise is the two paths answering identically. Note the body is camelCase here and
  // snake_case over MCP (docs/UI.md), which is itself worth exercising rather than assuming.
  try {
    const sent = await fetch(`${base}/api/v1/agent/checkout`, {
      method: "POST",
      headers: { authorization: `Bearer ${agentKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        productId,
        chosenOfferUrl: offerUrl,
        reason: "verifying this deployment's wiring",
      }),
    });
    const body = (await sent.json()) as { reason?: string };
    const agrees = body.reason !== undefined && body.reason === mcpRefusal;
    say(
      "checkout over REST",
      agrees ? "refused" : "FAILED",
      agrees
        ? `${sent.status} ${body.reason} — the same decision MCP gave, which is what TOOLS.md promises`
        : `answered ${sent.status} ${body.reason ?? "no reason"} where MCP said ${mcpRefusal ?? "nothing"}`,
    );
  } catch (error) {
    say("checkout over REST", "FAILED", message(error));
  }
}

process.stdout.write(render());
process.exit(lines.some((line) => line.state === "FAILED") ? 1 : 0);

async function callText(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return (await call(client, name, args)).text;
}

/** A tool's answer in both forms: the text written for a model, and what it carries structurally. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; receiptId: string | null; outcome: string | null }> {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content?: { text?: string }[];
    structuredContent?: { receipt_id?: unknown; outcome?: unknown; status?: unknown };
  };
  const text = answer.content?.map((part) => part.text ?? "").join(" ") ?? "";
  const structured = answer.structuredContent ?? {};
  const str = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  return {
    text,
    receiptId:
      str(structured.receipt_id) ?? text.match(/\breceipt_id[:=]?\s*([\w-]{6,})/i)?.[1] ?? null,
    outcome:
      str(structured.outcome) ??
      str(structured.status) ??
      text.match(/\b(PAID|HELD|REJECTED)\b/)?.[1] ??
      null,
  };
}

/** The refusal code Slip names in a tool's own words, so both paths can be compared on it. */
function reasonIn(text: string): string | null {
  return /MANDATE_NOT_ACTIVE|not finished setting up|revoked/i.test(text)
    ? "MANDATE_NOT_ACTIVE"
    : (text.match(/\b([A-Z][A-Z_]{3,})\b/)?.[1] ?? null);
}

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
  if (mandateActive) {
    out.push(
      "",
      "Nothing is left: a sandbox buyer approved the vault in this run, the permission reads ACTIVE,",
      "and the checkout above went through the rules rather than being refused.",
      ...(receiptId === null
        ? []
        : [
            `Read the receipt at ${base}/receipts/${receiptId}, or ask PayPal about the order itself.`,
          ]),
    );
  } else if (approval !== null) {
    out.push(
      "",
      "One step is left, and it is a person's: approve the vault signed in as a **sandbox buyer**",
      "(PayPal dashboard → Testing tools → Sandbox accounts → a Personal account).",
      `  ${approval}`,
      "",
      "**That link is perishable.** PayPal answered RESOURCE_NOT_FOUND for two setup tokens less",
      "than a day old, so a link kept from an earlier run is probably already dead and the mandate",
      "behind it is stranded. Run this again for a fresh one rather than clicking a saved one.",
      "",
      ...(offerIsReal
        ? [
            "Then run this again. The mandate reads ACTIVE, and `checkout` stops refusing and",
            "**buys that cheapest offer with real sandbox money**. That is the proof, and it needs",
            "nothing local. A repeat replays the same decision rather than paying twice.",
          ]
        : [
            "Then run this again: the mandate reads ACTIVE and `checkout` stops refusing. It will",
            "not buy, because the offer url above is a placeholder — set CHANNEL3_API_KEY so this",
            "can read a real offer, or hand an agent one yourself.",
          ]),
      "",
      "`pnpm test:live:paypal` is **not** the route for this mandate. `paypal:vault-id` opens the",
      "DATABASE_URL in apps/web/.env.local — the local PGlite, not the deployment's database — and",
      "the vault id is encrypted under the deployment's own SLIP_ENCRYPTION_KEY, which is a Vercel",
      "secret and cannot be read back. That suite wants a mandate whose key you hold.",
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
