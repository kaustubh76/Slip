/**
 * The demo agent: what an AI shopping agent does with Slip in front of PayPal, as a terminal
 * transcript. It reads its desk's errands (the demo's stand-in for searching Channel3), picks the
 * offer the errand names, calls Slip's one agent endpoint, and prints Slip's answer in the words the
 * owner's receipt uses.
 *
 * It knows Slip only over HTTP, as any agent would: nothing here imports Slip's code. Separate from
 * the command line (`demo-agent.ts`) so the transcript can be tested against a fake `fetch`.
 */

export interface ListedOffer {
  store: string;
  url: string;
  priceCents: number | null;
  currency: string;
  availability: string;
  condition: string | null;
  commission: string | null;
  listingText: string | null;
}

export interface ErrandListing {
  name: string;
  label: string;
  productId: string;
  title: string;
  chosenUrl: string;
  reason: string;
  consoleOnly: boolean;
  offers: ListedOffer[];
}

export interface AgentRun {
  /** Slip's public URL, e.g. http://localhost:3000. */
  base: string;
  key: string;
  /** The errand to run; null lists them. */
  errand: string | null;
  fetch: typeof fetch;
  now: () => number;
}

export interface AgentOutcome {
  /** 0 Slip decided (or replayed a decision), 1 Slip refused, 2 the run could not start. */
  code: 0 | 1 | 2;
  lines: string[];
}

const PAD = "        ";

export async function runAgent(run: AgentRun): Promise<AgentOutcome> {
  const base = run.base.replace(/\/+$/, "");
  const lines: string[] = [];
  const say = (who: "agent" | "slip" | "paypal" | "", text: string) =>
    lines.push(who === "" ? `${PAD}${text}` : `${who.padEnd(PAD.length)}${text}`);

  let listing: { agent: string; errands: ErrandListing[] };
  try {
    const response = await run.fetch(`${base}/api/v1/demo/errands`, {
      headers: { authorization: `Bearer ${run.key}` },
    });
    const body = (await response.json()) as { message?: string } & typeof listing;
    if (!response.ok) {
      return {
        code: 2,
        lines: [
          `Slip at ${base} would not list errands (${response.status}): ${body.message ?? "no reason given"}`,
        ],
      };
    }
    listing = body;
  } catch (error) {
    return { code: 2, lines: [`Slip is not answering at ${base}: ${String(error)}`] };
  }

  const errand = listing.errands.find((e) => e.name === run.errand);
  if (errand === undefined) {
    return {
      code: run.errand === null ? 0 : 2,
      lines: [
        ...(run.errand === null ? [] : [`There is no errand "${run.errand}". The errands:`, ""]),
        ...listing.errands.map(
          (e) => `  ${e.name.padEnd(12)}${e.label}${e.consoleOnly ? "  (console only)" : ""}`,
        ),
        "",
        "Run one with: pnpm demo:agent --errand <name>",
      ],
    };
  }
  if (errand.consoleOnly) {
    return {
      code: 2,
      lines: [
        `"${errand.name}" needs Channel3 down for this product while it runs, which only the console`,
        `can arrange: ${base}/demo`,
      ],
    };
  }

  lines.push(`Slip demo agent · ${listing.agent} · ${base}`, `errand  ${errand.label}`, "");
  say("agent", `searching the stand-in Channel3 for "${errand.title}"`);
  for (const offer of errand.offers) {
    say("", offerLine(offer));
    if (offer.listingText !== null) {
      say("", `  listing says: "${offer.listingText}"`);
    }
  }
  const chosen = errand.offers.find((o) => o.url === errand.chosenUrl);
  say(
    "agent",
    `picks ${chosen === undefined ? errand.chosenUrl : `${chosen.store} at ${money(chosen)}`}, because "${errand.reason}"`,
  );
  say("agent", "POST /api/v1/agent/checkout");

  const started = run.now();
  let status: number;
  let answer: CheckoutAnswer;
  try {
    const response = await run.fetch(`${base}/api/v1/agent/checkout`, {
      method: "POST",
      headers: { authorization: `Bearer ${run.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        productId: errand.productId,
        chosenOfferUrl: errand.chosenUrl,
        reason: errand.reason,
      }),
    });
    status = response.status;
    answer = (await response.json()) as CheckoutAnswer;
  } catch (error) {
    say("slip", `no answer: ${String(error)}`);
    say("", "The purchase may still have been checked; the owner's receipts will show it.");
    return { code: 2, lines };
  }
  const took = `${((run.now() - started) / 1000).toFixed(1)}s`;

  if (answer.status === "refused" || answer.receipt === undefined) {
    say(
      "slip",
      `refused in ${took} (${status} ${answer.reason ?? "no reason"}): ${answer.message ?? ""}`,
    );
    say("", "Nothing was checked and nothing was charged.");
    return { code: 1, lines };
  }
  const receipt = answer.receipt;
  say(
    "slip",
    answer.status === "replayed"
      ? `in ${took}: the same purchase again, so the earlier decision stands (${answer.reason ?? ""})`
      : `in ${took}: ${receipt.outcome} by ${receipt.ruleCode}`,
  );
  lines.push("");
  for (const line of receipt.lines) {
    say("", line);
  }
  if (receipt.paypal !== null) {
    lines.push("");
    say(
      "paypal",
      `${receipt.state.word}${receipt.paypal.orderId === null ? "" : `, order ${receipt.paypal.orderId}`} (simulated)`,
    );
  }
  lines.push("", `receipt no. ${short(receipt.receiptId)}  ${base}/receipts/${receipt.receiptId}`);
  return { code: 0, lines };
}

interface CheckoutAnswer {
  status: "decided" | "replayed" | "refused";
  reason?: string;
  message?: string;
  receipt?: {
    receiptId: string;
    outcome: string;
    ruleCode: string;
    lines: string[];
    state: { word: string };
    paypal: { orderId: string | null } | null;
  };
}

function offerLine(offer: ListedOffer): string {
  const stock = [
    offer.condition ?? "condition not stated",
    offer.availability === "InStock" ? "in stock" : spaced(offer.availability),
  ].join(", ");
  const commission =
    offer.commission === null ? "" : `   pays the agent's platform ${offer.commission}`;
  return `${offer.store.padEnd(10)}${money(offer).padStart(9)}   ${stock}${commission}`;
}

function money(offer: ListedOffer): string {
  if (offer.priceCents === null) {
    return "no price";
  }
  const amount = (offer.priceCents / 100).toFixed(2);
  return offer.currency === "USD" ? `$${amount}` : `${amount} ${offer.currency}`;
}

/** "OutOfStock" → "out of stock". */
function spaced(word: string): string {
  return word.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** The receipt number the owner's pages print: the id's first and last four hex digits. */
function short(id: string): string {
  const hex = id.replaceAll("-", "");
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}
