import { createJsonClient, type Fetch, type JsonClient } from "@slip/http";

/**
 * The PayPal REST call Slip makes, with the one piece of state a PayPal integration needs: an
 * access token, kept until it expires.
 *
 * Three rules, all of them from the way Slip writes payments ahead:
 *
 * 1. **Nothing throws.** Every answer is one of three outcomes — PayPal answered, PayPal refused
 *    (with a status and its issue codes), or Slip never heard. The third is what "unknown" is
 *    built from, and the adapters above map the other two onto their ports.
 * 2. **It never retries, and it owns no deadline.** The caller's `AbortSignal` goes straight to
 *    `fetch`. A second attempt at a money call belongs to the resolver, which repeats it with the
 *    *same* `PayPal-Request-Id` — the only repeat PayPal is guaranteed not to charge twice for.
 * 3. **An error detail is Slip's own words** (D61): the status, PayPal's issue codes, and the
 *    `debug_id` to quote at support. PayPal's free-text `message` is dropped, because these
 *    details are logged and shown.
 */

export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
export const PAYPAL_LIVE_BASE_URL = "https://api-m.paypal.com";

/** The token is replaced this long before it expires, so a call never carries a dying one. */
const TOKEN_MARGIN_MS = 60_000;

export interface PayPalApiOptions {
  clientId: string;
  clientSecret: string;
  /** Defaults to the sandbox: the live base url is never a default. */
  baseUrl?: string;
  fetch?: Fetch;
  client?: JsonClient;
  /** Injected in tests; the token cache's only clock. */
  now?: () => number;
}

export interface PayPalRequest {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Readonly<Record<string, string>>;
  /** `PayPal-Request-Id`: idempotency for anything that moves money. */
  requestId?: string;
  /** `Prefer: return=representation`, to be answered with the resource rather than a stub. */
  representation?: boolean;
}

export type PayPalAnswer =
  /** PayPal did it. 200, 201 or 204; `body` is `undefined` for a 204. */
  | { outcome: "ok"; status: number; body: unknown }
  /** PayPal refused, and said why. `issues` are the `details[].issue` codes, uppercase. */
  | { outcome: "error"; status: number; name: string; issues: readonly string[]; detail: string }
  /** Slip never heard: a timeout, a dropped connection, a token it could not get. */
  | { outcome: "no-answer"; detail: string };

export interface PayPalApi {
  call(request: PayPalRequest, signal: AbortSignal): Promise<PayPalAnswer>;
  /** Forgets the cached token, so the next call fetches a new one. */
  forgetToken(): void;
}

export function createPayPalApi(options: PayPalApiOptions): PayPalApi {
  const base = (options.baseUrl ?? PAYPAL_SANDBOX_BASE_URL).replace(/\/+$/, "");
  const now = options.now ?? (() => Date.now());
  const http =
    options.client ?? createJsonClient(options.fetch === undefined ? {} : { fetch: options.fetch });
  const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64");

  let token: { value: string; expiresAt: number } | null = null;

  /**
   * One token request per caller that needs one. Sharing a single in-flight request between
   * callers would let one caller's deadline abort another caller's payment, and a token request
   * moves no money: the worst an unshared one costs is a second token.
   */
  async function accessToken(signal: AbortSignal): Promise<string | PayPalAnswer> {
    const held = token;
    if (held !== null && held.expiresAt - TOKEN_MARGIN_MS > now()) {
      return held.value;
    }
    const result = await http.send({
      url: `${base}/v1/oauth2/token`,
      method: "POST",
      body: "grant_type=client_credentials",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      signal,
    });
    if (result.outcome !== "reply") {
      return noAnswer(result.outcome === "aborted" ? "the deadline passed" : result.detail);
    }
    if (result.status !== 200) {
      // A rejected secret is not something to retry inside a call; it is an operator's problem.
      return errorFrom(result.status, result.body, "token");
    }
    const body = result.body as { access_token?: unknown; expires_in?: unknown } | null;
    const value = typeof body?.access_token === "string" ? body.access_token : "";
    if (value === "") {
      return errorFrom(result.status, result.body, "token");
    }
    const lifetimeMs =
      typeof body?.expires_in === "number" && body.expires_in > 0 ? body.expires_in * 1_000 : 0;
    token = { value, expiresAt: now() + lifetimeMs };
    return value;
  }

  return {
    forgetToken() {
      token = null;
    },

    async call(request, signal): Promise<PayPalAnswer> {
      if (signal.aborted) {
        return noAnswer("the deadline passed before the call");
      }
      const bearer = await accessToken(signal);
      if (typeof bearer !== "string") {
        return bearer;
      }
      const query =
        request.query === undefined ? "" : `?${new URLSearchParams(request.query).toString()}`;
      const result = await http.send({
        url: `${base}${request.path}${query}`,
        ...(request.method === undefined ? {} : { method: request.method }),
        ...(request.body === undefined ? {} : { body: request.body }),
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(request.requestId === undefined ? {} : { "paypal-request-id": request.requestId }),
          ...(request.representation === true ? { prefer: "return=representation" } : {}),
        },
        signal,
      });
      if (result.outcome === "aborted") {
        return noAnswer("PayPal did not answer in time");
      }
      if (result.outcome === "unreachable") {
        return noAnswer(result.detail);
      }
      if (result.status === 401) {
        // The token was refused: drop it so the next call asks for a fresh one. This call is not
        // sent again here — nothing was processed, and the resolver repeats it with its own id.
        token = null;
        return noAnswer("PayPal rejected the access token");
      }
      if (result.status >= 200 && result.status < 300) {
        return { outcome: "ok", status: result.status, body: result.body };
      }
      return errorFrom(result.status, result.body, request.path);
    },
  };
}

const noAnswer = (detail: string): PayPalAnswer => ({ outcome: "no-answer", detail });

/**
 * PayPal's error envelope: `{name, message, debug_id, details: [{issue, description}]}`. The issue
 * codes are what the adapters decide on; `message` and `description` are free text and dropped.
 */
function errorFrom(status: number, body: unknown, where: string): PayPalAnswer {
  const envelope = body as { name?: unknown; debug_id?: unknown; details?: unknown } | null;
  const name = typeof envelope?.name === "string" ? envelope.name : "UNKNOWN";
  const issues = Array.isArray(envelope?.details)
    ? envelope.details
        .map((detail) => (detail as { issue?: unknown } | null)?.issue)
        .filter((issue): issue is string => typeof issue === "string")
        .map((issue) => issue.toUpperCase())
    : [];
  const debugId = typeof envelope?.debug_id === "string" ? envelope.debug_id : null;
  const said = issues.length === 0 ? name : `${name}: ${issues.join(", ")}`;
  return {
    outcome: "error",
    status,
    name,
    issues,
    detail: `PayPal answered ${status} on ${where} (${said})${debugId === null ? "" : ` debug_id ${debugId}`}`,
  };
}

/** True when PayPal named any of `codes` as an issue, or as the error's own name. */
export function said(answer: PayPalAnswer, ...codes: string[]): boolean {
  if (answer.outcome !== "error") {
    return false;
  }
  return codes.some((code) => answer.issues.includes(code) || answer.name === code);
}
