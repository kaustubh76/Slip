import { describe, expect, it } from "vitest";
import { resolveServices, type Services, unsafeCombination } from "./services";

/** Keys decide, one service at a time — except in the shared demo, which is always stand-ins. */

const env = (over: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ ...over }) as NodeJS.ProcessEnv;

describe("which services are real", () => {
  it("with no keys at all, everything is a stand-in", () => {
    expect(resolveServices(env())).toEqual({
      prices: "simulated",
      payment: "simulated",
      steering: "simulated",
    });
  });

  it("a Channel3 key makes the prices real, and nothing else", () => {
    expect(resolveServices(env({ CHANNEL3_API_KEY: "ch3" }))).toMatchObject({
      prices: "channel3",
      payment: "simulated",
      steering: "simulated",
    });
  });

  it("an Anthropic key makes the steering check real, and nothing else", () => {
    expect(resolveServices(env({ ANTHROPIC_API_KEY: "sk" }))).toMatchObject({
      steering: "claude",
      prices: "simulated",
    });
  });

  it("PayPal needs all three values: the webhook id as much as the credentials", () => {
    // Without the id every delivery fails verification: payments would be taken and never heard
    // about again, which is worse than not taking them.
    const partial = resolveServices(env({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" }));
    expect(partial.payment).toBe("simulated");
    const whole = resolveServices(
      env({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s", PAYPAL_WEBHOOK_ID: "WH" }),
    );
    expect(whole.payment).toBe("sandbox");
  });

  it("only PAYPAL_ENV=live is live", () => {
    const keys = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s", PAYPAL_WEBHOOK_ID: "WH" };
    expect(resolveServices(env({ ...keys, PAYPAL_ENV: "live" })).payment).toBe("live");
    expect(resolveServices(env({ ...keys, PAYPAL_ENV: "LIVE " })).payment).toBe("live");
    expect(resolveServices(env({ ...keys, PAYPAL_ENV: "sandbox" })).payment).toBe("sandbox");
    expect(resolveServices(env({ ...keys, PAYPAL_ENV: "" })).payment).toBe("sandbox");
  });

  it("a blank key is no key", () => {
    expect(resolveServices(env({ CHANNEL3_API_KEY: "   " })).prices).toBe("simulated");
  });

  it("the shared demo is always the stand-ins, whatever keys are set", () => {
    // Its catalogue is per visitor, its approval page stands in for PayPal's, and one account's
    // credits would be spent on every passer-by.
    const demo = resolveServices(
      env({
        SLIP_DEMO: "1",
        CHANNEL3_API_KEY: "ch3",
        ANTHROPIC_API_KEY: "sk",
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "s",
        PAYPAL_WEBHOOK_ID: "WH",
      }),
    );
    expect(demo).toEqual({ prices: "simulated", payment: "simulated", steering: "simulated" });
  });
});

describe("combinations a deployment must not run", () => {
  const live = (over: Partial<Services> = {}): Services => ({
    prices: "channel3",
    payment: "live",
    steering: "claude",
    ...over,
  });

  /** A deployment with nothing wrong with it, passed explicitly so no test reads the real env. */
  const sound = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
    ({
      DATABASE_URL: "postgres://slip@db/slip",
      SLIP_BASE_URL: "https://slip.example",
      SLIP_CRON_SECRET: "s3cret",
      ...over,
    }) as unknown as NodeJS.ProcessEnv;

  const refusal = (over: Record<string, string | undefined> = {}) =>
    unsafeCombination(live(), sound(over)) ?? "";

  it("allows live money only when nothing else is invented", () => {
    expect(unsafeCombination(live(), sound())).toBeNull();
  });

  it("refuses live money on a single-process file store", () => {
    // PGlite takes no lock on its own directory, so two processes corrupt it — which is why the
    // vault-id script refuses to run beside the server. Not somewhere real money belongs.
    const said = refusal({ DATABASE_URL: "pglite://.data/slip" });
    expect(said).toContain("single-process file store");
    expect(said).toContain("Postgres server");
  });

  it("refuses live money when Slip does not know its own address at all", () => {
    // The dangerous case is the unset one, not the http one: with no address the config falls
    // back to localhost, PayPal is handed "localhost" as the brand name on a real checkout, and
    // the approval's return URL points at a machine that is not there (D76).
    const said = unsafeCombination(live(), sound({ SLIP_BASE_URL: undefined })) ?? "";
    expect(said).toContain("does not know its own address");
    expect(said).toContain("SLIP_BASE_URL");
    // The host naming it is enough, which is how the hosted demo gets this right for free.
    expect(
      unsafeCombination(
        live(),
        sound({ SLIP_BASE_URL: undefined, RENDER_EXTERNAL_URL: "https://slip.onrender.com" }),
      ),
    ).toBeNull();
  });

  it("refuses live money where Slip is not served over https", () => {
    // The base URL is the only place Slip knows its own scheme: the session cookie carrying the
    // kill switch would go out without Secure, and PayPal would brand the checkout "localhost".
    const said = refusal({ SLIP_BASE_URL: "http://localhost:3000" });
    expect(said).toContain("not https");
    expect(said).toContain("Secure");
  });

  it("refuses live money where nothing would ever expire a hold", () => {
    // Serverless: no instance outlives its request, so the resolver's timer never starts. Without
    // a cron secret the endpoint stays shut too, and real authorizations sit on real cards.
    const said = refusal({ SLIP_SERVERLESS: "1", SLIP_CRON_SECRET: undefined });
    expect(said).toContain("expire a hold");
    expect(said).toContain("/api/cron/resolve");
    // Off a serverless host, either name is a configured secret.
    expect(
      unsafeCombination(
        live(),
        sound({ SLIP_SERVERLESS: "1", SLIP_CRON_SECRET: undefined, CRON_SECRET: "x" }),
      ),
    ).toBeNull();
  });

  it("refuses live money on Vercel under a secret Vercel will never send", () => {
    // Vercel injects a bearer token only for a variable named exactly CRON_SECRET. Slip's own
    // name is accepted by the endpoint, but Vercel's scheduler cannot present it — so a
    // deployment that set only SLIP_CRON_SECRET 401s its own cron for ever and nothing says so.
    const said = refusal({ VERCEL: "1" });
    expect(said).toContain("CRON_SECRET");
    expect(said).toContain("not SLIP_CRON_SECRET");
    expect(unsafeCombination(live(), sound({ VERCEL: "1", CRON_SECRET: "x" }))).toBeNull();
  });

  it("says every fault at once, and each fix only once", () => {
    const said =
      unsafeCombination(
        live({ prices: "simulated" }),
        sound({ DATABASE_URL: "pglite://.data/slip", SLIP_BASE_URL: "http://x" }),
      ) ?? "";
    expect(said).toContain("stand-in catalogue");
    expect(said).toContain("file store");
    expect(said).toContain("not https");
    expect(said.match(/Set CHANNEL3_API_KEY/g)).toHaveLength(1);
  });

  it("refuses live money against the stand-in catalogue", () => {
    // The sign-up page refuses to start a new owner under live PayPal, but a key issued before the
    // keys changed would keep working — so the refusal has to be at the deployment.
    const refusal = unsafeCombination(live({ prices: "simulated" }), sound());
    expect(refusal).toContain("real money");
    expect(refusal).toContain("stand-in catalogue");
    expect(refusal).toContain("CHANNEL3_API_KEY");
  });

  it("refuses live money with a scripted steering check", () => {
    // A receipt would say the listing was checked when one hard-coded phrase was matched.
    expect(unsafeCombination(live({ steering: "simulated" }), sound())).toContain(
      "scripted stand-in",
    );
  });

  it("names both when both are invented", () => {
    const refusal =
      unsafeCombination(live({ prices: "simulated", steering: "simulated" }), sound()) ?? "";
    expect(refusal).toContain("stand-in catalogue");
    expect(refusal).toContain("scripted stand-in");
  });

  it.each(["simulated", "sandbox"] as const)(
    "refuses nothing when the payment is %s: no real money is at stake",
    (payment) => {
      expect(
        unsafeCombination(live({ payment, prices: "simulated", steering: "simulated" }), sound()),
      ).toBeNull();
    },
  );
});
