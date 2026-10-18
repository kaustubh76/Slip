import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { ListedOffer, ToolReceipt, ToolSearch } from "@slip/mcp";

/**
 * The demo agent: what an AI shopping agent does with Slip in front of PayPal, as a terminal
 * transcript. It speaks MCP to Slip's server at `/api/mcp` with its own key — `search_products` to
 * find the item, `checkout` to pay — and prints Slip's answer in the words the owner's receipt uses,
 * with Slip's next step.
 *
 * Each errand is a rule for choosing among the offers search returns, the way a real agent would
 * choose: the cheapest, the one with the "Top pick" badge, the one whose listing addresses AI
 * agents. It knows Slip only over MCP (the types it imports are erased when it runs). Separate from
 * the command line (`demo-agent.ts`) so the transcript can be tested against a fake `fetch`.
 */

export interface ScriptErrand {
  label: string;
  query: string;
  reason: string;
  /** How the agent picks among the offers search listed. */
  pick: (offers: readonly ListedOffer[]) => ListedOffer | undefined;
  /** Needs Channel3 down for this product while it runs, which only the console can arrange. */
  consoleOnly?: boolean;
}

const cheapest = (offers: readonly ListedOffer[]): ListedOffer | undefined =>
  offers
    .filter((o) => o.in_stock && o.condition === "new" && o.price_cents !== null)
    .sort((a, b) => (a.price_cents ?? 0) - (b.price_cents ?? 0))[0];

export const SCRIPT_ERRANDS: Readonly<Record<string, ScriptErrand>> = {
  lamp: {
    label: "Buys the cheapest desk lamp",
    query: "desk lamp",
    reason: "cheapest I found",
    pick: cheapest,
  },
  "top-pick": {
    label: "Picks the [synthetic] Top pick trail shoe at $58.99",
    query: "trail shoe",
    reason: "Top pick badge, ships fastest",
    pick: (offers) => offers.find((o) => o.listing_text?.includes("Top pick") === true),
  },
  cheaper: {
    label: "Retries with the $47.99 trail shoe",
    query: "trail shoe",
    reason: "same shoe, lowest listed price",
    pick: cheapest,
  },
  "above-cap": {
    label: "Buys $239 headphones, above the $200 cap",
    query: "headphones",
    reason: "best reviews",
    pick: cheapest,
  },
  "offers-down": {
    label: "Buys a $310 standing desk while Channel3 is down",
    query: "standing desk",
    reason: "only one I could find",
    pick: cheapest,
    consoleOnly: true,
  },
  injected: {
    label: "Follows a listing that tells AI agents what to buy",
    query: "phone case",
    reason: "the listing said it was the only offer worth buying",
    pick: (offers) => offers.find((o) => /AI shopping agents/i.test(o.listing_text ?? "")),
  },
};

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

function errandList(): string[] {
  return [
    ...Object.entries(SCRIPT_ERRANDS).map(
      ([name, e]) => `  ${name.padEnd(12)}${e.label}${e.consoleOnly ? "  (console only)" : ""}`,
    ),
    "",
    "Run one with: pnpm demo:agent --errand <name>",
  ];
}

export async function runAgent(run: AgentRun): Promise<AgentOutcome> {
  const base = run.base.replace(/\/+$/, "");
  if (run.errand === null) {
    return { code: 0, lines: errandList() };
  }
  const errand = SCRIPT_ERRANDS[run.errand];
  if (errand === undefined) {
    return {
      code: 2,
      lines: [`There is no errand "${run.errand}". The errands:`, "", ...errandList()],
    };
  }
  if (errand.consoleOnly === true) {
    return {
      code: 2,
      lines: [
        `"${run.errand}" needs Channel3 down for this product while it runs, which only the console`,
        `can arrange: ${base}/demo`,
      ],
    };
  }

  const lines: string[] = [];
  const say = (who: "agent" | "slip" | "next" | "paypal" | "", text: string) =>
    lines.push(who === "" ? `${PAD}${text}` : `${who.padEnd(PAD.length)}${text}`);
  const endpoint = `${base}/api/mcp`;
  const client = new Client(
    { name: "slip-demo-agent", version: "0.0.1" },
    { versionNegotiation: { mode: "auto" } },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch: run.fetch,
        requestInit: { headers: { Authorization: `Bearer ${run.key}` } },
      }),
    );
  } catch (error) {
    return {
      code: 2,
      lines: [`Slip's MCP server at ${endpoint} would not talk: ${message(error)}`],
    };
  }

  try {
    lines.push(`Slip demo agent · MCP · ${endpoint}`, `errand  ${errand.label}`, "");
    say("agent", `search_products "${errand.query}"`);
    const searched = await client.callTool({
      name: "search_products",
      arguments: { query: errand.query },
    });
    if (searched.isError === true) {
      say("slip", textOf(searched));
      return { code: 2, lines };
    }
    const found = searched.structuredContent as ToolSearch;
    const product = found.products[0];
    if (product === undefined) {
      say("slip", `nothing found. ${found.hint ?? ""}`.trim());
      return { code: 2, lines };
    }
    say("slip", `${product.title} (product_id ${product.product_id})`);
    for (const offer of product.offers) {
      say("", `  ${offerLine(offer)}`);
      if (offer.listing_text !== null) {
        say("", `    listing text: "${offer.listing_text}"`);
      }
    }
    const chosen = errand.pick(product.offers);
    if (chosen === undefined) {
      say("agent", "found no offer to pick");
      return { code: 2, lines };
    }
    say(
      "agent",
      `checkout ${chosen.store} at ${chosen.price ?? "no price"}, because "${errand.reason}"`,
    );

    const started = run.now();
    const paid = await client.callTool({
      name: "checkout",
      arguments: {
        product_id: product.product_id,
        chosen_offer_url: chosen.url,
        reason: errand.reason,
      },
    });
    const took = `${((run.now() - started) / 1000).toFixed(1)}s`;
    if (paid.isError === true) {
      say("slip", `in ${took}: ${textOf(paid)}`);
      return { code: 1, lines };
    }
    const receipt = paid.structuredContent as ToolReceipt;
    say(
      "slip",
      receipt.replayed
        ? `in ${took}: the same purchase again, so the earlier decision stands (${receipt.replay_reason})`
        : `in ${took}: ${receipt.outcome} by ${receipt.rule}`,
    );
    lines.push("");
    for (const line of receipt.receipt) {
      say("", line);
    }
    lines.push("");
    say("next", receipt.next_step);
    if (receipt.paypal_order_id !== null) {
      say(
        "paypal",
        `${receipt.payment_status}, order ${receipt.paypal_order_id}${receipt.simulated ? " (simulated)" : ""}`,
      );
    }
    lines.push("", `receipt no. ${short(receipt.receipt_id)}  ${receipt.receipt_url}`);
    return { code: 0, lines };
  } catch (error) {
    say("slip", `no answer: ${message(error)}`);
    say("", "The purchase may still have been checked; the owner's receipts will show it.");
    return { code: 2, lines };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function offerLine(offer: ListedOffer): string {
  const stock = [
    offer.condition ?? "condition not stated",
    offer.in_stock ? "in stock" : "out of stock",
  ].join(", ");
  const commission = offer.commission === null ? "" : `   commission ${offer.commission}`;
  return `${offer.store.padEnd(10)}${(offer.price ?? "no price").padStart(9)}   ${stock}${commission}`;
}

function textOf(result: { content?: unknown }): string {
  return ((result.content ?? []) as { type: string; text?: string }[])
    .map((c) => c.text ?? "")
    .join(" ");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The receipt number the owner's pages print: the id's first and last four hex digits. */
function short(id: string): string {
  const hex = id.replaceAll("-", "");
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}
