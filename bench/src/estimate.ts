import type { StoredRun } from "./runs.js";

/**
 * What a sweep is about to cost, measured from the sweeps that have already run.
 *
 * It is quoted in tokens, never in money. A rate belongs to whoever holds the account and changes
 * without warning; a projection in tokens can be multiplied by today's rate by the person about to
 * pay it, which is also the only moment the arithmetic is true. Printed before `--yes`, it answers
 * the question that otherwise needs the Anthropic console open in another window.
 *
 * There is no estimate without a basis, and saying so is the point: a number invented for an agent
 * nobody has run yet would be a guess wearing the clothes of a measurement.
 */

export interface SweepEstimate {
  agent: string;
  /** Runs the projection is built from. */
  basis: number;
  /** Errands this sweep will actually run for that agent — the skipped ones cost nothing. */
  errands: number;
  inputTokens: number;
  outputTokens: number;
  /** True when no run under the current prompt had usage, so an older prompt's runs were used. */
  fromAnotherPrompt: boolean;
}

export function estimateSweep(input: {
  runs: readonly StoredRun[];
  agent: string;
  errands: number;
  promptVersion: string;
}): SweepEstimate | null {
  if (input.errands <= 0) {
    return null;
  }
  const counted = input.runs.filter((run) => run.agent === input.agent && run.usage !== undefined);
  const current = counted.filter((run) => run.promptVersion === input.promptVersion);
  // This prompt's runs if there are any; an older prompt's are a worse basis, not no basis.
  const basis = current.length > 0 ? current : counted;
  if (basis.length === 0) {
    return null;
  }
  let input_ = 0;
  let output = 0;
  for (const run of basis) {
    input_ += run.usage?.inputTokens ?? 0;
    output += run.usage?.outputTokens ?? 0;
  }
  const per = (total: number): number => Math.round((total / basis.length) * input.errands);
  return {
    agent: input.agent,
    basis: basis.length,
    errands: input.errands,
    inputTokens: per(input_),
    outputTokens: per(output),
    fromAnotherPrompt: current.length === 0,
  };
}

/** The estimate as one line for the operator, or the reason there is none. */
export function describeEstimate(estimate: SweepEstimate | null, agent: string): string {
  if (estimate === null) {
    return (
      `${agent}: no measured basis yet — run it with \`--errands 2\` first and this will` +
      " project the rest from what that cost."
    );
  }
  const tokens = (n: number): string => n.toLocaleString("en-US");
  return (
    `${estimate.agent}: about ${tokens(estimate.inputTokens)} input and` +
    ` ${tokens(estimate.outputTokens)} output tokens for ${estimate.errands} errands,` +
    ` measured on ${estimate.basis} recorded run${estimate.basis === 1 ? "" : "s"}` +
    `${estimate.fromAnotherPrompt ? " of an older prompt" : ""}.` +
    " Multiply by your own rate; this file quotes no prices."
  );
}
