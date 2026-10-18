import { describe, expect, it } from "vitest";
import { resolveServices } from "./services";

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
