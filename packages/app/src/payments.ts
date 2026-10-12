import {
  IllegalTransitionError,
  type Payment,
  type PaymentOperationKind,
  requestId,
} from "@slip/domain";
import { withDeadline } from "./deadline.js";
import type { AppDeps } from "./deps.js";
import {
  afterAuthorizationCheck,
  afterCapture,
  afterOrder,
  afterVoid,
  type Step,
} from "./outcomes.js";

/**
 * Talking to PayPal about one payment, shared by checkout, holds, the resolver and webhooks. Every
 * call runs within the PayPal deadline; a timeout or an adapter error is "unknown", never a
 * failure, and the write-ahead status stays for the resolver to finish with the same request id.
 */

export function operation(payment: Payment, kind: PaymentOperationKind) {
  const op = payment.operations.find((o) => o.kind === kind);
  if (op === undefined) {
    throw new Error(`payment ${payment.attemptId} has no ${kind} operation`);
  }
  return op;
}

async function paypal<T>(
  deps: AppDeps,
  what: string,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T | { kind: "unknown"; reason: string }> {
  try {
    const result = await withDeadline(deps.clock, deps.config.paypalTimeoutMs, call);
    return result.timedOut ? { kind: "unknown", reason: `${what} timed out` } : result.value;
  } catch (error) {
    deps.log.error("paypal.threw", { what, error: String(error) });
    return { kind: "unknown", reason: `${what} failed: ${String(error)}` };
  }
}

/** Creates (or re-sends, with the same request id) the order of an INITIATED/UNKNOWN payment. */
export async function sendOrder(
  deps: AppDeps,
  payment: Payment,
  input: { vaultId: string; description: string },
): Promise<Payment> {
  const op = operation(payment, "ORDER");
  const result = await paypal(deps, "order", (signal) =>
    deps.gateway.createOrder(
      {
        intent: payment.intent,
        vaultId: input.vaultId,
        amountCents: payment.amountCents,
        requestId: op.requestId,
        invoiceId: payment.attemptId,
        description: input.description,
      },
      signal,
    ),
  );
  return applyStep(deps, payment, afterOrder(payment.intent, result), "order");
}

/** Records what a step says. Contradictions are logged for a human, never forced into the store. */
export async function applyStep(
  deps: AppDeps,
  payment: Payment,
  step: Step,
  context: string,
): Promise<Payment> {
  switch (step.kind) {
    case "move":
      try {
        const moved = await deps.store.payments.transition(payment.attemptId, step.to, {
          patch: step.patch,
          detail: { ...step.detail, context },
          now: deps.clock.now(),
        });
        if (moved.result === "stale") {
          deps.log.info("payment.stale_report", {
            attemptId: payment.attemptId,
            reported: step.to,
            current: moved.value.status,
          });
        }
        return moved.value;
      } catch (error) {
        if (error instanceof IllegalTransitionError) {
          deps.log.error("payment.contradiction", {
            attemptId: payment.attemptId,
            from: error.from,
            to: error.to,
            context,
          });
          return (await deps.store.payments.get(payment.attemptId)) ?? payment;
        }
        throw error;
      }
    case "stay":
      deps.log.info("payment.unsettled", { attemptId: payment.attemptId, why: step.why, context });
      return payment;
    case "contradiction":
      deps.log.error("payment.contradiction", {
        attemptId: payment.attemptId,
        why: step.why,
        context,
      });
      return payment;
    case "check-authorization": {
      if (
        payment.authorizationId === null ||
        (payment.status !== "CAPTURING" && payment.status !== "VOIDING")
      ) {
        deps.log.error("payment.contradiction", {
          attemptId: payment.attemptId,
          why: `cannot check an authorization from ${payment.status}`,
          context,
        });
        return payment;
      }
      const authorizationId = payment.authorizationId;
      const result = await paypal(deps, "authorization lookup", (signal) =>
        deps.gateway.getAuthorization(authorizationId, signal),
      );
      return applyStep(deps, payment, afterAuthorizationCheck(payment.status, result), context);
    }
    case "void":
      return releaseAuthorization(deps, payment, context);
  }
}

/**
 * Captures, in full and once, the authorization of a CAPTURING payment with its CAPTURE request id
 * (also a re-send). A declined capture leads to asking whether the authorization is still alive.
 */
export async function sendCapture(deps: AppDeps, payment: Payment): Promise<Payment> {
  if (payment.authorizationId === null) {
    throw new Error(`payment ${payment.attemptId} has no authorization to capture`);
  }
  const authorizationId = payment.authorizationId;
  const op = operation(payment, "CAPTURE");
  const result = await paypal(deps, "capture", (signal) =>
    deps.gateway.captureAuthorization(
      {
        authorizationId,
        amountCents: payment.amountCents,
        requestId: op.requestId,
        invoiceId: payment.attemptId,
        finalCapture: true,
      },
      signal,
    ),
  );
  return applyStep(deps, payment, afterCapture(result), "capture");
}

/** Moves a payment holding a live authorization to VOIDING (new request id) and voids it. */
export async function releaseAuthorization(
  deps: AppDeps,
  payment: Payment,
  context: string,
): Promise<Payment> {
  const voiding = await deps.store.payments.transition(payment.attemptId, "VOIDING", {
    operationRequestId: requestId(deps.ids.uuid()),
    detail: { context },
    now: deps.clock.now(),
  });
  return sendVoid(deps, voiding.value);
}

/** Voids the authorization of a VOIDING payment with its VOID request id (also a re-send). */
export async function sendVoid(deps: AppDeps, payment: Payment): Promise<Payment> {
  if (payment.authorizationId === null) {
    throw new Error(`payment ${payment.attemptId} has no authorization to void`);
  }
  const authorizationId = payment.authorizationId;
  const op = operation(payment, "VOID");
  const result = await paypal(deps, "void", (signal) =>
    deps.gateway.voidAuthorization({ authorizationId, requestId: op.requestId }, signal),
  );
  return applyStep(deps, payment, afterVoid(result), "void");
}
