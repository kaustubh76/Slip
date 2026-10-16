"use server";

import { issueAgentKey, revokeAgentKey } from "@slip/app";
import { revalidatePath } from "next/cache";
import { requireOwner } from "../../server/owner";

export type IssueResult =
  | { status: "issued"; name: string; apiKey: string }
  | { status: "refused"; reason: string; message: string }
  | { status: "unknown" };

export type RevokeResult =
  | { status: "revoked" }
  | { status: "refused"; reason: string; message: string }
  | { status: "unknown" };

/**
 * A new key for one agent. It is returned once, to be shown once: Slip stores only its hash, so
 * nothing can show it again, and it is never put in a URL or a log.
 */
export async function issueKey(name: string): Promise<IssueResult> {
  const { ownerId, mandateId, deps } = await requireOwner();
  try {
    const result = await issueAgentKey(deps, ownerId, mandateId, { name });
    revalidatePath("/agents");
    return result.status === "refused"
      ? { status: "refused", reason: result.reason, message: result.message }
      : { status: "issued", name: result.agent.name, apiKey: result.apiKey };
  } catch (error) {
    deps.log.error("web.issue_key_failed", { mandateId, error: String(error) });
    return { status: "unknown" };
  }
}

/** Stops one agent at once, and nothing else: the mandate and the other agents carry on. */
export async function revokeKey(agentId: string): Promise<RevokeResult> {
  const { ownerId, deps } = await requireOwner();
  try {
    const result = await revokeAgentKey(deps, ownerId, agentId);
    revalidatePath("/agents");
    return result.status === "refused"
      ? { status: "refused", reason: result.reason, message: result.message }
      : { status: "revoked" };
  } catch (error) {
    deps.log.error("web.revoke_key_failed", { agentId, error: String(error) });
    return { status: "unknown" };
  }
}
