import { SLIP_WEBHOOK_EVENTS } from "@slip/paypal";
import { describe, expect, it } from "vitest";
import {
  type CapabilityVerdict,
  type CredentialVerdict,
  exitCodeFor,
  probeChannel3,
  probePayPal,
  probeReporting,
  probeSteering,
  probeWebhook,
  renderCapabilities,
  renderCredentials,
  type WebhookVerdict,
} from "./credentials";

/**
 * The probes against recorded answers. `fetch` is injected into the real clients the application
 * uses, so what is asserted is how each service's own adapter reports a refusal — including where
 * that adapter deliberately blunts one, which is the whole reason this command exists.
 */

type Fetch = typeof globalThis.fetch;

/** Answers each request in turn, newest first, and remembers what was asked. */
function stub(...answers: (Response | Error)[]) {
  const calls: string[] = [];
  let at = 0;
  const fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const answer = answers[Math.min(at++, answers.length - 1)];
    if (answer instanceof Error) {
      throw answer;
    }
    return (answer as Response).clone();
  }) as unknown as Fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const token = json(200, { access_token: "tok", expires_in: 3_600 });
const live = () => AbortSignal.timeout(5_000);

describe("Anthropic", () => {
  it("reports a key that is not set, and asks nothing", async () => {
    const { fetch, calls } = stub(json(200, {}));
    const verdict = await probeSteering({}, live(), { fetch });
    expect(verdict).toMatchObject({ state: "absent", variable: "ANTHROPIC_API_KEY" });
    expect(calls).toHaveLength(0);
  });

  it("counts tokens to prove the key, which costs nothing", async () => {
    const { fetch, calls } = stub(json(200, { input_tokens: 12 }));
    const verdict = await probeSteering({ ANTHROPIC_API_KEY: "sk-test" }, live(), { fetch });
    expect(verdict.state).toBe("works");
    expect(calls[0]).toContain("/v1/messages/count_tokens");
  });

  it("calls a 401 a refusal, which is the answer that held every purchase", async () => {
    const { fetch } = stub(json(401, { type: "error", error: { type: "authentication_error" } }));
    const verdict = await probeSteering({ ANTHROPIC_API_KEY: "sk-revoked" }, live(), { fetch });
    expect(verdict).toMatchObject({ state: "rejected" });
    expect(verdict.detail).toContain("401");
  });
});

describe("Channel3", () => {
  const env = { CHANNEL3_API_KEY: "c3-test" };

  it("reports a key that is not set", async () => {
    const { calls } = stub(json(200, {}));
    expect(await probeChannel3({}, live(), {})).toMatchObject({ state: "absent" });
    expect(calls).toHaveLength(0);
  });

  it("asks for a product it cannot have, and reads the 404 as the key working", async () => {
    const { fetch, calls } = stub(json(404, { detail: "not found" }));
    expect(await probeChannel3(env, live(), { fetch })).toMatchObject({ state: "works" });
    expect(calls[0]).toContain("slip_no_such_product_000");
    // Product detail is free; search is the call that costs a credit and is never made here.
    expect(calls[0]).toContain("/v1/products/");
    expect(calls.some((url) => url.includes("search"))).toBe(false);
  });

  it("finds the refusal inside UNAVAILABLE, which the port folds a bad key into", async () => {
    // A coupling test on purpose. `failureFor` maps 401 and 5xx alike to UNAVAILABLE — "no prices
    // right now" — and only the status in `detailOf`'s wording separates them. If that wording
    // ever changes, this fails rather than the doctor quietly calling a dead key a blip.
    const { fetch } = stub(json(401, { detail: "Invalid API key: c3-test" }));
    const verdict = await probeChannel3(env, live(), { fetch });
    expect(verdict).toMatchObject({ state: "rejected" });
    expect(verdict.detail).toContain("401");
    // And never the service's own words, which quote the key back.
    expect(verdict.detail).not.toContain("c3-test");
  });

  it("treats no credits left as something to fix, not as a working key", async () => {
    const { fetch } = stub(json(402, {}));
    const verdict = await probeChannel3(env, live(), { fetch });
    expect(verdict).toMatchObject({ state: "rejected" });
    expect(verdict.detail).toContain("credits");
  });

  it("does not blame the key for a rate limit or an outage", async () => {
    expect(await probeChannel3(env, live(), { fetch: stub(json(429, {})).fetch })).toMatchObject({
      state: "works",
    });
    expect(await probeChannel3(env, live(), { fetch: stub(json(503, {})).fetch })).toMatchObject({
      state: "unreachable",
    });
  });
});

describe("PayPal", () => {
  const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "shh" };

  it("reports credentials that are not set", async () => {
    expect(await probePayPal({ PAYPAL_CLIENT_ID: "id" }, live(), {})).toMatchObject({
      state: "absent",
    });
  });

  it("refuses to touch live, and sends nothing at all", async () => {
    const { fetch, calls } = stub(token);
    const verdict = await probePayPal({ ...env, PAYPAL_ENV: "live" }, live(), { fetch });
    expect(verdict).toMatchObject({ state: "skipped" });
    expect(verdict.detail).toContain("sandbox");
    expect(calls).toHaveLength(0);
  });

  it("mints a sandbox token and reads the 404 as the credentials working", async () => {
    const { fetch, calls } = stub(token, json(404, { name: "RESOURCE_NOT_FOUND" }));
    expect(await probePayPal(env, live(), { fetch })).toMatchObject({ state: "works" });
    expect(calls[0]).toContain("api-m.sandbox.paypal.com");
    expect(calls[0]).toContain("/v1/oauth2/token");
    expect(calls[1]).toContain("/v2/checkout/orders/SLIPNOSUCHORDER00");
    expect(calls.every((url) => !url.includes("api-m.paypal.com"))).toBe(true);
  });

  it("calls a rejected token what it is", async () => {
    const { fetch } = stub(json(401, { error: "invalid_client" }));
    expect(await probePayPal(env, live(), { fetch })).toMatchObject({ state: "rejected" });
  });

  it("does not blame the credentials when PayPal itself is unwell", async () => {
    const { fetch } = stub(token, json(500, { name: "INTERNAL_SERVICE_ERROR" }));
    expect(await probePayPal(env, live(), { fetch })).toMatchObject({ state: "unreachable" });
  });
});

/**
 * The feature, which is a different question from the credential. A working key with no
 * *Transaction Search* grant is the state this sandbox was actually in, undetected, for a day:
 * every checkout fine, every look backwards refused, and nothing anywhere saying so.
 */
describe("Transaction Search", () => {
  const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "shh" };

  it("asks the question the reconcile asks, so it is refused where the reconcile would be", async () => {
    const { fetch, calls } = stub(token, json(200, { transaction_details: [] }));
    expect(await probeReporting(env, live(), { fetch })).toMatchObject({ state: "granted" });
    expect(calls[1]).toContain("/v1/reporting/transactions");
    // The reconcile counts authorizations, which move no balance; a probe that filtered them out
    // could be granted where the reconcile is refused.
    expect(calls[1]).toContain("balance_affecting_records_only=N");
    expect(calls[1]).toMatch(/start_date=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}Z/);
  });

  it("reads PayPal's refusal as a feature nobody ticked", async () => {
    const { fetch } = stub(token, json(403, { name: "NOT_AUTHORIZED" }));
    const verdict = await probeReporting(env, live(), { fetch });
    expect(verdict).toMatchObject({ state: "not-granted" });
    expect(verdict.where).toContain("Features");
  });

  it("sends an operator to the credential line, not the dashboard, when the token is the problem", async () => {
    const { fetch } = stub(json(401, { error: "invalid_client" }));
    const verdict = await probeReporting(env, live(), { fetch });
    // Calling the feature missing here would be a wrong instruction, not merely a vague one.
    expect(verdict).toMatchObject({ state: "unreachable" });
    expect(verdict.detail).toContain("credentials");
  });

  it("does not call a feature missing because PayPal is unwell", async () => {
    const { fetch } = stub(token, json(500, { name: "INTERNAL_SERVICE_ERROR" }));
    expect(await probeReporting(env, live(), { fetch })).toMatchObject({ state: "unreachable" });
  });

  it("asks nothing when there is no credential to ask with, or when it would be live", async () => {
    const absent = stub(token);
    expect(await probeReporting({}, live(), { fetch: absent.fetch })).toMatchObject({
      state: "absent",
    });
    const onLive = stub(token);
    expect(
      await probeReporting({ ...env, PAYPAL_ENV: "live" }, live(), { fetch: onLive.fetch }),
    ).toMatchObject({ state: "skipped" });
    expect([...absent.calls, ...onLive.calls]).toHaveLength(0);
  });
});

/**
 * Where PayPal would deliver, which is a third kind of question: not whether a credential works,
 * nor what the application may do, but whether the two ends are pointed at each other. The sandbox
 * this was written against had a webhook left over from a quick tunnel whose host no longer
 * resolved, and PayPal had recorded nothing, because nothing had yet happened to deliver.
 */
describe("the webhook", () => {
  const env = {
    PAYPAL_CLIENT_ID: "id",
    PAYPAL_CLIENT_SECRET: "shh",
    SLIP_BASE_URL: "https://slip.example.com",
    PAYPAL_WEBHOOK_ID: "WH-OURS",
  };
  const hooks = (...webhooks: unknown[]) => json(200, { webhooks });
  const ours = (over: Record<string, unknown> = {}) => ({
    id: "WH-OURS",
    url: "https://slip.example.com/api/webhooks/paypal",
    event_types: SLIP_WEBHOOK_EVENTS.map((name) => ({ name })),
    ...over,
  });

  it("is content when PayPal would deliver here and this deployment would accept it", async () => {
    const { fetch, calls } = stub(token, hooks(ours()));
    const verdict = await probeWebhook(env, live(), { fetch });
    expect(verdict).toMatchObject({ state: "points-here" });
    expect(calls[1]).toContain("/v1/notifications/webhooks");
  });

  it("names both hosts when PayPal would deliver somewhere else", async () => {
    // The real case: a quick tunnel from yesterday, retried into a host that no longer resolves.
    const { fetch } = stub(
      token,
      hooks(ours({ url: "https://gone.trycloudflare.com/api/webhooks/paypal" })),
    );
    const verdict = await probeWebhook(env, live(), { fetch });
    expect(verdict).toMatchObject({ state: "points-elsewhere" });
    expect(verdict.detail).toContain("gone.trycloudflare.com");
    expect(verdict.detail).toContain("slip.example.com");
  });

  it("catches a subscription id that would refuse every delivery that did arrive", async () => {
    // The url is right, so PayPal delivers. Verification is per-subscription, and this one is not
    // the subscription, so each delivery is refused — which looks like none arriving.
    const { fetch } = stub(token, hooks(ours()));
    const verdict = await probeWebhook({ ...env, PAYPAL_WEBHOOK_ID: "WH-STALE" }, live(), {
      fetch,
    });
    expect(verdict).toMatchObject({ state: "points-elsewhere" });
    expect(verdict.detail).toContain("PAYPAL_WEBHOOK_ID");
  });

  it("notices when an event Slip acts on would not be sent at all", async () => {
    const short = SLIP_WEBHOOK_EVENTS.slice(0, 3).map((name) => ({ name }));
    const { fetch } = stub(token, hooks(ours({ event_types: short })));
    expect(await probeWebhook(env, live(), { fetch })).toMatchObject({ state: "points-elsewhere" });
  });

  it("says when the application has no webhook for Slip at all", async () => {
    const { fetch } = stub(
      token,
      hooks({ id: "WH-OTHER", url: "https://x.test/other", event_types: [] }),
    );
    const verdict = await probeWebhook(env, live(), { fetch });
    expect(verdict).toMatchObject({ state: "unregistered" });
    expect(verdict.detail).toContain("/api/webhooks/paypal");
  });

  it("does not call an unreachable deployment misconfigured, and asks PayPal nothing", async () => {
    // The ordinary local run. PayPal delivers only over https, so a localhost deployment cannot be
    // a destination and is not at fault for failing to be one — an exit code that failed here
    // would stop being read.
    const localhost = stub(token);
    const verdict = await probeWebhook({ ...env, SLIP_BASE_URL: "http://localhost:3000" }, live(), {
      fetch: localhost.fetch,
    });
    expect(verdict).toMatchObject({ state: "not-addressable" });
    expect(verdict.detail).toContain("https");
    const unset = stub(token);
    expect(
      await probeWebhook({ ...env, SLIP_BASE_URL: "" }, live(), { fetch: unset.fetch }),
    ).toMatchObject({ state: "not-addressable" });
    expect([...localhost.calls, ...unset.calls]).toHaveLength(0);
  });

  it("does not blame the setup when PayPal itself is unwell", async () => {
    const { fetch } = stub(token, json(500, { name: "INTERNAL_SERVICE_ERROR" }));
    expect(await probeWebhook(env, live(), { fetch })).toMatchObject({ state: "unreachable" });
  });

  it("asks nothing without credentials, or when it would be live", async () => {
    const absent = stub(token);
    expect(
      await probeWebhook({ SLIP_BASE_URL: env.SLIP_BASE_URL }, live(), { fetch: absent.fetch }),
    ).toMatchObject({ state: "absent" });
    const onLive = stub(token);
    expect(
      await probeWebhook({ ...env, PAYPAL_ENV: "live" }, live(), { fetch: onLive.fetch }),
    ).toMatchObject({ state: "skipped" });
    expect([...absent.calls, ...onLive.calls]).toHaveLength(0);
  });
});

describe("the report", () => {
  const verdict = (over: Partial<CredentialVerdict> = {}): CredentialVerdict => ({
    service: "Anthropic",
    variable: "ANTHROPIC_API_KEY",
    state: "works",
    detail: "Anthropic accepted it",
    ...over,
  });

  it("fails only on a refusal, not on a service nobody configured", () => {
    expect(exitCodeFor([verdict(), verdict({ state: "absent" })])).toBe(0);
    expect(exitCodeFor([verdict({ state: "unreachable" }), verdict({ state: "skipped" })])).toBe(0);
    expect(exitCodeFor([verdict(), verdict({ state: "rejected" })])).toBe(1);
  });

  it("names the variable to fix, and says why nothing else would have told them", () => {
    const page = renderCredentials([
      verdict({ state: "rejected", service: "Channel3", variable: "CHANNEL3_API_KEY" }),
    ]);
    expect(page).toContain("CHANNEL3_API_KEY");
    expect(page).toContain("holds the purchase");
  });

  it("says plainly when there is nothing to do", () => {
    expect(renderCredentials([verdict()])).toContain("Nothing was spent asking.");
  });

  const grant = (over: Partial<CapabilityVerdict> = {}): CapabilityVerdict => ({
    capability: "Transaction Search",
    where: "PayPal dashboard \u2192 Apps & Credentials \u2192 your app \u2192 Features",
    state: "granted",
    detail: "PayPal answered a reporting query",
    ...over,
  });

  it("fails on a feature nobody granted, which breaks no checkout and is still a failure", () => {
    // Exiting 0 here would move the silence up a level: the script passes, nobody reads the text.
    expect(exitCodeFor([verdict()], [grant()])).toBe(0);
    expect(exitCodeFor([verdict()], [grant({ state: "not-granted" })])).toBe(1);
    expect(exitCodeFor([verdict()], [grant({ state: "unreachable" })])).toBe(0);
    // The old single-argument contract still means what it meant.
    expect(exitCodeFor([verdict()])).toBe(0);
  });

  it("says what a missing feature stops, and what it does not stop", () => {
    const page = renderCapabilities([grant({ state: "not-granted" })]);
    expect(page).toContain("NOT GRANTED");
    expect(page).toContain("The checkout is unaffected");
    expect(page).toContain("Neither will complain");
    expect(page).toContain("Features");
  });

  it("does not send anyone to a dashboard when the feature is there", () => {
    const page = renderCapabilities([grant()]);
    expect(page).toContain("Nothing Slip reads from PayPal is turned off.");
    expect(page).not.toContain("Turn on:");
  });

  const delivery = (over: Partial<WebhookVerdict> = {}): WebhookVerdict => ({
    state: "points-here",
    detail: "PayPal would deliver to slip.example.com, which is this deployment",
    ...over,
  });

  it("fails on a webhook pointed away, and not on one that could never be pointed here", () => {
    expect(exitCodeFor([verdict()], [grant()], delivery())).toBe(0);
    expect(exitCodeFor([verdict()], [grant()], delivery({ state: "points-elsewhere" }))).toBe(1);
    expect(exitCodeFor([verdict()], [grant()], delivery({ state: "unregistered" }))).toBe(1);
    // The ordinary local run, which is not a fault and must not fail the gate.
    expect(exitCodeFor([verdict()], [grant()], delivery({ state: "not-addressable" }))).toBe(0);
    expect(exitCodeFor([verdict()], [grant()], delivery({ state: "unreachable" }))).toBe(0);
  });

  it("says a misdirected webhook loses later news, not the payment itself", () => {
    const page = renderCapabilities([grant()], delivery({ state: "points-elsewhere" }));
    expect(page).toContain("NOT HERE");
    expect(page).toContain("nothing will say so");
    expect(page).toContain("pnpm paypal:webhook");
    // It must not claim the checkout is broken: the resolver reads an order back by id.
    expect(page).toContain("Nothing needs it to take a payment");
  });

  it("stays quiet about a webhook that is where it should be", () => {
    const page = renderCapabilities([grant()], delivery());
    expect(page).toContain("Nothing Slip reads from PayPal is turned off.");
    expect(page).not.toContain("pnpm paypal:webhook");
  });

  it("reports both faults at once rather than only the first", () => {
    const page = renderCapabilities(
      [grant({ state: "not-granted" })],
      delivery({ state: "points-elsewhere" }),
    );
    expect(page).toContain("Turn on:");
    expect(page).toContain("Re-point it:");
    expect(page).not.toContain("Nothing Slip reads from PayPal is turned off.");
  });

  it("prints no part of any credential, and no prices", () => {
    const page = renderCredentials([
      verdict({ detail: "Anthropic accepted it (claude-opus-5-5)" }),
      verdict({ service: "Channel3", variable: "CHANNEL3_API_KEY", state: "rejected" }),
    ]);
    for (const secret of ["sk-ant-", "c3-test", "shh", "Bearer "]) {
      expect(page).not.toContain(secret);
    }
    expect(page).not.toMatch(/\$|USD/);
  });
});
