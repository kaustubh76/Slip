import { ConflictError, IllegalTransitionError } from "./errors.js";
import type { AgentId, AttemptId, RequestId } from "./ids.js";
import type { Cents } from "./money.js";
import {
  classifyMove,
  isReachable,
  type TransitionResult,
  type Transitions,
} from "./state-machine.js";

/** CAPTURE pays in one step (PAID); AUTHORIZE places a hold a human approves or declines (HELD). */
export const PAYMENT_INTENTS = ["CAPTURE", "AUTHORIZE"] as const;
export type PaymentIntent = (typeof PAYMENT_INTENTS)[number];

/**
 * The PayPal side of one attempt. `NONE` means no payment row exists. Every status that is about
 * to call PayPal is entered *before* the call (write-ahead): `INITIATED` before the order,
 * `CAPTURING` before capturing a hold, `VOIDING` before releasing one. A crash or timeout after
 * that point leaves a row the resolver can finish with the same PayPal-Request-Id — never a new
 * order.
 */
export const PAYMENT_STATUSES = [
  "NONE",
  "INITIATED",
  "UNKNOWN",
  "PENDING",
  "AUTHORIZED",
  "CAPTURING",
  "VOIDING",
  "CAPTURED",
  "VOIDED",
  "FAILED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** One-step purchase with the vaulted method. */
const CAPTURE_TRANSITIONS: Transitions<PaymentStatus> = {
  NONE: ["INITIATED"],
  INITIATED: ["UNKNOWN", "PENDING", "CAPTURED", "FAILED"],
  UNKNOWN: ["PENDING", "CAPTURED", "FAILED"],
  PENDING: ["CAPTURED", "FAILED"],
  AUTHORIZED: [],
  CAPTURING: [],
  VOIDING: [],
  CAPTURED: [],
  VOIDED: [],
  FAILED: [],
};

/**
 * Hold for a human. A pending capture stays in CAPTURING until PayPal settles it, which keeps the
 * graph acyclic. CAPTURING → VOIDING releases the hold when a capture is declined but the
 * authorization is still alive; → VOIDED when PayPal reports it voided or expired on its own.
 */
const AUTHORIZE_TRANSITIONS: Transitions<PaymentStatus> = {
  NONE: ["INITIATED"],
  // VOIDED straight from INITIATED/UNKNOWN: the authorization was voided or expired at PayPal
  // before Slip heard it was created (e.g. the resolver's first lookup after an outage).
  INITIATED: ["UNKNOWN", "PENDING", "AUTHORIZED", "FAILED", "VOIDED"],
  UNKNOWN: ["PENDING", "AUTHORIZED", "FAILED", "VOIDED"],
  PENDING: ["AUTHORIZED", "FAILED", "VOIDED"],
  AUTHORIZED: ["CAPTURING", "VOIDING", "VOIDED"],
  CAPTURING: ["CAPTURED", "FAILED", "VOIDING", "VOIDED"],
  VOIDING: ["VOIDED"],
  CAPTURED: [],
  VOIDED: [],
  FAILED: [],
};

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentIntent, Transitions<PaymentStatus>>> = {
  CAPTURE: CAPTURE_TRANSITIONS,
  AUTHORIZE: AUTHORIZE_TRANSITIONS,
};

/** No move leaves these, under either intent. */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = ["CAPTURED", "VOIDED", "FAILED"];

/**
 * Money may be moving or about to: at most one such payment per (agent, product). The database
 * enforces this with a partial unique index as a backstop to the checkout lease.
 */
export const IN_FLIGHT_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "INITIATED",
  "UNKNOWN",
  "PENDING",
  "CAPTURING",
];

/** Every PayPal call Slip makes for an attempt; each has its own PayPal-Request-Id. */
export const PAYMENT_OPERATION_KINDS = ["ORDER", "CAPTURE", "VOID"] as const;
export type PaymentOperationKind = (typeof PAYMENT_OPERATION_KINDS)[number];

/** Entering these statuses means a PayPal call is about to be made; its request id is written first. */
export const ENTRY_OPERATION: Readonly<Partial<Record<PaymentStatus, PaymentOperationKind>>> = {
  INITIATED: "ORDER",
  CAPTURING: "CAPTURE",
  VOIDING: "VOID",
};

export interface PaymentOperation {
  kind: PaymentOperationKind;
  /** Sent as PayPal-Request-Id on the first call and on every retry of it. */
  requestId: RequestId;
  /** When the request id was written, before the first send. PayPal keeps order ids 6 h. */
  createdAt: Date;
}

export interface Payment {
  /** Also the PayPal `custom_id` and `invoice_id`. */
  attemptId: AttemptId;
  agentId: AgentId;
  productId: string;
  intent: PaymentIntent;
  status: PaymentStatus;
  amountCents: Cents;
  currency: "USD";
  paypalOrderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  failureReason: string | null;
  /** Ordered ORDER, CAPTURE, VOID. */
  operations: PaymentOperation[];
  createdAt: Date;
  updatedAt: Date;
}

/** PayPal ids and the failure reason are set once; a repeat of the same value is fine. */
export interface PaymentPatch {
  paypalOrderId?: string;
  authorizationId?: string;
  captureId?: string;
  failureReason?: string;
}

export interface PaymentEvent {
  attemptId: AttemptId;
  fromStatus: PaymentStatus;
  toStatus: PaymentStatus;
  detail: unknown;
  at: Date;
}

export function canTransition(
  intent: PaymentIntent,
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return PAYMENT_TRANSITIONS[intent][from].includes(to);
}

/** Returns `to` when the move is allowed; throws `IllegalTransitionError` otherwise. */
export function transition(
  intent: PaymentIntent,
  from: PaymentStatus,
  to: PaymentStatus,
): PaymentStatus {
  if (!canTransition(intent, from, to)) {
    throw new IllegalTransitionError("payment", from, to);
  }
  return to;
}

/** See `classifyMove`: applied, unchanged, stale, or illegal. */
export function classifyPaymentMove(
  intent: PaymentIntent,
  from: PaymentStatus,
  to: PaymentStatus,
): TransitionResult | "illegal" {
  return classifyMove(PAYMENT_TRANSITIONS[intent], from, to);
}

/** Every status this intent can ever be in, `NONE` included. */
export function statusesFor(intent: PaymentIntent): PaymentStatus[] {
  const table = PAYMENT_TRANSITIONS[intent];
  return PAYMENT_STATUSES.filter(
    (status) => status === "NONE" || isReachable(table, "NONE", status),
  );
}

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}

/**
 * Fields a payment must carry in each status. The database has matching CHECK constraints; the
 * stores call this before writing so both reject the same rows with the same error.
 */
export function missingPaymentFields(
  status: PaymentStatus,
  fields: Pick<Payment, "paypalOrderId" | "authorizationId" | "captureId" | "failureReason">,
): string[] {
  const missing: string[] = [];
  const need = (name: keyof typeof fields) => {
    if (fields[name] === null) {
      missing.push(name);
    }
  };
  switch (status) {
    case "PENDING":
      need("paypalOrderId");
      break;
    case "AUTHORIZED":
    case "CAPTURING":
    case "VOIDING":
    case "VOIDED":
      need("paypalOrderId");
      need("authorizationId");
      break;
    case "CAPTURED":
      need("paypalOrderId");
      need("captureId");
      break;
    case "FAILED":
      need("failureReason");
      break;
    default:
      break;
  }
  return missing;
}

type PatchableFields = Pick<
  Payment,
  "paypalOrderId" | "authorizationId" | "captureId" | "failureReason"
>;

/** Applies a patch with set-once semantics; a different value for a set field is a conflict. */
export function applyPaymentPatch(current: PatchableFields, patch: PaymentPatch): PatchableFields {
  const next: PatchableFields = { ...current };
  for (const key of ["paypalOrderId", "authorizationId", "captureId", "failureReason"] as const) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    const existing = current[key];
    if (existing !== null && existing !== value) {
      throw new ConflictError(
        "PAYMENT_FIELD_SET",
        `${key} is already ${existing}; refusing to change it to ${value}`,
      );
    }
    next[key] = value;
  }
  return next;
}
