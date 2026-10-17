import type { ApprovalPreview, HoldRefusal, HoldResult } from "@slip/app";
import { type ReceiptView, storeName } from "@slip/receipt";

/**
 * What a hold decision looks like by the time it reaches the browser. Three shapes only, and no
 * domain record among them: the client gets receipt views, never a `Receipt` with its PayPal
 * request ids and operations.
 *
 * `unknown` is the one that matters. A decision whose answer never arrived has not failed — the
 * money may well have moved — so the only honest thing to say is that Slip is checking, and the
 * one safe thing to do is read the receipt again rather than send a second decision.
 */

export interface Refused {
  status: "refused";
  reason: string;
  message: string;
  /** PRICE_CHANGED: what approving would charge now. */
  amountCents?: number;
  /** RECHECK_REJECTED: the rule that would now reject the purchase. */
  ruleCode?: string;
}

export type PreviewResult =
  | { status: "preview"; kind: "capture" | "pay"; amountCents: number; store: string }
  | Refused
  | { status: "unknown" };

export type DecisionResult =
  | { status: "done"; view: ReceiptView; followUp: ReceiptView | null }
  | Refused
  | { status: "unknown" };

export function refusedFrom(refusal: HoldRefusal): Refused {
  return {
    status: "refused",
    reason: refusal.reason,
    message: refusal.message,
    ...(refusal.amountCents === undefined ? {} : { amountCents: refusal.amountCents }),
    ...(refusal.ruleCode === undefined ? {} : { ruleCode: refusal.ruleCode }),
  };
}

export function previewResult(preview: ApprovalPreview | HoldRefusal): PreviewResult {
  return preview.status === "refused"
    ? refusedFrom(preview)
    : {
        status: "preview",
        kind: preview.kind,
        amountCents: preview.amountCents,
        // Named the way every receipt names it: "Store K", or the domain without `www.`.
        store: storeName(preview.merchant),
      };
}

export function decisionResult(result: HoldResult): DecisionResult {
  return result.status === "refused"
    ? refusedFrom(result)
    : { status: "done", view: result.view, followUp: result.followUp?.view ?? null };
}
