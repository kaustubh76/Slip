import { randomUUID } from "node:crypto";
import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ClassifierInput, ClassifierVerdict, SteeringClassifier } from "@slip/domain";
import { z } from "zod";
import { buildPrompt, STEERING_PROMPT_VERSION } from "./prompt.js";

/**
 * The steering classifier, run by Claude. One structured call, one boolean, no tools.
 *
 * Everything that can go wrong is `NO_ANSWER`: a timeout, a transport error, a refusal, an answer
 * that does not fit the schema, no answer at all. `NO_ANSWER` is not a quiet default — rule R4a
 * holds the purchase for the owner whenever the price gap was wide enough to need this answer. So
 * the adapter never has to guess, and it never retries: a retry inside the deadline would spend the
 * caller's remaining time, and the caller (`withDeadline` in `@slip/app`) owns that deadline.
 *
 * `maxRetries: 0` is passed on the request as well as the client, because a caller may inject its
 * own client and the SDK retries twice by default.
 */

/** The user's choice for this check. Thinking is always on for this model; `effort` is the dial. */
export const STEERING_MODEL = "claude-opus-5-5";

/**
 * Generous on purpose. Thinking counts against `max_tokens` on this model, and a request that runs
 * out of room returns `stop_reason: "max_tokens"` with no JSON — a NO_ANSWER that holds a purchase
 * for no reason. The answer itself is a dozen tokens; this is a ceiling, not a target.
 */
const MAX_TOKENS = 4_096;

const AnswerSchema = z.object({
  instruction_like: z.boolean(),
});

export interface ClaudeSteeringOptions {
  apiKey: string;
  /** Defaults to `claude-opus-5-5`. Recorded with every verdict. */
  model?: string;
  baseUrl?: string;
  /** Injected in tests, which answer with recorded Messages API responses. */
  fetch?: ClientOptions["fetch"];
  client?: Anthropic;
  /** The per-request fence id. Injected in tests so a prompt can be asserted exactly. */
  nonce?: () => string;
}

export function createClaudeSteeringClassifier(options: ClaudeSteeringOptions): SteeringClassifier {
  const model = options.model ?? STEERING_MODEL;
  const nonce = options.nonce ?? (() => randomUUID().replaceAll("-", ""));
  const client =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      // Never: a second call costs the caller's deadline and buys nothing a hold does not.
      maxRetries: 0,
      ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });

  return {
    async classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassifierVerdict> {
      const noAnswer = (answered = model): ClassifierVerdict => ({
        answer: "NO_ANSWER",
        model: answered,
        promptVersion: STEERING_PROMPT_VERSION,
      });
      if (signal.aborted) {
        return noAnswer();
      }
      const prompt = buildPrompt(input, nonce());
      try {
        const message = await client.messages.parse(
          {
            model,
            max_tokens: MAX_TOKENS,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.user }],
            output_config: {
              // One boolean about a short text: the shallowest setting is the right one.
              effort: "low",
              format: zodOutputFormat(AnswerSchema),
            },
          },
          { signal, maxRetries: 0 },
        );
        // The model that answered, which an alias may resolve to something else.
        const answered = message.model === "" ? model : message.model;
        if (message.stop_reason === "refusal" || message.parsed_output === null) {
          // A refusal, or room ran out before the JSON: either way Slip has not been told.
          return noAnswer(answered);
        }
        return {
          answer: { instruction_like: message.parsed_output.instruction_like },
          model: answered,
          promptVersion: STEERING_PROMPT_VERSION,
        };
      } catch {
        // An abort, a 401, a 529, an unparsable body: all the same to the rules, and the error is
        // deliberately not carried out of here — it can quote the listing, and the SDK's message
        // can quote the request.
        return noAnswer();
      }
    },
  };
}
