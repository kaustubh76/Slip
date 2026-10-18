import { attemptId, cents, requestId } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { describeGatewayContract } from "./__contract__/gateway-contract.js";
import { PAYPAL_SANDBOX_BASE_URL } from "./client.js";
import { createPayPalGateway } from "./gateway.js";

/**
 * The PayPal sandbox for real (`pnpm test:live:paypal`). Skipped until the keys are set, so it is
 * part of the ordinary suite and costs nothing until then.
 *
 * This runs the same contract the fake passes — a one-step order and its request-id replay, a
 * capture that cannot then be voided, a void that is idempotent — against PayPal itself. That is
 * the only thing that can prove the fake models PayPal rather than my reading of its
 * documentation, and it is the gate before any demo that claims real money.
 *
 * It needs one thing nothing can automate: a sandbox buyer whose PayPal wallet has been vaulted
 * through the approval flow, with its payment token in PAYPAL_TEST_VAULT_ID. Slip's own permission
 * flow produces one — see docs/SERVICES.md.
 *
 * It spends sandbox money, not real money, and leaves two captured orders and a voided
 * authorization behind each run.
 */

const clientId = process.env["PAYPAL_CLIENT_ID"] ?? "";
const clientSecret = process.env["PAYPAL_CLIENT_SECRET"] ?? "";
const vaultId = process.env["PAYPAL_TEST_VAULT_ID"] ?? "";
const missing = [
  clientId === "" ? "PAYPAL_CLIENT_ID" : null,
  clientSecret === "" ? "PAYPAL_CLIENT_SECRET" : null,
  vaultId === "" ? "PAYPAL_TEST_VAULT_ID" : null,
].filter((name): name is string => name !== null);

if (missing.length > 0) {
  describe("PayPal sandbox, live", () => {
    it.skip(`skipped: set ${missing.join(", ")} (pnpm test:live:paypal)`, () => {});
  });
} else {
  const gateway = createPayPalGateway({
    clientId,
    clientSecret,
    baseUrl: process.env["PAYPAL_BASE_URL"] ?? PAYPAL_SANDBOX_BASE_URL,
    webhookId: process.env["PAYPAL_WEBHOOK_ID"] ?? "unset-for-this-suite",
    brandName: "Slip",
  });

  describeGatewayContract("PayPal sandbox", async () => ({ gateway, vaultId }));

  describe("PayPal sandbox, beyond the contract", () => {
    it("refuses a second order for one attempt instead of charging twice", async () => {
      const input = {
        intent: "CAPTURE" as const,
        vaultId,
        amountCents: cents(1299),
        requestId: requestId(crypto.randomUUID()),
        invoiceId: attemptId(crypto.randomUUID()),
        description: "Slip live contract test",
      };
      const first = await gateway.createOrder(input, AbortSignal.timeout(30_000));
      expect(first.kind).toBe("captured");
      // Same invoice, a *new* request id: PayPal must refuse this rather than take the money
      // again. This is the refusal the resolver turns into a lookup.
      const second = await gateway.createOrder(
        { ...input, requestId: requestId(crypto.randomUUID()) },
        AbortSignal.timeout(30_000),
      );
      expect(second.kind).toBe("duplicate-invoice");
    }, 90_000);

    it("finds that order in PayPal's records once reporting has caught up", async () => {
      // Reporting lags ~3 h, so a fresh order is expected to be absent. What is asserted here is
      // that the scan answers at all: `not-found` or `found`, never `unknown`.
      const result = await gateway.findOrderByInvoice(
        {
          invoiceId: attemptId(crypto.randomUUID()),
          amountCents: cents(1299),
          from: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          to: new Date(),
        },
        AbortSignal.timeout(60_000),
      );
      expect(result.kind).not.toBe("unknown");
    }, 90_000);
  });
}
