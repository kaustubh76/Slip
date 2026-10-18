/**
 * The one way Slip talks to an outside service. It does four things, and deliberately not a fifth:
 *
 * 1. It passes the caller's `AbortSignal` through, because the caller owns the deadline
 *    (`withDeadline` in `@slip/app`), not the adapter.
 * 2. **It never retries.** A retry inside an adapter could place a second order. When a call's
 *    outcome is unknown, the application keeps its write-ahead status and finishes later with the
 *    *same* request id; that is the only safe repeat, and it belongs to the resolver.
 * 3. It never throws on an HTTP status. A 402 or a 404 is an answer, and each adapter maps it to
 *    its own port's vocabulary.
 * 4. It tells the three kinds of outcome apart — a reply, an abort, and a transport failure —
 *    because an adapter must distinguish "the service said no" from "we never heard".
 *
 * `fetch` is injected, so every adapter is testable against recorded responses with no network.
 */

export type Fetch = typeof globalThis.fetch;

export interface JsonRequest {
  url: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Serialised as JSON when present; `Content-Type` is then set for you. */
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

/** The service answered. `body` is the parsed JSON, or `undefined` when there was none to parse. */
export interface JsonReply {
  outcome: "reply";
  status: number;
  body: unknown;
  /** The raw text, kept for a body that was not JSON (an HTML error page, say). */
  text: string;
  headers: Headers;
  /** False when a body arrived that was not JSON; `body` is then `undefined`. */
  parsed: boolean;
}

/** The caller's signal was aborted: the request may or may not have reached the service. */
export interface JsonAborted {
  outcome: "aborted";
}

/** Nothing came back: DNS, connection, TLS, a dropped socket. Equally undecided. */
export interface JsonUnreachable {
  outcome: "unreachable";
  detail: string;
}

export type JsonResult = JsonReply | JsonAborted | JsonUnreachable;

export interface JsonClient {
  send(request: JsonRequest): Promise<JsonResult>;
}

export interface JsonClientOptions {
  /** Defaults to the global `fetch`; injected in tests. */
  fetch?: Fetch;
  /** Sent on every request (an api key, a user agent). Per-request headers win. */
  headers?: Readonly<Record<string, string>>;
}

export function createJsonClient(options: JsonClientOptions = {}): JsonClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    async send(request) {
      const headers: Record<string, string> = {
        accept: "application/json",
        ...lowercased(options.headers),
        ...lowercased(request.headers),
      };
      if (request.body !== undefined) {
        headers["content-type"] = "application/json";
      }
      let response: Response;
      try {
        response = await doFetch(request.url, {
          method: request.method ?? "GET",
          headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: request.signal,
        });
      } catch (error) {
        // An abort arrives here as an exception; it is not a failure of the service.
        return request.signal.aborted || isAbortError(error)
          ? { outcome: "aborted" }
          : { outcome: "unreachable", detail: describe(error) };
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        // The status arrived but the body did not: still undecided.
        return request.signal.aborted || isAbortError(error)
          ? { outcome: "aborted" }
          : { outcome: "unreachable", detail: `body: ${describe(error)}` };
      }
      const json = parseJson(text);
      return {
        outcome: "reply",
        status: response.status,
        headers: response.headers,
        text,
        ...json,
      };
    },
  };
}

function parseJson(text: string): { body: unknown; parsed: boolean } {
  if (text.trim() === "") {
    // A 204, or any empty body: nothing to parse, and nothing wrong with that.
    return { body: undefined, parsed: true };
  }
  try {
    return { body: JSON.parse(text), parsed: true };
  } catch {
    return { body: undefined, parsed: false };
  }
}

/** Header names are case-insensitive; lower-casing ours keeps the later spread winning. */
function lowercased(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    out[name.toLowerCase()] = value;
  }
  return out;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** Enough to log, never the whole error object: a cause can carry request headers. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : null;
    return typeof code === "string"
      ? `${error.name}: ${error.message} (${code})`
      : `${error.name}: ${error.message}`;
  }
  return String(error);
}
