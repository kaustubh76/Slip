/**
 * The steering classifier (an LLM in production). It answers one question about untrusted listing
 * text — does it try to instruct a shopping agent? — and never decides an outcome; rules R3/R4a
 * do that with its answer.
 */

export interface ClassifierInput {
  /** The chosen offer's listing text (title, description, badges). Untrusted. */
  listingText: string;
  productTitle: string;
  /**
   * What Slip's own search tool showed this agent for the product, when Slip has it. Never text
   * the agent supplied: the agent could write anything there.
   */
  searchContext: string | null;
}

export interface ClassifierVerdict {
  /** `NO_ANSWER` on any timeout, error, refusal or output that does not fit the schema. */
  answer: { instruction_like: boolean } | "NO_ANSWER";
  /** Recorded so a verdict can be traced and replayed. */
  model: string;
  promptVersion: string;
}

export interface SteeringClassifier {
  classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassifierVerdict>;
}
