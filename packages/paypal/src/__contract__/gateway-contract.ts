import { randomUUID } from "node:crypto";
import {
  type AttemptId,
  attemptId,
  type Cents,
  type PaymentGateway,
  type RequestId,
  requestId,
} from "@slip/domain";
import { describe, expect, it } from "vitest";

export interface GatewayHarness {
  gateway: PaymentGateway;
  /** A vaulted payment method this gateway can charge (a sandbox buyer for the real adapter). */
  vaultId: string;
}

const live = () => new AbortController().signal;
const newRequest = (): RequestId => requestId(randomUUID());
const newInvoice = (): AttemptId => attemptId(randomUUID());
const AMOUNT = 1299 as Cents;

/**
 * What every PaymentGateway must do, as Slip relies on it. Runs on the fake now and on the
 * PayPal sandbox adapter once it exists, so the fake cannot drift from PayPal's behaviour.
 */
/**
 * Each case makes several calls in a row, which the sandbox answers in seconds rather than the
 * fake's microseconds: the suite carries its own allowance, so no caller has to remember a flag.
 */
const CONTRACT_TIMEOUT_MS = 90_000;

export function describeGatewayContract(label: string, make: () => Promise<GatewayHarness>): void {
  describe(`PaymentGateway contract · ${label}`, { timeout: CONTRACT_TIMEOUT_MS }, () => {
    it("a one-step order pays, and replaying its request id returns the same order", async () => {
      const { gateway, vaultId } = await make();
      const input = {
        intent: "CAPTURE" as const,
        vaultId,
        amountCents: AMOUNT,
        requestId: newRequest(),
        invoiceId: newInvoice(),
        description: "Slip contract test",
      };
      const first = await gateway.createOrder(input, live());
      expect(first.kind).toBe("captured");
      const replay = await gateway.createOrder(input, live());
      expect(replay).toEqual(first);
      if (first.kind === "captured") {
        expect(await gateway.getOrder(first.orderId, live())).toEqual(first);
      }
    });

    it("lists a window of its own records, and says so rather than answering an empty one", async () => {
      const { gateway } = await make();
      const now = new Date();
      // A window that ends before it starts is a question Slip got wrong, not an empty answer:
      // "listed, nothing in it" would read as "PayPal has no record of any of your payments".
      const backwards = await gateway.listSettlements(
        { from: now, to: new Date(now.getTime() - 60_000) },
        live(),
      );
      expect(backwards.kind).toBe("unknown");

      // A real window answers with a list. What is in it depends on the account's own history and
      // on reporting's lag, so the contract is the shape of each record, not which ones appear.
      const listed = await gateway.listSettlements(
        { from: new Date(now.getTime() - 7 * 24 * 3_600_000), to: now },
        live(),
      );
      expect(["listed", "unknown"]).toContain(listed.kind);
      if (listed.kind === "listed") {
        for (const record of listed.records) {
          expect(typeof record.invoiceId).toBe("string");
          expect(Number.isInteger(record.amountCents)).toBe(true);
          expect(["settled", "pending", "reversed", "voided", "denied", "other"]).toContain(
            record.kind,
          );
        }
      }
    });

    it("an authorization is captured once; replaying the capture returns the same capture", async () => {
      const { gateway, vaultId } = await make();
      const order = await gateway.createOrder(
        {
          intent: "AUTHORIZE",
          vaultId,
          amountCents: AMOUNT,
          requestId: newRequest(),
          invoiceId: newInvoice(),
          description: "Slip contract test",
        },
        live(),
      );
      expect(order.kind).toBe("authorized");
      if (order.kind !== "authorized") {
        return;
      }
      const capture = {
        authorizationId: order.authorizationId,
        amountCents: AMOUNT,
        requestId: newRequest(),
        invoiceId: newInvoice(),
        finalCapture: true as const,
      };
      const captured = await gateway.captureAuthorization(capture, live());
      expect(captured.kind).toBe("captured");
      expect(await gateway.captureAuthorization(capture, live())).toEqual(captured);
      const authorization = await gateway.getAuthorization(order.authorizationId, live());
      expect(authorization).toMatchObject({ kind: "found", status: "CAPTURED" });
      const lateVoid = await gateway.voidAuthorization(
        { authorizationId: order.authorizationId, requestId: newRequest() },
        live(),
      );
      expect(lateVoid).toMatchObject({ kind: "not-voidable", status: "CAPTURED" });
    });

    it("a voided authorization releases the funds and can no longer be captured", async () => {
      const { gateway, vaultId } = await make();
      const order = await gateway.createOrder(
        {
          intent: "AUTHORIZE",
          vaultId,
          amountCents: AMOUNT,
          requestId: newRequest(),
          invoiceId: newInvoice(),
          description: "Slip contract test",
        },
        live(),
      );
      if (order.kind !== "authorized") {
        throw new Error(`expected an authorization, got ${order.kind}`);
      }
      const voidRequest = { authorizationId: order.authorizationId, requestId: newRequest() };
      expect(await gateway.voidAuthorization(voidRequest, live())).toEqual({ kind: "voided" });
      expect(await gateway.voidAuthorization(voidRequest, live())).toEqual({ kind: "voided" });
      expect(await gateway.getAuthorization(order.authorizationId, live())).toMatchObject({
        kind: "found",
        status: "VOIDED",
      });
      const capture = await gateway.captureAuthorization(
        {
          authorizationId: order.authorizationId,
          amountCents: AMOUNT,
          requestId: newRequest(),
          invoiceId: newInvoice(),
          finalCapture: true,
        },
        live(),
      );
      expect(capture.kind).toBe("declined");
    });
  });
}
