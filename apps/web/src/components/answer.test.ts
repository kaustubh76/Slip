import { describe, expect, it } from "vitest";
import { answerOf } from "./answer";

describe("answerOf", () => {
  it("passes an answer through", async () => {
    await expect(answerOf(Promise.resolve({ status: "done" as const }))).resolves.toEqual({
      status: "done",
    });
  });

  it("turns a call that never answered into unknown, never a failure", async () => {
    await expect(answerOf(Promise.reject(new TypeError("fetch failed")))).resolves.toEqual({
      status: "unknown",
    });
  });
});
