import { createChannel3Offers } from "@slip/offers";
import { createPayPalApi, SLIP_WEBHOOK_EVENTS } from "@slip/paypal";
import { checkSteeringCredential } from "@slip/steering";
import { publicBaseUrl, publicUrl } from "../src/server/public-url";
import { type ExistingWebhook, planWebhook, WEBHOOK_PATH } from "./paypal-admin";

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

export type CapabilityState =
  /** PayPal let this application use it. */
  | "granted"
  /** PayPal refused: the application does not have the feature. */
  | "not-granted"
  /** Nobody said no — PayPal could not be reached, or answered something unexpected. */
  | "unreachable"
  /** There are no PayPal credentials here to ask with. */
  | "absent"
  /** Deliberately not asked. */
  | "skipped";

/**
 * A feature PayPal grants an *application*, which is a different question from a credential it
 * accepts. There is no environment variable in here, because there is nothing in a deployment to
 * fix: the fix is a checkbox on somebody's dashboard.
 *
 * It is asked for the same reason the credentials are, only more so — **a missing grant is quieter
 * than a bad key.** A bad key fails every payment. A missing grant leaves the checkout working
 * perfectly and disables only the parts that look *backwards* at what PayPal already has, where
 * `packages/paypal/src/search.ts` maps a refusal to `unknown` and never to "no such payment". That
 * is the only safe reading — Slip has not looked, so it may not conclude anything — and it is also
 * a perfectly silent one. A reconcile that cannot look is indistinguishable, from outside, from
 * one that looked and found nothing wrong.
 */
export interface CapabilityVerdict {
  capability: "Transaction Search";
  /** Where it is turned on, since it is not a variable. */
  where: string;
  state: CapabilityState;
  detail: string;
}

export type WebhookState =
  /** PayPal will deliver to this deployment, and this deployment will accept it. */
  | "points-here"
  /** PayPal will deliver somewhere else, or here to a deployment that will reject it. */
  | "points-elsewhere"
  /** This PayPal application has no webhook for Slip's path. */
  | "unregistered"
  /** This deployment has no public https address, so neither of the above can be true of it. */
  | "not-addressable"
  /** Nobody said no — PayPal could not be reached, or answered something unexpected. */
  | "unreachable"
  /** There are no PayPal credentials here to ask with. */
  | "absent"
  /** Deliberately not asked. */
  | "skipped";

/**
 * Will PayPal's events reach this deployment? Two silences in one question, because either answer
 * is "no event ever arrives" and neither says so:
 *
 * - PayPal delivers to the **url registered on the application**, which is wherever it was last
 *   pointed. A quick tunnel's address changes every run, so a webhook left over from yesterday
 *   points at a host that no longer resolves, and PayPal retries into nothing.
 * - This deployment accepts a delivery only if `PAYPAL_WEBHOOK_ID` names the webhook it arrived
 *   under, because verification is per-subscription. A stale id rejects every delivery that *did*
 *   arrive, which looks the same from here as none arriving.
 *
 * Nothing in Slip depends on this to take a payment: the resolver reads an order back itself. What
 * webhooks add is hearing about what happens *later* — a capture completing, an authorization
 * voided, a vault token deleted — without waiting for the next sweep.
 */
export interface WebhookVerdict {
  state: WebhookState;
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
/** Smaller than any window the reconcile asks for. The question is the permission, not the rows. */
const REPORTING_PROBE_WINDOW_MS = 60 * 60 * 1000;

/** PayPal's reporting wants seconds and no fraction of one, as `search.ts` also has to know. */
const reportingDate = (when: Date): string => `${when.toISOString().slice(0, 19)}Z`;

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

/**
 * Can this deployment read PayPal's own records? — asked the way the reconcile asks it, so that
 * the probe is refused in exactly the cases the reconcile would be.
 *
 * *Transaction Search* is off by default on a new PayPal application, and two things here need it:
 * the daily reconcile that compares Slip's ledger against PayPal's, and the last-resort lookup for
 * a payment whose order id Slip never learned (`resolver.ts`, the `findOrderByInvoice` branch).
 * The resolver's other branches do not need it — a known order id is read through
 * `/v2/checkout/orders`, which every application may do. So this is not a demo blocker, and
 * saying so is part of the answer: an operator told that everything is broken fixes nothing.
 *
 * Free. Reporting is not billed, and one hour is a smaller window than anything the reconcile
 * asks for.
 */
export async function probeReporting(
  env: Env,
  signal: AbortSignal,
  options: ProbeOptions = {},
): Promise<CapabilityVerdict> {
  const verdict = (state: CapabilityState, detail: string): CapabilityVerdict => ({
    capability: "Transaction Search",
    where: "PayPal dashboard \u2192 Apps & Credentials \u2192 your app \u2192 Features",
    state,
    detail,
  });
  const clientId = value(env, "PAYPAL_CLIENT_ID");
  const clientSecret = value(env, "PAYPAL_CLIENT_SECRET");
  if (clientId === "" || clientSecret === "") {
    // The stand-in gateway keeps its own records, so there is nothing to reconcile against.
    return verdict("absent", "no PayPal credentials here, so payment is the stand-in gateway");
  }
  if (value(env, "PAYPAL_ENV").toLowerCase() === "live") {
    return verdict("skipped", "PAYPAL_ENV=live, and this command only ever asks the sandbox");
  }
  const to = new Date();
  const from = new Date(to.getTime() - REPORTING_PROBE_WINDOW_MS);
  const answer = await createPayPalApi({
    clientId,
    clientSecret,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  }).call(
    {
      path: "/v1/reporting/transactions",
      headers: { "paypal-enforce-iso8601-format": "true" },
      query: {
        start_date: reportingDate(from),
        end_date: reportingDate(to),
        fields: "transaction_info",
        balance_affecting_records_only: "N",
        page_size: "1",
        page: "1",
      },
    },
    signal,
  );
  if (answer.outcome === "ok") {
    return verdict("granted", "PayPal answered a reporting query, so the reconcile can look");
  }
  if (answer.outcome === "no-answer") {
    return verdict("unreachable", `PayPal was not reached: ${answer.detail}`);
  }
  if (answer.status === 403 || answer.name === "NOT_AUTHORIZED") {
    return verdict(
      "not-granted",
      "PayPal refused the query: this application does not have the feature",
    );
  }
  if (answer.status === 401) {
    // The credential itself is the problem, and its own line above says so. Claiming the feature
    // is missing would send an operator to the wrong dashboard page.
    return verdict("unreachable", "the credentials were refused, so this could not be asked");
  }
  return verdict("unreachable", `PayPal answered ${answer.status} to a reporting query`);
}

export async function probeWebhook(
  env: Env,
  signal: AbortSignal,
  options: ProbeOptions = {},
): Promise<WebhookVerdict> {
  const clientId = value(env, "PAYPAL_CLIENT_ID");
  const clientSecret = value(env, "PAYPAL_CLIENT_SECRET");
  if (clientId === "" || clientSecret === "") {
    return { state: "absent", detail: "no PayPal credentials here, so no webhook to ask about" };
  }
  if (value(env, "PAYPAL_ENV").toLowerCase() === "live") {
    return {
      state: "skipped",
      detail: "PAYPAL_ENV=live, and this command only ever asks the sandbox",
    };
  }
  // PayPal will not deliver to anything but https, so a deployment without a public https address
  // cannot be a webhook's destination and is not misconfigured for failing to be one. Saying
  // otherwise would fail the ordinary local run, which is how an exit code stops being read.
  const base = publicBaseUrl(env as NodeJS.ProcessEnv);
  const ours = base === "" ? null : safeUrl(publicUrl(base, WEBHOOK_PATH).href);
  if (ours === null || ours.protocol !== "https:") {
    return {
      state: "not-addressable",
      detail:
        base === ""
          ? "neither SLIP_BASE_URL nor RENDER_EXTERNAL_URL is set, so PayPal has no address to reach"
          : `SLIP_BASE_URL is ${base}, which PayPal cannot deliver to: events arrive only over https`,
    };
  }
  const answer = await createPayPalApi({
    clientId,
    clientSecret,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  }).call({ path: "/v1/notifications/webhooks" }, signal);
  if (answer.outcome === "no-answer") {
    return { state: "unreachable", detail: `PayPal was not reached: ${answer.detail}` };
  }
  if (answer.outcome !== "ok") {
    return { state: "unreachable", detail: `PayPal answered ${answer.status} listing webhooks` };
  }
  const listed = (answer.body as { webhooks?: ExistingWebhook[] } | null)?.webhooks ?? [];
  // The same plan the registration script makes, so this agrees with `pnpm paypal:webhook` by
  // construction rather than by both of them being written carefully on separate days.
  const plan = planWebhook(listed, ours.href, SLIP_WEBHOOK_EVENTS);
  if (plan.action === "create") {
    return {
      state: "unregistered",
      detail: `this PayPal application has no webhook for ${WEBHOOK_PATH}`,
    };
  }
  const registered = listed.find((hook) => hook.id === plan.id);
  const host = registered === undefined ? null : (safeUrl(registered.url)?.host ?? null);
  if (plan.action === "update") {
    return {
      state: "points-elsewhere",
      detail:
        host === null || host === ours.host
          ? `the webhook is registered but does not match: PayPal would not send every event Slip acts on`
          : `PayPal would deliver to ${host}, and this deployment is ${ours.host}`,
    };
  }
  return plan.id === value(env, "PAYPAL_WEBHOOK_ID")
    ? {
        state: "points-here",
        detail: `PayPal would deliver to ${ours.host}, which is this deployment`,
      }
    : {
        state: "points-elsewhere",
        detail:
          "PayPal would deliver here, but PAYPAL_WEBHOOK_ID names a different webhook, so every" +
          " delivery fails verification and is refused",
      };
}

/** A url that may be nonsense, since PayPal returns whatever was registered. */
function safeUrl(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** What `probeAll` found: three kinds of answer, which are read differently. */
export interface Checkup {
  credentials: readonly CredentialVerdict[];
  capabilities: readonly CapabilityVerdict[];
  webhook: WebhookVerdict;
}

/** All of it at once: they share a deadline and have nothing to say to each other. */
export async function probeAll(
  env: Env,
  signal: AbortSignal,
  options: ProbeOptions = {},
): Promise<Checkup> {
  const [steering, channel3, paypal, reporting, webhook] = await Promise.all([
    probeSteering(env, signal, options),
    probeChannel3(env, signal, options),
    probePayPal(env, signal, options),
    probeReporting(env, signal, options),
    probeWebhook(env, signal, options),
  ]);
  return { credentials: [steering, channel3, paypal], capabilities: [reporting], webhook };
}

const MARK: Record<CredentialState, string> = {
  works: "ok",
  rejected: "REJECTED",
  unreachable: "unreachable",
  absent: "not configured",
  skipped: "skipped",
};

const GRANT: Record<CapabilityState, string> = {
  granted: "ok",
  "not-granted": "NOT GRANTED",
  unreachable: "unreachable",
  absent: "not configured",
  skipped: "skipped",
};

const DELIVERY: Record<WebhookState, string> = {
  "points-here": "ok",
  "points-elsewhere": "NOT HERE",
  unregistered: "NONE",
  "not-addressable": "no address",
  unreachable: "unreachable",
  absent: "not configured",
  skipped: "skipped",
};

/** A misdirected webhook is only a fault where PayPal could have reached this deployment. */
const WEBHOOK_AT_FAULT: readonly WebhookState[] = ["points-elsewhere", "unregistered"];

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

/**
 * The second section, and a separate one on purpose: what PayPal has granted this application, and
 * where it would deliver events, are not credentials anybody can fix. Printing them among the
 * credentials would have an operator searching `.env.local` for a checkbox.
 */
export function renderCapabilities(
  verdicts: readonly CapabilityVerdict[],
  webhook?: WebhookVerdict,
): string {
  if (verdicts.length === 0 && webhook === undefined) {
    return "";
  }
  const lines = [
    "How this PayPal application is set up:",
    "",
    ...verdicts.map(
      (row) => `  ${row.capability.padEnd(18)} ${GRANT[row.state].padEnd(14)} ${row.detail}`,
    ),
    ...(webhook === undefined
      ? []
      : [`  ${"Webhook".padEnd(18)} ${DELIVERY[webhook.state].padEnd(14)} ${webhook.detail}`]),
    "",
  ];
  const missing = verdicts.filter((row) => row.state === "not-granted");
  const misdirected = webhook !== undefined && WEBHOOK_AT_FAULT.includes(webhook.state);
  if (missing.length === 0 && !misdirected) {
    lines.push("Nothing Slip reads from PayPal is turned off.");
  }
  if (misdirected) {
    lines.push(
      "No PayPal event will reach this deployment, and nothing will say so: an undelivered" +
        " webhook is retried out of sight, and a delivery refused for the wrong subscription id" +
        " looks from here exactly like one that never came. Nothing needs it to take a payment —" +
        " the resolver reads an order back itself — so what is lost is hearing what happens" +
        " *later* without waiting for the next sweep. Re-point it:",
      "  - pnpm paypal:webhook https://<this deployment> --save",
    );
  }
  if (missing.length > 0) {
    lines.push(
      "The checkout is unaffected: a payment Slip knows the order id of is read straight back," +
        " and that needs no feature. What stops is every look *backwards* — the daily reconcile" +
        " against PayPal's own records, and the last-resort lookup for a payment whose order id" +
        ' was never learned. Neither will complain. A refusal is read as "not known" rather than' +
        ' as "no such payment", which is the only safe reading and a silent one. Turn on:',
      ...missing.map((row) => `  - ${row.capability} \u2014 ${row.where}`),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Both sections, in the order an operator should read them: the keys, then the setup. */
export function renderCheckup(checkup: Checkup): string {
  const setup = renderCapabilities(checkup.capabilities, checkup.webhook);
  return `${renderCredentials(checkup.credentials)}${setup === "" ? "" : `\n${setup}`}`;
}

/**
 * 0 when everything configured answered, 1 when anything this deployment needs was refused —
 * a credential or a feature.
 *
 * A missing feature counts. It would be easier to leave it out, since it breaks no checkout, but
 * a probe that finds the silent failure and then exits 0 has moved the silence up one level: the
 * pre-deploy script still passes and nobody reads the paragraph. The two are told apart in the
 * text, which is where the difference belongs, and not in the code a machine reads.
 */
export function exitCodeFor(
  verdicts: readonly CredentialVerdict[],
  capabilities: readonly CapabilityVerdict[] = [],
  webhook?: WebhookVerdict,
): 0 | 1 {
  const refused =
    verdicts.some((row) => row.state === "rejected") ||
    capabilities.some((row) => row.state === "not-granted") ||
    (webhook !== undefined && WEBHOOK_AT_FAULT.includes(webhook.state));
  return refused ? 1 : 0;
}
