/**
 * How much of a store's own words Slip passes on, and where a cut is marked.
 *
 * Slip sits between an agent and listing text, so the size of what it passes on is Slip's problem,
 * not the store's. Measured over the 240 products the market study recorded, every one carries
 * prose — median 712 characters, up to 1,579 — while not one of the 321 offers carries any of its
 * own. So the untrusted text on the money path is the product's description, it is always there,
 * and uncapped it is sized by whoever wrote the listing (D85).
 *
 * There are two bounds because they do two different jobs, and both are stated rather than
 * implied. Neither ever cuts silently: text that has been cut says so, to the agent reading it and
 * to anyone reading the row later.
 */

/**
 * What an agent is handed for one product or one offer.
 *
 * `SEARCH_LIMIT.max` is thirty products, so uncapped a single search could spend tens of kilobytes
 * of an agent's context on marketing copy. Four hundred characters still says what a thing is.
 */
export const SHOWN_TEXT_LIMIT = 400;

/**
 * What Slip keeps when it records a listing. Far above anything observed — the longest description
 * in the study sample is 1,579 characters, so this has never fired — because a stored row is
 * evidence and the reason to bound it is a hostile payload, not an ordinary description.
 */
export const STORED_TEXT_LIMIT = 2_000;

/**
 * A store's words as an agent is shown them: whitespace collapsed to single spaces, cut to
 * `SHOWN_TEXT_LIMIT`, and a cut marked so the agent can tell it is reading part of a listing.
 *
 * Collapsing matters as much as the cap. A description arrives with its own newlines, and the MCP
 * text form quotes it as `about: "…"` — so without this, a bullet list inside the quote is laid
 * out exactly like the tool's own `- store: …` lines, and nothing tells them apart.
 */
export function shownText(text: string | null | undefined): string | null {
  return bounded(text, SHOWN_TEXT_LIMIT, true);
}

/**
 * A store's words as Slip stores them: the store's own line breaks kept, because a row is a record
 * of what the store wrote, and bounded so one listing cannot become one row of any size.
 */
export function storedText(text: string | null | undefined): string | null {
  return bounded(text, STORED_TEXT_LIMIT, false);
}

function bounded(text: string | null | undefined, limit: number, flatten: boolean): string | null {
  if (text === null || text === undefined) {
    return null;
  }
  const kept = (flatten ? text.replace(/\s+/g, " ") : text).trim();
  if (kept === "") {
    return null;
  }
  return kept.length <= limit ? kept : `${kept.slice(0, limit).trimEnd()}…`;
}
