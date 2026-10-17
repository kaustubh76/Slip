import "server-only";
import {
  agentCards,
  listReceipts,
  mandateSummary,
  ownerHolds,
  policyVersions,
  receiptDetail,
} from "@slip/app";
import { answer, type JsonAnswer, NOT_FOUND } from "./json";
import type { OwnerContext } from "./owner";

/**
 * The owner's read API — what the pages' hooks fetch and what a platform embedding the receipt
 * would call. Each answer is one of the wire shapes in `@slip/receipt/schema`, scoped to the
 * signed-in owner by the owner queries; anything not theirs is a 404, never a 403.
 */

type Owner = Pick<OwnerContext, "deps" | "ownerId" | "mandateId">;

export async function receiptsAnswer(owner: Owner, query: URLSearchParams): Promise<JsonAnswer> {
  const limit = Number(query.get("limit") ?? "");
  const page = await listReceipts(owner.deps, owner.ownerId, owner.mandateId, {
    before: query.get("before"),
    agent: query.get("agent"),
    ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
  });
  return page === null ? NOT_FOUND : answer(200, page);
}

export async function receiptAnswer(owner: Owner, id: string): Promise<JsonAnswer> {
  const detail = await receiptDetail(owner.deps, owner.ownerId, id);
  return detail === null ? NOT_FOUND : answer(200, detail);
}

export async function holdsAnswer(owner: Owner): Promise<JsonAnswer> {
  const holds = await ownerHolds(owner.deps, owner.ownerId, owner.mandateId);
  return holds === null ? NOT_FOUND : answer(200, holds);
}

export async function agentsAnswer(owner: Owner): Promise<JsonAnswer> {
  const agents = await agentCards(owner.deps, owner.ownerId, owner.mandateId);
  return agents === null ? NOT_FOUND : answer(200, { agents });
}

export async function policiesAnswer(owner: Owner): Promise<JsonAnswer> {
  const versions = await policyVersions(owner.deps, owner.ownerId, owner.mandateId);
  return versions === null ? NOT_FOUND : answer(200, { versions });
}

export async function mandateAnswer(owner: Owner): Promise<JsonAnswer> {
  const summary = await mandateSummary(owner.deps, owner.ownerId, owner.mandateId);
  return summary === null ? NOT_FOUND : answer(200, summary);
}
