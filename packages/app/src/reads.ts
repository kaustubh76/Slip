import { type Agent, attemptId, InvalidIdError, type Receipt } from "@slip/domain";
import { viewOf } from "./checkout/checkout.js";
import { type Refusal, refuse } from "./checkout/gate.js";
import type { AppDeps } from "./deps.js";
import type { Shown } from "./holds.js";
import { hashApiKey } from "./keys.js";
import { type ReportView, renderReport } from "./report-view.js";

/**
 * What an agent may read: its own receipts and its report card. Any unrevoked key will do — the
 * agent of a revoked mandate can still see what happened — but only ever its own attempts;
 * another agent's receipt is "not found".
 */

async function agentOf(deps: AppDeps, apiKey: string): Promise<Agent | Refusal> {
  const auth = await deps.store.agents.authenticate(hashApiKey(apiKey));
  return auth === null ? refuse("UNAUTHENTICATED", "Unknown or revoked API key.") : auth.agent;
}

export interface ReceiptFound extends Shown {
  status: "found";
  /** For a HELD receipt the owner approved without a reservation: the attempt that paid. */
  followUp: Shown | null;
}

export async function getReceipt(
  deps: AppDeps,
  apiKey: string,
  id: string,
): Promise<ReceiptFound | Refusal> {
  const agent = await agentOf(deps, apiKey);
  if ("status" in agent) {
    return agent;
  }
  let receipt: Receipt | null;
  try {
    receipt = await deps.store.attempts.get(attemptId(id));
  } catch (error) {
    if (error instanceof InvalidIdError) {
      receipt = null;
    } else {
      throw error;
    }
  }
  if (receipt === null || receipt.attempt.agentId !== agent.id) {
    return refuse("NOT_FOUND", "There is no such receipt for this agent.");
  }
  const child =
    receipt.attempt.decision.outcome === "HELD"
      ? await deps.store.attempts.findChild(receipt.attempt.id)
      : null;
  return {
    status: "found",
    receipt,
    view: await viewOf(deps, receipt),
    followUp: child === null ? null : { receipt: child, view: await viewOf(deps, child) },
  };
}

export async function getReport(
  deps: AppDeps,
  apiKey: string,
): Promise<{ status: "found"; view: ReportView } | Refusal> {
  const agent = await agentOf(deps, apiKey);
  if ("status" in agent) {
    return agent;
  }
  return { status: "found", view: renderReport(await deps.store.reports.agentReport(agent.id)) };
}
