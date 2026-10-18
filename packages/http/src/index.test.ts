import { describe, expect, it, vi } from "vitest";
import { createJsonClient, type Fetch, type JsonResult } from "./index.js";

const live = () => new AbortController().signal;

/** A `fetch` that records what it was asked and answers with whatever is given. */
type FetchArgs = Parameters<Fetch>;

function stub(
  answer: Response | Error | ((input: FetchArgs[0], init: FetchArgs[1]) => Promise<Response>),
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (input: FetchArgs[0], init?: FetchArgs[1]) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (answer instanceof Error) {
      throw answer;
    }
    if (typeof answer === "function") {
      return answer(input, init);
    }
    return answer;
  }) as Fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("what it sends", () => {
  it("passes the method, the headers and the caller's signal through", async () => {
    const { fetch, calls } = stub(json(200, { ok: true }));
    const client = createJsonClient({ fetch, headers: { "x-api-key": "secret" } });
    const signal = live();
    await client.send({
      url: "https://api.example/v1/products/p1",
      headers: { "x-user-id": "u1" },
      signal,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example/v1/products/p1");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.signal).toBe(signal);
    expect(calls[0]?.init.headers).toEqual({
      accept: "application/json",
      "x-api-key": "secret",
      "x-user-id": "u1",
    });
    // No body, so no content-type invented.
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("serialises a body as JSON and says so", async () => {
    const { fetch, calls } = stub(json(201, {}));
    const client = createJsonClient({ fetch });
    await client.send({
      url: "https://api.example/v2/checkout/orders",
      method: "POST",
      body: { intent: "CAPTURE", amount: 1299 },
      signal: live(),
    });
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe('{"intent":"CAPTURE","amount":1299}');
    expect(calls[0]?.init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("lets a per-request header override a standing one, whatever its case", async () => {
    const { fetch, calls } = stub(json(200, {}));
    const client = createJsonClient({ fetch, headers: { Authorization: "Bearer old" } });
    await client.send({
      url: "https://api.example/x",
      headers: { authorization: "Bearer new" },
      signal: live(),
    });
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer new" });
    expect(Object.keys(calls[0]?.init.headers as object)).not.toContain("Authorization");
  });
});

describe("what it answers", () => {
  const send = async (answer: Parameters<typeof stub>[0], signal = live()): Promise<JsonResult> => {
    const { fetch } = stub(answer);
    return createJsonClient({ fetch }).send({ url: "https://api.example/x", signal });
  };

  it("an ordinary reply, with the body parsed", async () => {
    const result = await send(json(200, { id: "p1", offers: [] }));
    expect(result).toMatchObject({
      outcome: "reply",
      status: 200,
      parsed: true,
      body: { id: "p1", offers: [] },
    });
  });

  it.each([400, 401, 402, 404, 409, 422, 429, 500, 503])(
    "a %i is an answer, not an exception",
    async (status) => {
      const result = await send(json(status, { name: "RESOURCE_NOT_FOUND" }));
      expect(result).toMatchObject({
        outcome: "reply",
        status,
        body: { name: "RESOURCE_NOT_FOUND" },
      });
    },
  );

  it("a body that is not JSON is reported, not thrown", async () => {
    const result = await send(
      new Response("<html>gateway timeout</html>", {
        status: 504,
        headers: { "content-type": "text/html" },
      }),
    );
    expect(result).toMatchObject({ outcome: "reply", status: 504, parsed: false, body: undefined });
    expect(result).toMatchObject({ text: "<html>gateway timeout</html>" });
  });

  it("an empty body is fine: there was nothing to parse", async () => {
    // A 204 carries no body by definition, so the client must not treat that as unparsable.
    const result = await send(new Response(null, { status: 204 }));
    expect(result).toMatchObject({ outcome: "reply", status: 204, parsed: true, body: undefined });
  });

  it("the caller's abort is its own outcome", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    expect(await send(error, controller.signal)).toEqual({ outcome: "aborted" });
  });

  it("an abort mid-flight is an abort even when the signal reads clean", async () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    expect(await send(error)).toEqual({ outcome: "aborted" });
  });

  it("a transport failure says so, with enough detail to log", async () => {
    const error = new TypeError("fetch failed");
    error.cause = { code: "ECONNREFUSED" };
    const result = await send(error);
    expect(result).toMatchObject({ outcome: "unreachable" });
    expect(result).toMatchObject({ detail: "TypeError: fetch failed (ECONNREFUSED)" });
  });

  it("a body that dies halfway is undecided, not a reply", async () => {
    const result = await send(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("socket hang up"));
          },
        }),
        { status: 200 },
      ),
    );
    expect(result.outcome).toBe("unreachable");
  });
});

describe("what it will not do", () => {
  it("never retries — one call out, one call made", async () => {
    const { fetch, calls } = stub(json(503, { error: "try again" }));
    await createJsonClient({ fetch }).send({ url: "https://api.example/x", signal: live() });
    expect(calls).toHaveLength(1);
  });

  it("never retries a transport failure either", async () => {
    const { fetch, calls } = stub(new TypeError("fetch failed"));
    const result = await createJsonClient({ fetch }).send({
      url: "https://api.example/x",
      signal: live(),
    });
    expect(result.outcome).toBe("unreachable");
    expect(calls).toHaveLength(1);
  });

  it("imposes no deadline of its own: a slow reply is awaited until the caller aborts", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { fetch } = stub(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      );
      const pending = createJsonClient({ fetch }).send({
        url: "https://api.example/slow",
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      controller.abort();
      expect(await pending).toEqual({ outcome: "aborted" });
    } finally {
      vi.useRealTimers();
    }
  });
});
