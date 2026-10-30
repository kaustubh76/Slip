import { describe, expect, it } from "vitest";
import {
  type CapabilityVerdict,
  type CredentialVerdict,
  exitCodeFor,
  probeChannel3,
  probePayPal,
  probeReporting,
  probeSteering,
  renderCapabilities,
  renderCredentials,
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
