import type { ReceiptView } from "@slip/receipt";

/**
 * The owner's commands, as the kit expects a host to provide them. In the Slip web app they are
 * Next.js server actions; a platform embedding the kit passes its own. Every answer is one of a few
 * shapes and never a thrown error, and `unknown` means "the answer was lost": the command may have
 * done its work (moved money, revoked a key), so it is never sent again on its own.
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

export interface Unknown {
  status: "unknown";
}

export type PreviewAnswer =
  | { status: "preview"; kind: "capture" | "pay"; amountCents: number; store: string }
  | Refused
  | Unknown;

export type DecisionAnswer =
  | { status: "done"; view: ReceiptView; followUp: ReceiptView | null }
  | Refused
  | Unknown;

/** The limits form, in the units people type: percent, dollars, minutes. */
export interface LimitsInput {
  maxOverpayPct: number;
  maxOverpayDollars: number;
  flagPct: number;
  orderCapDollars: number;
  snapshotMaxAgeMinutes: number;
}

export type LimitsAnswer = { status: "updated"; version: number } | Refused | Unknown;

export type RevokeMandateAnswer =
  | {
      status: "revoked";
      holdsDeclined: number;
      vault: "deleted" | "nothing-to-delete" | "failed";
    }
  | Refused
  | Unknown;

export type IssueKeyAnswer = { status: "issued"; name: string; apiKey: string } | Refused | Unknown;

export type RevokeKeyAnswer = { status: "revoked" } | Refused | Unknown;

export interface SlipCommands {
  /** What approving a hold would charge. It may ask Channel3 for today's prices: never prefetched. */
  previewApproval(id: string): Promise<PreviewAnswer>;
  /** Approves at the amount the preview showed. */
  approveHold(id: string, expectedAmountCents: number): Promise<DecisionAnswer>;
  declineHold(id: string): Promise<DecisionAnswer>;
  /** New limits, based on the version the owner was looking at. */
  updateLimits(input: LimitsInput, basedOnVersion: number): Promise<LimitsAnswer>;
  /** The kill switch; `typed` must be the word REVOKE. */
  revokeMandate(typed: string): Promise<RevokeMandateAnswer>;
  issueKey(name: string): Promise<IssueKeyAnswer>;
  revokeKey(agentId: string): Promise<RevokeKeyAnswer>;
}

/** The same commands, except that a call which never answered comes back as `unknown`. */
export function safeCommands(commands: SlipCommands): SlipCommands {
  const unknown = (): Unknown => ({ status: "unknown" });
  return {
    previewApproval: (id) => commands.previewApproval(id).catch(unknown),
    approveHold: (id, cents) => commands.approveHold(id, cents).catch(unknown),
    declineHold: (id) => commands.declineHold(id).catch(unknown),
    updateLimits: (input, version) => commands.updateLimits(input, version).catch(unknown),
    revokeMandate: (typed) => commands.revokeMandate(typed).catch(unknown),
    issueKey: (name) => commands.issueKey(name).catch(unknown),
    revokeKey: (agentId) => commands.revokeKey(agentId).catch(unknown),
  };
}
