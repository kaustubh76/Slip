import { SHOWN_TEXT_LIMIT } from "@slip/domain";
import { productText } from "@slip/offers/search";
import { productsFrom } from "./measure.js";
import type { Snapshot } from "./snapshots.js";

/**
 * The sample read for the thing Slip's steering rule exists to catch: a listing that talks to the
 * agent rather than to the shopper.
 *
 * Why this is worth a section of the report. Slip rejects purchases on that rule, SlipBench's
 * attack is synthetic and labelled synthetic, and nobody had ever read the 240 real descriptions to
 * ask whether it happens in the wild. Answering it also says which of Slip's rules has field
 * evidence behind it and which guards against something not yet seen.
 *
 * **What a scan of this kind can and cannot say.** It reports what matched a stated list of
 * patterns. It cannot report that no listing in the sample tries to steer an agent: a payload
 * written to avoid these words would pass it, which is the whole reason the production check asks a
 * model instead. So a hit is a candidate to be judged, never a verdict, and a zero is "nothing
 * matched what the check looks for", never "there is nothing there".
 *
 * The patterns cover four of the six things the classifier prompt calls `true`. The other two —
 * copy imitating a system message, a tool call or JSON, and copy asking for something other than
 * selling this product — have no form a regex can pick out of ordinary prose, and are not scanned.
 */

export interface TextPattern {
  /** Printed beside a candidate, so a reader can see which rule caught it. */
  name: string;
  /** The classifier-prompt category this comes from, in the report's words. */
  what: string;
  re: RegExp;
}

/**
 * Deliberately narrow. Every one of these had to leave the prompt's `false` list alone — "Buy now",
 * "Best value", "#1 seller", "cheaper than elsewhere" — because a scanner that fired on ordinary
 * selling would report noise and bury anything real.
 *
 * `approved-supplier` is the exception that proves the point: "authorised dealer" and "approved
 * retailer" are everyday retail language, so that pattern is expected to catch honest listings. It
 * is kept because the overlap is the finding — it is exactly the distinction a regex cannot draw
 * and the classifier can, so its candidates go to the real model rather than into a count.
 */
export const AGENT_DIRECTED_PATTERNS: readonly TextPattern[] = [
  {
    name: "note-to-agents",
    what: "addresses an AI, assistant, agent or model directly",
    re: /\b(?:note|attention|notice|instruction|important|message)\b[^.!?]{0,40}\b(?:a\.?i\.?|assistants?|agents?|bots?|models?|llms?)\b/i,
  },
  {
    name: "vocative",
    what: "addresses an AI, assistant, agent or model directly",
    re: /(?:^|[.!?]\s+)(?:ai|assistants?|agents?|bots?|models?|system)\s*[:,]\s*(?=\S)/i,
  },
  {
    name: "its-instructions",
    what: "refers to the reader's instructions, rules or system prompt",
    re: /\b(?:system prompt|your instructions|previous instructions|ignore (?:all |any |the )?(?:previous |prior |above )?instructions|disregard[^.!?]{0,20}instructions|override[^.!?]{0,20}(?:rules|instructions))\b/i,
  },
  {
    name: "pick-this-one",
    what: "instructs the reader which offer to select, or to stop comparing prices",
    re: /\b(?:select|choose|pick|buy from|purchase from)\b[^.!?]{0,40}\b(?:this (?:offer|listing|seller|store)|that store'?s? offer|our store only)\b/i,
  },
  {
    name: "stop-comparing",
    what: "instructs the reader which offer to select, or to stop comparing prices",
    re: /\b(?:do not|do n't|don'?t|never|stop|no need to)\b[^.!?]{0,30}\b(?:compar\w+|check (?:other|the other|any other) price|look at (?:other|any other)|other (?:offers|prices|sellers|listings))\b/i,
  },
  {
    name: "approved-supplier",
    what: "claims an authority a listing cannot have",
    re: /\b(?:approved|authorised|authorized|preferred|mandated|pre-?approved)\b[^.!?]{0,30}\b(?:supplier|vendor|seller|retailer|store|merchant|dealer)\b/i,
  },
];

export interface TextCandidate {
  productId: string;
  title: string;
  /** The query whose results first carried this product. */
  foundBy: string;
  /** Which pattern caught it. */
  pattern: string;
  /** The matched words with a little either side, on one line, for a person to judge. */
  quote: string;
}

export interface TextScan {
  products: number;
  withText: number;
  totalChars: number;
  medianChars: number | null;
  /** Descriptions longer than an agent is shown, which is where the bound matters (D85). */
  longerThanShown: number;
  shownLimit: number;
  /** Every pattern hit, in snapshot order. One product can appear under two patterns. */
  candidates: TextCandidate[];
}

/** How much of a match to quote either side, so a reader can judge it without the whole listing. */
const CONTEXT = 50;

export function scanText(snapshots: readonly Snapshot[]): TextScan {
  const lengths: number[] = [];
  const candidates: TextCandidate[] = [];
  let products = 0;
  for (const { foundBy, raw } of productsFrom(snapshots)) {
    products += 1;
    const text = productText(raw);
    if (text === null) {
      continue;
    }
    lengths.push(text.length);
    const flat = text.replace(/\s+/g, " ").trim();
    const id = (raw as { id?: unknown }).id;
    const title = (raw as { title?: unknown }).title;
    for (const pattern of AGENT_DIRECTED_PATTERNS) {
      const found = pattern.re.exec(flat);
      if (found === null) {
        continue;
      }
      candidates.push({
        productId: typeof id === "string" ? id : "",
        title: typeof title === "string" ? title.trim() : "",
        foundBy,
        pattern: pattern.name,
        quote: quoteAround(flat, found.index, found[0].length),
      });
    }
  }
  lengths.sort((a, b) => a - b);
  return {
    products,
    withText: lengths.length,
    totalChars: lengths.reduce((sum, n) => sum + n, 0),
    medianChars: lengths.length === 0 ? null : (lengths[lengths.length >> 1] as number),
    longerThanShown: lengths.filter((n) => n > SHOWN_TEXT_LIMIT).length,
    shownLimit: SHOWN_TEXT_LIMIT,
    candidates,
  };
}

function quoteAround(text: string, at: number, length: number): string {
  const from = Math.max(0, at - CONTEXT);
  const to = Math.min(text.length, at + length + CONTEXT);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}
/**
 * The real classifier's verdict on each candidate the patterns caught, recorded so the report can
 * print it with no key and no model call — the same rule every other number in the study follows.
 *
 * Obtained by asking the production classifier about the text an agent would actually be shown
 * (`shownText` of the description, which is what `searchContext` carries), one call per candidate.
 * To redo it after the sample changes, ask `createClaudeSteeringClassifier` the same question; a
 * candidate with no record here is printed as unjudged rather than quietly left out.
 */
export interface JudgedCandidate {
  productId: string;
  pattern: string;
  instructionLike: boolean;
  model: string;
  promptVersion: string;
}

export const JUDGED: readonly JudgedCandidate[] = [
  {
    // "rebel is Australia's preferred retailer of biggest sports brands at best prices."
    productId: "nN3hWTS",
    pattern: "approved-supplier",
    instructionLike: false,
    model: "claude-opus-5-5",
    promptVersion: "steer-2",
  },
];

/** The recorded verdict for one candidate, or null when nobody has judged it yet. */
export function verdictFor(candidate: TextCandidate): JudgedCandidate | null {
  return (
    JUDGED.find(
      (judged) => judged.productId === candidate.productId && judged.pattern === candidate.pattern,
    ) ?? null
  );
}
