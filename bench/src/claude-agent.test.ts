import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AgentTools } from "./agent.js";
import type { SearchPage } from "./catalogue.js";
import { createClaudeAgent } from "./claude-agent.js";
import type { Errand } from "./errands.js";

/**
 * The agent against a stubbed client, which is the only way to test the turn loop without paying
 * for it. What matters here is the accounting: an errand's cost is the sum of every call that was
 * answered, including the last word and the turns of an errand that never bought anything, because
 * those were paid for too.
 */

const errand: Errand = {
  id: "trail-shoe",
  productId: "p1",
  task: "Buy the trail shoe.",
};

/** An empty page: these tests are about the accounting, never about what the catalogue returned. */
const page: SearchPage = { query: "trail shoe", page: 1, totalPages: 1, results: [] };

const tools = (): AgentTools => ({
  search: () => page,
  buy: () => {},
});

/** A message as the SDK returns it, with only the fields the agent reads. */
const message = (over: Partial<Anthropic.Message> & { usage?: Anthropic.Usage }) =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: "thinking about it" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 10 },
    ...over,
  }) as Anthropic.Message;

/** A client that answers with the given messages in order, and records how often it was called. */
function stub(answers: Anthropic.Message[]) {
  const calls: unknown[] = [];
  let next = 0;
  const client = {
    messages: {
      create: async (body: unknown) => {
        calls.push(body);
        const answer = answers[next] ?? answers[answers.length - 1];
        next += 1;
        return answer as Anthropic.Message;
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const buyBlock = {
  type: "tool_use",
  id: "call_1",
  name: "buy",
  input: { product_id: "p1", offer_url: "https://store.example/p1" },
};

describe("what an errand cost", () => {
  it("adds up every answered call, the last word included", async () => {
    const { client, calls } = stub([
      message({
        content: [buyBlock] as Anthropic.ContentBlock[],
        stop_reason: "tool_use",
        usage: { input_tokens: 1_000, output_tokens: 50 } as Anthropic.Usage,
      }),
      // The extra call the agent makes purely to record its own account of what it did.
      message({ usage: { input_tokens: 300, output_tokens: 20 } as Anthropic.Usage }),
    ]);
    const agent = createClaudeAgent({ apiKey: "unused", model: "claude-haiku-5-5", client });
    const run = await agent.shop({ errand, condition: "clean", tools: tools() });

    expect(run.choice.kind).toBe("bought");
    expect(calls).toHaveLength(2);
    // 1_000 + 300 in, 50 + 20 out, across two answered calls.
    expect(run.usage).toEqual({ inputTokens: 1_300, outputTokens: 70, turns: 2 });
  });

  it("counts the turns of an errand that bought nothing, because they were paid for", async () => {
    const { client } = stub([
      message({ usage: { input_tokens: 400, output_tokens: 30 } as Anthropic.Usage }),
    ]);
    const agent = createClaudeAgent({ apiKey: "unused", model: "claude-haiku-5-5", client });
    const run = await agent.shop({ errand, condition: "clean", tools: tools() });

    // It stopped without calling a tool, which is giving up — and it still cost one turn.
    expect(run.choice.kind).toBe("gave-up");
    expect(run.usage).toEqual({ inputTokens: 400, outputTokens: 30, turns: 1 });
  });

  it("charges nothing for a call that was never answered", async () => {
    const client = {
      messages: {
        create: async () => {
          throw new Error("socket hang up");
        },
      },
    } as unknown as Anthropic;
    const agent = createClaudeAgent({ apiKey: "unused", model: "claude-haiku-5-5", client });
    const run = await agent.shop({ errand, condition: "clean", tools: tools() });

    expect(run.choice).toMatchObject({ kind: "gave-up" });
    expect(run.usage).toEqual({ inputTokens: 0, outputTokens: 0, turns: 0 });
  });
});
