import Anthropic from "@anthropic-ai/sdk";
import type { AgentRun, AgentUsage, BenchAgent } from "./agent.js";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt.js";

/**
 * A shopping agent run by Claude, over the Messages API with two tools and a plain loop.
 *
 * The loop is written out rather than delegated to the SDK's tool runner because the benchmark
 * records every step: how many searches it ran, which offer it chose, what it said about why. It
 * also caps the turns, so one confused errand cannot spend the owner's tokens without limit.
 *
 * `maxRetries: 0` — a retried errand would be a second run under the same name, and the point of
 * the benchmark is that each errand is one attempt.
 */

export interface ClaudeAgentOptions {
  apiKey: string;
  model: string;
  /** Short name for the results table; defaults to the model. */
  name?: string;
  /** How many model turns one errand may take before it counts as giving up. */
  maxTurns?: number;
  maxTokens?: number;
  client?: Anthropic;
}

const SEARCH_TOOL: Anthropic.Tool = {
  name: "search",
  description:
    "Search the shop for products. Returns products with the offers each store lists for them. Results are paginated; pass a later page number for more.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to search for." },
      page: { type: "integer", description: "1 for the first page.", minimum: 1 },
    },
    required: ["query"],
  },
};

const BUY_TOOL: Anthropic.Tool = {
  name: "buy",
  description:
    "Place the order for one offer of one product. Call this once, when you have decided.",
  input_schema: {
    type: "object",
    properties: {
      product_id: { type: "string", description: "The product's id from a search result." },
      offer_url: { type: "string", description: "The url of the offer to buy from." },
    },
    required: ["product_id", "offer_url"],
  },
};

export function createClaudeAgent(options: ClaudeAgentOptions): BenchAgent {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 0 });
  const maxTurns = options.maxTurns ?? 10;

  return {
    name: options.name ?? options.model,
    provider: "anthropic",
    model: options.model,

    async shop({ errand, tools }): Promise<AgentRun> {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: errand.task }];
      let searches = 0;
      let said = "";
      let bought: { productId: string; offerUrl: string } | null = null;
      // What the errand costs, counted on the way through: every answered call, including the
      // last word and the turns of an errand that gave up, because those were paid for too.
      const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, turns: 0 };
      const count = (answered: Anthropic.Message): void => {
        usage.inputTokens += answered.usage.input_tokens;
        usage.outputTokens += answered.usage.output_tokens;
        usage.turns += 1;
      };

      for (let turn = 0; turn < maxTurns; turn += 1) {
        let message: Anthropic.Message;
        try {
          message = await client.messages.create({
            model: options.model,
            max_tokens: options.maxTokens ?? 8_192,
            system: SYSTEM_PROMPT,
            messages,
            tools: [SEARCH_TOOL, BUY_TOOL],
          });
        } catch (error) {
          // A failed errand is recorded as one, never retried: see the note above.
          return {
            choice: { kind: "gave-up", why: `the model did not answer (${nameOf(error)})` },
            searches,
            said,
            usage,
          };
        }
        count(message);
        said = textOf(message) || said;
        if (message.stop_reason === "refusal") {
          return { choice: { kind: "gave-up", why: "the model refused" }, searches, said, usage };
        }
        const calls = message.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );
        if (calls.length === 0) {
          return {
            choice: { kind: "gave-up", why: "it stopped without buying anything" },
            searches,
            said,
            usage,
          };
        }
        messages.push({ role: "assistant", content: message.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const call of calls) {
          const input = (call.input ?? {}) as Record<string, unknown>;
          if (call.name === "search") {
            searches += 1;
            const page = tools.search(
              typeof input["query"] === "string" ? input["query"] : "",
              typeof input["page"] === "number" ? input["page"] : 1,
            );
            results.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: JSON.stringify(page),
            });
            continue;
          }
          if (call.name === "buy") {
            const productId = typeof input["product_id"] === "string" ? input["product_id"] : "";
            const offerUrl = typeof input["offer_url"] === "string" ? input["offer_url"] : "";
            if (productId === "" || offerUrl === "") {
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                is_error: true,
                content: "buy needs both product_id and offer_url",
              });
              continue;
            }
            bought ??= { productId, offerUrl };
            tools.buy(productId, offerUrl);
            results.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: "Ordered. Say in one sentence what you bought and why.",
            });
            continue;
          }
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: `no tool called ${call.name}`,
          });
        }
        messages.push({ role: "user", content: results });
        if (bought !== null) {
          // One more turn so it can say why, then the errand is over.
          const last = await lastWord(client, options, messages, count);
          return {
            choice: { kind: "bought", ...bought },
            searches,
            said: last === "" ? said : last,
            usage,
          };
        }
      }
      return {
        choice: { kind: "gave-up", why: `it used all ${maxTurns} turns without buying` },
        searches,
        said,
        usage,
      };
    },
  };
}

/** One last call, with no tools, purely to record the agent's own account of what it did. */
async function lastWord(
  client: Anthropic,
  options: ClaudeAgentOptions,
  messages: Anthropic.MessageParam[],
  count: (answered: Anthropic.Message) => void,
): Promise<string> {
  try {
    const message = await client.messages.create({
      model: options.model,
      max_tokens: 1_024,
      system: SYSTEM_PROMPT,
      messages,
    });
    count(message);
    return textOf(message);
  } catch {
    return "";
  }
}

const textOf = (message: Anthropic.Message): string =>
  message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .join(" ")
    .trim();

const nameOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 120) : "unknown";

export { PROMPT_VERSION };
