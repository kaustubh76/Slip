import { type AgentId, agentId as toAgentId } from "@slip/domain";
import type { AppDeps } from "../deps.js";

/**
 * What Slip's own search showed an agent, kept so the steering check can read it at checkout.
 *
 * Why it is kept at all: a Channel3 offer carries no text, so on real data the chosen listing has
 * nothing to judge (D67). The words an agent actually reads are the product's, in the search
 * results Slip served it — so Slip records exactly what it showed, and the classifier judges that
 * (D69). Text the *agent* sent is never recorded: an agent could write anything there, and a
 * check that read it would be asking the suspect for its own alibi.
 *
 * Recording never fails a search. A lost row costs a steering verdict on one checkout, which R4a
 * then holds for the owner; a thrown error would cost the agent its search results.
 */

/** How long a recorded impression is worth keeping, regardless of when it is read. */
const KEEP_MS = 2 * 60 * 60 * 1000;

export interface ShownProduct {
  productId: string;
  /** The product's own words, exactly as the agent was shown them. */
  text: string | null;
}

export async function recordShown(
  deps: AppDeps,
  agent: string,
  shown: readonly ShownProduct[],
  now: Date,
): Promise<void> {
  const rows = shown
    .filter((product): product is { productId: string; text: string } => {
      return typeof product.text === "string" && product.text.trim() !== "";
    })
    .map((product) => ({ productId: product.productId, text: product.text }));
  if (rows.length === 0) {
    // Nothing was shown that could carry an instruction; no row, and no prune either, so a
    // catalogue without product text never touches the table.
    return;
  }
  try {
    await deps.store.impressions.show(asAgent(agent), rows, now, new Date(now.getTime() - KEEP_MS));
  } catch (error) {
    deps.log.warn("search.not_recorded", { error: String(error) });
  }
}

/** What the classifier should be told the agent read, or null when there is nothing worth telling. */
export async function searchContextFor(
  deps: AppDeps,
  input: { agentId: AgentId; productId: string; now: Date },
): Promise<string | null> {
  try {
    const shown = await deps.store.impressions.latest(input.agentId, input.productId);
    if (shown === null) {
      return null;
    }
    const age = input.now.getTime() - shown.shownAt.getTime();
    // Older than the window and it is no longer what this purchase was chosen from.
    return age <= deps.config.searchContextMaxAgeMs ? shown.text : null;
  } catch (error) {
    // A checkout must not fail because an operational row could not be read.
    deps.log.warn("search.context_unavailable", { error: String(error) });
    return null;
  }
}

const asAgent = (value: string): AgentId => toAgentId(value);
