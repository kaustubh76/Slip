import {
  type Attempt,
  type AttemptOrigin,
  type Hold,
  type Payment,
  type PaymentStatus,
  policyVersion,
  type Receipt,
  type RuleCode,
  requestId,
} from "@slip/domain";
import {
  minutesFromNow,
  NOW,
  offer,
  request,
  TEST_AGENT_ID,
  testAttempt,
  testDecision,
  testUuid,
} from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { harness, seedAgent } from "../__fixtures__/harness.js";
import { appConfig } from "../config.js";
import { generateApiKey, hashApiKey } from "../keys.js";
import { authenticate, dedupe, parseCheckoutRequest } from "./gate.js";

describe("authenticate", () => {
  it("accepts an active agent's key and returns its mandate and policy", async () => {
    const h = harness();
    const seeded = await seedAgent(h);
    const auth = await authenticate(h.deps, seeded.apiKey);
    expect("status" in auth).toBe(false);
    if (!("status" in auth)) {
      expect(auth.agent.id).toBe(seeded.agentId);
      expect(auth.policy.version).toBe(1);
    }
  });

  it("refuses an unknown or revoked key", async () => {
    const h = harness();
    const seeded = await seedAgent(h);
    expect(await authenticate(h.deps, generateApiKey().key)).toMatchObject({
      reason: "UNAUTHENTICATED",
    });
    await h.store.agents.revoke(seeded.agentId, h.clock.now());
    expect(await authenticate(h.deps, seeded.apiKey)).toMatchObject({ reason: "UNAUTHENTICATED" });
  });

  it("refuses an agent whose mandate is not active, saying why", async () => {
    const h = harness();
    const pending = await seedAgent(h, { activate: false });
    expect(await authenticate(h.deps, pending.apiKey)).toMatchObject({
      reason: "MANDATE_NOT_ACTIVE",
      message: expect.stringContaining("not finished setting up"),
    });
    const revoked = await seedAgent(h);
    await h.store.mandates.revoke(revoked.mandateId, h.clock.now());
    expect(await authenticate(h.deps, revoked.apiKey)).toMatchObject({
      reason: "MANDATE_NOT_ACTIVE",
      message: expect.stringContaining("revoked"),
    });
  });
});

describe("API keys", () => {
  it("look like slip_live_…, hash stably and are never repeated", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^slip_live_[A-Za-z0-9_-]{43}$/);
    expect(a.prefix).toBe(a.key.slice(0, 14));
    expect(hashApiKey(a.key)).toBe(a.hash);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("parseCheckoutRequest", () => {
  it("drops any price the agent sends and identifies the agent by its key", async () => {
    const h = harness();
    const seeded = await seedAgent(h);
    const auth = await authenticate(h.deps, seeded.apiKey);
    if ("status" in auth) {
      throw new Error("expected auth");
    }
    const parsed = parseCheckoutRequest(auth, {
      productId: "p1",
      chosenOfferUrl: "https://store.example/p/1",
      reason: "cheapest",
      price: 1,
      agentId: testUuid(9),
    });
    expect(parsed).toEqual({
      agentId: seeded.agentId,
      productId: "p1",
      chosenOfferUrl: "https://store.example/p/1",
      reason: "cheapest",
    });
  });

  it("refuses a malformed request with the field that is wrong", async () => {
    const h = harness();
    const seeded = await seedAgent(h);
    const auth = await authenticate(h.deps, seeded.apiKey);
    if ("status" in auth) {
      throw new Error("expected auth");
    }
    expect(
      parseCheckoutRequest(auth, { productId: "p1", chosenOfferUrl: "nope", reason: "" }),
    ).toMatchObject({
      reason: "INVALID_REQUEST",
      message: expect.stringContaining("chosenOfferUrl"),
    });
  });
});

describe("dedupe", () => {
  const config = appConfig();
  const v1 = policyVersion(1);
  const req = request({ url: "https://store-a.example/p/1", productId: "prod-1" });

  function receipt(spec: {
    minutesAgo: number;
    ruleCode: RuleCode;
    payment?: PaymentStatus;
    hold?: Hold["status"];
    origin?: AttemptOrigin;
    url?: string;
    version?: number;
  }): Receipt {
    const chosen = offer({ price: 50, url: spec.url ?? "https://store-a.example/p/1" });
    const attempt: Attempt = testAttempt({
      decision: testDecision({ ruleCode: spec.ruleCode, chosen, policyVersion: spec.version ?? 1 }),
      createdAt: minutesFromNow(-spec.minutesAgo),
      origin: spec.origin ?? "AGENT",
      ...(spec.origin === "OWNER_APPROVAL" ? { parentAttemptId: testUuid() as never } : {}),
      agentId: TEST_AGENT_ID,
    });
    const payment: Payment | null =
      spec.payment === undefined
        ? null
        : {
            attemptId: attempt.id,
            agentId: attempt.agentId,
            productId: attempt.productId,
            intent: "CAPTURE",
            status: spec.payment,
            amountCents: 5000 as never,
            currency: "USD",
            paypalOrderId: null,
            authorizationId: null,
            captureId: null,
            failureReason: null,
            operations: [{ kind: "ORDER", requestId: requestId(testUuid()), createdAt: NOW }],
            createdAt: NOW,
            updatedAt: NOW,
          };
    const hold: Hold | null =
      spec.hold === undefined
        ? null
        : {
            attemptId: attempt.id,
            status: spec.hold,
            createdAt: attempt.createdAt,
            expiresAt: minutesFromNow(60),
            decidedAt: null,
            decidedBy: null,
          };
    return { attempt, payment, hold };
  }

  const run = (recent: Receipt[], openHolds: Receipt[] = [], version = v1) =>
    dedupe({ request: req, policyVersion: version, now: NOW, config, recent, openHolds });

  it("a paid purchase, or one still in flight, is replayed within 10 minutes", () => {
    for (const status of ["CAPTURED", "INITIATED", "UNKNOWN", "PENDING"] as const) {
      const paid = receipt({ minutesAgo: 5, ruleCode: "R7_WITHIN_LIMITS", payment: status });
      expect(run([paid])).toEqual({ kind: "replay", reason: "ALREADY_PAID", receipt: paid });
    }
    expect(
      run([receipt({ minutesAgo: 11, ruleCode: "R7_WITHIN_LIMITS", payment: "CAPTURED" })]).kind,
    ).toBe("proceed");
  });

  it("a paid attempt whose payment FAILED does not block a retry", () => {
    expect(
      run([receipt({ minutesAgo: 1, ruleCode: "R7_WITHIN_LIMITS", payment: "FAILED" })]).kind,
    ).toBe("proceed");
  });

  it("an open hold at any age is replayed", () => {
    const old = receipt({
      minutesAgo: 2 * 24 * 60 - 5,
      ruleCode: "R6_ABOVE_ORDER_CAP",
      hold: "PENDING",
    });
    expect(run([], [old])).toEqual({ kind: "replay", reason: "HOLD_OPEN", receipt: old });
  });

  it("the same offer rejected under the same policy within 10 minutes is replayed", () => {
    const rejected = receipt({
      minutesAgo: 3,
      ruleCode: "R4_OVERPAID",
      url: "https://www.store-a.example/p/1/?utm_source=x",
    });
    expect(run([rejected])).toEqual({
      kind: "replay",
      reason: "RECENTLY_REJECTED",
      receipt: rejected,
    });
    expect(run([rejected], [], policyVersion(2)).kind).toBe("proceed");
    expect(
      run([receipt({ minutesAgo: 3, ruleCode: "R4_OVERPAID", url: "https://store-b.example/p/9" })])
        .kind,
    ).toBe("proceed");
    expect(run([receipt({ minutesAgo: 12, ruleCode: "R4_OVERPAID" })]).kind).toBe("proceed");
  });

  it("four agent attempts within an hour refuse a fifth; owner follow-ups do not count", () => {
    const four = [5, 15, 25, 35].map((m) =>
      receipt({
        minutesAgo: m + 10,
        ruleCode: "R4_OVERPAID",
        url: `https://store-z.example/p/${m}`,
      }),
    );
    expect(run(four)).toMatchObject({ kind: "retry-limit", latest: four[0] });
    const three = [
      ...four.slice(0, 3),
      receipt({
        minutesAgo: 20,
        ruleCode: "OWNER_APPROVED",
        origin: "OWNER_APPROVAL",
        payment: "FAILED",
      }),
    ];
    expect(run(three).kind).toBe("proceed");
    const stale = [...four.slice(0, 3), receipt({ minutesAgo: 61, ruleCode: "R4_OVERPAID" })];
    expect(run(stale).kind).toBe("proceed");
  });
});
