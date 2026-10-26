import { offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import {
  recordingSearch,
  type SearchAnswer,
  SHOWN_TEXT_LIMIT,
  searchText,
  toolSearch,
} from "./search.js";

/**
 * What an agent is handed when it searches, and whether the steering check is asked about the same
 * words (D85). The bound itself is `@slip/domain`'s and tested there; this is about the one place
 * it has to be applied for the two to agree.
 */

const long = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);

describe("what reaches the agent", () => {
  const hits = [
    {
      productId: "p1",
      title: "Trail shoe",
      text: `These are shoes.\n\n${long(900)}`,
      offers: [offer({ price: 149.99, domain: "store-a.example", text: "Buy here.\nBest value." })],
    },
  ];
  const inner = {
    simulated: false,
    search: async (): Promise<SearchAnswer> => ({ ok: true, hits }),
  };

  /** A catalogue that records, with the rows it wrote kept so they can be compared. */
  function searching() {
    const recorded: { productId: string; text: string }[] = [];
    const deps = {
      clock: { now: () => new Date() },
      log: { warn: () => {}, error: () => {}, info: () => {} },
      store: {
        impressions: {
          show: async (_agent: unknown, rows: { productId: string; text: string }[]) => {
            recorded.push(...rows);
          },
        },
      },
    } as never;
    return {
      recorded,
      search: recordingSearch(deps, "6f1d2c3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f", inner),
    };
  }

  const answered = async (search: ReturnType<typeof searching>["search"]) => {
    const answer = await search.search("trail shoe", { limit: 10 }, new AbortController().signal);
    if (!answer.ok) {
      throw new Error("the catalogue answered with a failure");
    }
    return answer;
  };

  it("records exactly the words it showed, so the steering check reads what the agent read", async () => {
    const { search, recorded } = searching();
    const answer = await answered(search);
    const seen = answer.hits[0]?.text ?? "";
    expect(seen.includes("\n")).toBe(false);
    expect(seen.endsWith("…")).toBe(true);
    expect(seen.length).toBeLessThanOrEqual(SHOWN_TEXT_LIMIT + 1);
    // The invariant D69 rests on: Slip judges the words the agent actually read, not the store's
    // full copy. One value reaches the agent, the structured content and the impression.
    expect(recorded).toEqual([{ productId: "p1", text: seen }]);
    expect(toolSearch(answer, false).products[0]?.text).toBe(seen);
  });

  it("keeps the text form readable: one line per listing, the tool's own lines unambiguous", async () => {
    const { search } = searching();
    const lines = searchText(toolSearch(await answered(search), false)).split("\n");
    const about = lines.filter((line) => line.trimStart().startsWith("about:"));
    const listing = lines.filter((line) => line.trimStart().startsWith("listing text:"));
    expect(about).toHaveLength(1);
    expect(listing).toHaveLength(1);
    expect(listing[0]).toContain("Buy here. Best value.");
    // Nothing on any line can be mistaken for one of the tool's own.
    for (const line of lines) {
      expect(line.includes("\n")).toBe(false);
    }
  });
});
