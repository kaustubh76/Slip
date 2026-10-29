import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { STEERING_MODEL } from "./claude.js";

/**
 * Does this key authenticate? — asked before anything draws a conclusion from a `NO_ANSWER`.
 *
 * The adapter turns every failure into `NO_ANSWER` and keeps no reason, on purpose: an error can
 * quote the listing, and rule R4a holds the purchase for the owner either way, so a checkout has
 * nothing to do with the difference between a slow model and a rejected key. A *measurement* has
 * everything to do with it. On 29 Oct 2026 the configured key had been revoked, and the live suite
 * reported it as fourteen wrong answers from the model — every assertion blaming a classifier that
 * was never asked (D92).
 *
 * `count_tokens` is the right probe. It authenticates exactly as a real call does, it is not
 * billed, and given the real prompt it also returns the per-check input size, so one free call both
 * gates a sweep and measures it.
 *
 * What comes back out is a reason and a number, never the SDK's message — the adapter's rule holds
 * here too, because `prompt` carries a listing whenever a caller passes the real one.
 */

export type CredentialCheck =
  | { ok: true; model: string; inputTokens: number }
  /** `rejected` is the key: 401 or 403. Anything else is `unreachable` — the probe, not the key. */
  | { ok: false; reason: "rejected" | "unreachable"; status: number | null };

export interface SteeringCredentialOptions {
  apiKey: string;
  /** Defaults to `claude-opus-5-5`, so the probe authenticates against the model the check uses. */
  model?: string;
  /** Counted instead of the probe's own word, so one free call also sizes a real check. */
  prompt?: { system: string; user: string };
  baseUrl?: string;
  /** Injected in tests, which answer with recorded `count_tokens` responses. */
  fetch?: ClientOptions["fetch"];
  client?: Anthropic;
}

/** Nothing to do with a listing, and short enough that the count is obviously not a measurement. */
const PROBE = { system: "", user: "ping" };

export async function checkSteeringCredential(
  options: SteeringCredentialOptions,
): Promise<CredentialCheck> {
  const model = options.model ?? STEERING_MODEL;
  const prompt = options.prompt ?? PROBE;
  const client =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      // As the adapter does: a retry here would turn one free probe into three.
      maxRetries: 0,
      ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  try {
    const counted = await client.messages.countTokens(
      {
        model,
        ...(prompt.system === "" ? {} : { system: prompt.system }),
        messages: [{ role: "user", content: prompt.user }],
      },
      { maxRetries: 0 },
    );
    return { ok: true, model, inputTokens: counted.input_tokens };
  } catch (error) {
    const status = statusOf(error);
    return status === 401 || status === 403
      ? { ok: false, reason: "rejected", status }
      : { ok: false, reason: "unreachable", status };
  }
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
