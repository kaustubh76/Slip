import { describe, expect, it } from "vitest";
import { type ApprovalPath, approvalPath } from "./hold.js";
import { PAYMENT_STATUSES, type Payment, type PaymentStatus } from "./payment.js";

function payment(status: PaymentStatus, captureTried: boolean): Payment {
  return {
    status,
    operations: [
      { kind: "ORDER", requestId: "r1", createdAt: new Date(0) },
      ...(captureTried ? [{ kind: "CAPTURE", requestId: "r2", createdAt: new Date(0) }] : []),
    ],
  } as Payment;
}

describe("approvalPath", () => {
  it("nothing placed → pay with a follow-up", () => {
    expect(approvalPath(null)).toBe("pay");
  });

  const expected: Record<Exclude<PaymentStatus, "NONE">, [ApprovalPath, ApprovalPath]> = {
    // [no capture tried, capture tried]
    INITIATED: ["not-ready", "not-ready"],
    UNKNOWN: ["not-ready", "not-ready"],
    PENDING: ["not-ready", "not-ready"],
    AUTHORIZED: ["capture", "capture"],
    CAPTURING: ["spent", "spent"],
    CAPTURED: ["spent", "spent"],
    VOIDING: ["spent", "spent"],
    VOIDED: ["pay", "spent"],
    FAILED: ["pay", "spent"],
  };

  it.each(PAYMENT_STATUSES.filter((s): s is Exclude<PaymentStatus, "NONE"> => s !== "NONE"))(
    "%s",
    (status) => {
      const [before, after] = expected[status];
      expect(approvalPath(payment(status, false))).toBe(before);
      expect(approvalPath(payment(status, true))).toBe(after);
    },
  );

  it("a capture PayPal declined is never followed up: that would charge again without asking", () => {
    expect(approvalPath(payment("FAILED", true))).toBe("spent");
    expect(approvalPath(payment("VOIDED", true))).toBe("spent");
  });
});
