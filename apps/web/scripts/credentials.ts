import { createChannel3Offers } from "@slip/offers";
import { createPayPalApi } from "@slip/paypal";
import { checkSteeringCredential } from "@slip/steering";

/**
 * Does each outside service accept the credential this deployment holds? — asked for nothing, and
 * answered without printing any part of the answer.
 *
 * D92 is the reason this exists. The steering adapter turns a 401 into the same `NO_ANSWER` as a
 * slow model and keeps no reason, which is right for a checkout and invisible to an operator: a
 * revoked key holds every purchase whose price gap needed the check, with a receipt that reads
 * exactly like a model that ran out of time. Channel3 is blunted the same way by design — a 401
 * becomes `UNAVAILABLE`, "no prices right now" — and PayPal credentials that no longer work fail
 * at the token, inside a call that reports only that the payment did not happen.
 *
 * So each service is asked a question it can only answer if the credential works, and each
 * question is free:
 *
 * - **Anthropic** — `count_tokens`, which is not billed (D92).
 * - **Channel3** — a product id it cannot have. "Product detail is free, and search — which is not
 *   — is never used" (`packages/offers/src/live.test.ts`), and a 404 proves the base url, the path,
 *   the header and the key at once.
 * - **PayPal** — an order id it cannot have. Minting a client-credentials token and being told
 *   `404` moves no money.
 *
 * Nothing here prints a credential: not a value, not a prefix, not a length. A verdict names the
 * *variable* and what the service said about it, in Slip's own words — never a service's free
 * text, which is not Slip's voice and can carry a sentence written at whoever reads it (D61).
 */

export type CredentialState =
  /** The service accepted it. */
  | "works"
  /** The service refused it. This is the one an operator has to act on. */
  | "rejected"
  /** Nobody said no — the service could not be reached, or answered something unexpected. */
  | "unreachable"
  /** Not configured here, which is a choice and not a fault. */
  | "absent"
  /** Deliberately not asked. */
  | "skipped";

export interface CredentialVerdict {
  service: "Anthropic" | "Channel3" | "PayPal";
  /** The environment variable an operator would go and fix. */
  variable: string;
  state: CredentialState;
  detail: string;
}

/**
 * Only what a probe reads. Narrower than `NodeJS.ProcessEnv` on purpose: Next augments that type to
 * require `NODE_ENV`, which would make every caller — and every test fixture — carry a variable
 * none of this looks at.
 */
export type Env = Readonly<Record<string, string | undefined>>;

export interface ProbeOptions {
  fetch?: typeof globalThis.fetch;
}

/** A product id Channel3 cannot have, so the answer is about the key and not about a catalogue. */
const NO_SUCH_PRODUCT = "slip_no_such_product_000";
/** The same trick at PayPal: a 404 here means the token was minted, which is the whole question. */
const NO_SUCH_ORDER = "SLIPNOSUCHORDER00";

const value = (env: Env, name: string): string => env[name]?.trim() ?? "";

export async function probeSteering(
  env: Env,
  signal: AbortSignal,
  options: ProbeOptions = {},
): Promise<CredentialVerdict> {
  const variable = "ANTHROPIC_API_KEY";
  const apiKey = value(env, variable);
  const verdict = (state: CredentialState, detail: string): CredentialVerdict => ({
    service: "Anthropic",
    variable,
    state,
    detail,
  });
  if (apiKey === "") {
    return verdict("absent", "not set, so the steering check is the scripted stand-in");
  }
  const check = await checkSteeringCredential({
    apiKey,
    signal,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  if (check.ok) {
    return verdict("works", `Anthropic accepted it (${check.model})`);
  }
  return check.reason === "rejected"
    ? verdict("rejected", `Anthropic answered ${check.status ?? "a refusal"}: it did not accept it`)
    : verdict("unreachable", `the check could not be made (status ${check.status ?? "none"})`);
}

export async function probeChannel3(
  env: Env,
  signal: AbortSignal,
  options: ProbeOptions = {},
): Promise<CredentialVerdict> {
  const variable = "CHANNEL3_API_KEY";
  const apiKey = value(env, variable);
  const verdict = (state: CredentialState, detail: string): CredentialVerdict => ({
    service: "Channel3",
    variable,
    state,
    detail,
  });
  if (apiKey === "") {
    return verdict("absent", "not set, so prices come from the stand-in catalogue");
  }
  const result = await createChannel3Offers({
    apiKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  }).fetchProduct(NO_SUCH_PRODUCT, signal);
  if (result.ok) {
    // It cannot have this product, so a hit means something other than the key is wrong.
    return verdict("unreachable", "Channel3 answered with a product that cannot exist");
  }
  switch (result.reason) {
    case "NOT_FOUND":
      return verdict("works", "Channel3 accepted the key and has no such product, as expected");
    case "OUT_OF_CREDITS":
      // Worth its own line: the key is fine and the catalogue will still fail every search.
      return verdict("rejected", "the key works, but there are no catalogue credits left");
    case "RATE_LIMITED":
      return verdict("works", "Channel3 accepted the key and is rate limiting right now");
    case "TIMEOUT":
      return verdict("unreachable", "Channel3 did not answer in time");
    default:
      // The port folds a bad key into "no prices right now" on purpose, so the status in Slip's
      // own detail is the only thing that separates a refusal from Channel3 being down.
      return (result.detail ?? "").includes("401")
        ? verdict("rejected", "Channel3 answered 401: it did not accept the api key")
        : verdict("unreachable", result.detail ?? "Channel3 did not answer usefully");
  }
}

export async function probePayPal(
  env: Env,
  signal: AbortSignal,
  options: ProbeOptions = {},
): Promise<CredentialVerdict> {
  const variable = "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET";
  const clientId = value(env, "PAYPAL_CLIENT_ID");
  const clientSecret = value(env, "PAYPAL_CLIENT_SECRET");
  const verdict = (state: CredentialState, detail: string): CredentialVerdict => ({
    service: "PayPal",
    variable,
    state,
    detail,
  });
  if (clientId === "" || clientSecret === "") {
    return verdict("absent", "not set, so payment is the stand-in gateway");
  }
  if (value(env, "PAYPAL_ENV").toLowerCase() === "live") {
    // Nothing in this repository talks to live PayPal, and a check is not a reason to start.
    return verdict("skipped", "PAYPAL_ENV=live, and this command only ever asks the sandbox");
  }
  // No baseUrl: `createPayPalApi` defaults to the sandbox, and "the live base url is never a
  // default" is a property of that client worth leaning on rather than restating.
  const answer = await createPayPalApi({
    clientId,
    clientSecret,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  }).call({ path: `/v2/checkout/orders/${NO_SUCH_ORDER}` }, signal);
  if (answer.outcome === "no-answer") {
    return verdict("unreachable", `PayPal was not reached: ${answer.detail}`);
  }
  if (answer.outcome === "ok") {
    return verdict("unreachable", "PayPal answered with an order that cannot exist");
  }
  if (answer.status === 401 || answer.status === 403) {
    return verdict(
      "rejected",
      `the PayPal sandbox answered ${answer.status}: it did not accept it`,
    );
  }
  return answer.status === 404
    ? verdict("works", "the PayPal sandbox minted a token and has no such order, as expected")
    : verdict("unreachable", `the PayPal sandbox answered ${answer.status}`);
}

/** All three at once: they share a deadline and have nothing to say to each other. */
export async function probeAll(
  env: Env,
  signal: AbortSignal,
  options: ProbeOptions = {},
): Promise<CredentialVerdict[]> {
  return Promise.all([
    probeSteering(env, signal, options),
    probeChannel3(env, signal, options),
    probePayPal(env, signal, options),
  ]);
}

const MARK: Record<CredentialState, string> = {
  works: "ok",
  rejected: "REJECTED",
  unreachable: "unreachable",
  absent: "not configured",
  skipped: "skipped",
};

export function renderCredentials(verdicts: readonly CredentialVerdict[]): string {
  const lines = verdicts.map(
    (row) => `  ${row.service.padEnd(9)} ${MARK[row.state].padEnd(14)} ${row.detail}`,
  );
  const rejected = verdicts.filter((row) => row.state === "rejected");
  lines.unshift("Credentials, as the services themselves answered:", "");
  lines.push("");
  if (rejected.length === 0) {
    lines.push("Every credential set here was accepted. Nothing was spent asking.");
  } else {
    lines.push(
      `${rejected.length} of ${verdicts.length} will not work, and nothing in the application will` +
        " say so while it runs: a refused credential reaches the rules as the same no-answer a slow" +
        " service does, and holds the purchase. Fix before a demo:",
      ...rejected.map((row) => `  - ${row.variable} (${row.service})`),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** 0 when everything configured answered, 1 when any of it was refused. */
export function exitCodeFor(verdicts: readonly CredentialVerdict[]): 0 | 1 {
  return verdicts.some((row) => row.state === "rejected") ? 1 : 0;
}
