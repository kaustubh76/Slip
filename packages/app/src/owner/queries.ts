import {
  type Agent,
  agentId,
  type Cursor,
  type Mandate,
  type OwnerId,
  type PageRequest,
  type Policy,
  policyVersion,
  type Receipt,
} from "@slip/domain";
import type { ReceiptView } from "@slip/receipt";
import { ownedAgent } from "../agents.js";
import type { AppDeps } from "../deps.js";
import { ownedReceipt } from "../holds.js";
import { ownedMandate } from "../mandates.js";
import { type ReportView, renderReport } from "../report-view.js";
import { createViewer } from "../views.js";

/**
 * What the owner's pages read. Every function takes the owner the web layer authenticated and is
 * scoped once, here: a mandate, receipt or agent that is not theirs — or an id that is not even
 * well formed — is `null`, exactly like one that does not exist. Results are plain JSON
 * (receipt views, ISO times), ready to send to a browser; no domain record leaves this module.
 */

export interface AgentName {
  id: string;
  name: string;
}

export interface ReceiptRow {
  view: ReceiptView;
  agent: AgentName;
}

export interface ReceiptPage {
  rows: ReceiptRow[];
  /** Opaque; pass it back as `before` for the next (older) page. Null on the last page. */
  next: string | null;
}

export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** A keyset cursor as one URL-safe token. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

/** A token from `encodeCursor`; anything else means "the first page". */
export function decodeCursor(token: string | null | undefined): Cursor | undefined {
  if (!token) {
    return undefined;
  }
  const [iso, id, extra] = Buffer.from(token, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (extra !== undefined || !id || Number.isNaN(createdAt.getTime())) {
    return undefined;
  }
  return { createdAt, id };
}

/** The owner's receipts, newest first, optionally for one of the mandate's agents. */
export async function listReceipts(
  deps: AppDeps,
  ownerId: OwnerId,
  mandate: string,
  options: { limit?: number; before?: string | null; agent?: string | null } = {},
): Promise<ReceiptPage | null> {
  const owned = await ownedMandate(deps, ownerId, mandate);
  if (owned === null) {
    return null;
  }
  const names = await agentNames(deps, owned);
  const agent = options.agent ? names.get(options.agent) : undefined;
  if (options.agent && agent === undefined) {
    return null;
  }
  const before = decodeCursor(options.before);
  const request: PageRequest = {
    limit: Math.min(Math.max(1, Math.floor(options.limit ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE),
    ...(before === undefined ? {} : { before }),
  };
  const page =
    agent === undefined
      ? await deps.store.attempts.listByMandate(owned.id, request)
      : await deps.store.attempts.listByAgent(agentId(agent.id), request);
  return {
    rows: await rowsOf(deps, page.items, names),
    next: page.next === null ? null : encodeCursor(page.next),
  };
}

export interface ReceiptDetail extends ReceiptRow {
  /** For an owner-approval attempt: the hold it paid for. */
  parent: ReceiptView | null;
  /** For an approved hold with no reservation: the attempt that paid for it. */
  followUp: ReceiptView | null;
  /** The payment's status changes, oldest first. */
  timeline: { at: string; from: string; to: string }[];
}

/** One receipt with everything behind it: the snapshot's other offers, parent or follow-up. */
export async function receiptDetail(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<ReceiptDetail | null> {
  const owned = await ownedReceipt(deps, ownerId, id);
  if (owned === null) {
    return null;
  }
  const { receipt } = owned;
  const { attempt } = receipt;
  const snapshotId = attempt.decision.checkResult.snapshotId;
  const [snapshot, child, parent, agent, events] = await Promise.all([
    snapshotId === null ? null : deps.store.snapshots.get(snapshotId),
    receipt.hold?.status === "APPROVED" ? deps.store.attempts.findChild(attempt.id) : null,
    attempt.parentAttemptId === null ? null : deps.store.attempts.get(attempt.parentAttemptId),
    deps.store.agents.get(attempt.agentId),
    receipt.payment === null ? [] : deps.store.payments.events(attempt.id),
  ]);
  const view = createViewer(deps);
  return {
    view: await view(receipt, { child, snapshot }),
    agent: { id: attempt.agentId, name: agent?.name ?? "unknown agent" },
    parent: parent === null ? null : await view(parent),
    followUp: child === null ? null : await view(child),
    timeline: events.map((e) => ({ at: e.at.toISOString(), from: e.fromStatus, to: e.toStatus })),
  };
}

/** Holds waiting for the owner, the soonest to expire first. */
export async function pendingHolds(
  deps: AppDeps,
  ownerId: OwnerId,
  mandate: string,
): Promise<ReceiptRow[] | null> {
  const owned = await ownedMandate(deps, ownerId, mandate);
  if (owned === null) {
    return null;
  }
  const [pending, names] = await Promise.all([
    deps.store.holds.listPending(owned.id),
    agentNames(deps, owned),
  ]);
  const byExpiry = [...pending].sort(
    (a, b) =>
      (a.hold?.expiresAt.getTime() ?? 0) - (b.hold?.expiresAt.getTime() ?? 0) ||
      (a.attempt.id < b.attempt.id ? -1 : 1),
  );
  return rowsOf(deps, byExpiry, names);
}

export interface AgentCard {
  agent: {
    id: string;
    name: string;
    /** The first characters of the key, so the owner can recognise it. Never the key. */
    apiKeyPrefix: string;
    createdAt: string;
    revokedAt: string | null;
  };
  report: ReportView;
}

/** The mandate's agents, each with its report card, oldest first. */
export async function agentCards(
  deps: AppDeps,
  ownerId: OwnerId,
  mandate: string,
): Promise<AgentCard[] | null> {
  const owned = await ownedMandate(deps, ownerId, mandate);
  if (owned === null) {
    return null;
  }
  const agents = await deps.store.agents.listByMandate(owned.id);
  return Promise.all(agents.map((agent) => cardOf(deps, agent)));
}

/** One agent's card, if the agent is the owner's. */
export async function agentCard(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<AgentCard | null> {
  const agent = await ownedAgent(deps, ownerId, id);
  return agent === null ? null : cardOf(deps, agent);
}

async function cardOf(deps: AppDeps, agent: Agent): Promise<AgentCard> {
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      apiKeyPrefix: agent.apiKeyPrefix,
      createdAt: agent.createdAt.toISOString(),
      revokedAt: agent.revokedAt?.toISOString() ?? null,
    },
    report: renderReport(await deps.store.reports.agentReport(agent.id)),
  };
}

/** Every version of the owner's limits, newest first; past decisions keep their version. */
export async function policyVersions(
  deps: AppDeps,
  ownerId: OwnerId,
  mandate: string,
): Promise<Policy[] | null> {
  const owned = await ownedMandate(deps, ownerId, mandate);
  if (owned === null) {
    return null;
  }
  const current = await deps.store.mandates.currentPolicy(owned.id);
  const older = await Promise.all(
    Array.from({ length: current.version - 1 }, (_, i) =>
      deps.store.mandates.policy(owned.id, policyVersion(current.version - 1 - i)),
    ),
  );
  return [current, ...older.filter((p): p is Policy => p !== null)];
}

export interface MandateSummary {
  id: string;
  status: Mandate["status"];
  /** PENDING with a PayPal setup started: the owner still has to approve at PayPal. */
  awaitingPayPal: boolean;
  hasSavedMethod: boolean;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  /** When PayPal confirmed the saved method was deleted after a revoke. */
  savedMethodDeletedAt: string | null;
  policyVersion: number;
  pendingHolds: number;
  agents: number;
}

/** The permission slip at a glance: status, limits version, what is waiting. */
export async function mandateSummary(
  deps: AppDeps,
  ownerId: OwnerId,
  mandate: string,
): Promise<MandateSummary | null> {
  const owned = await ownedMandate(deps, ownerId, mandate);
  if (owned === null) {
    return null;
  }
  const [policy, pending, agents] = await Promise.all([
    deps.store.mandates.currentPolicy(owned.id),
    deps.store.holds.listPending(owned.id),
    deps.store.agents.listByMandate(owned.id),
  ]);
  return {
    id: owned.id,
    status: owned.status,
    awaitingPayPal: owned.status === "PENDING" && owned.setupOrderId !== null,
    hasSavedMethod: owned.hasVaultId,
    createdAt: owned.createdAt.toISOString(),
    activatedAt: owned.activatedAt?.toISOString() ?? null,
    revokedAt: owned.revokedAt?.toISOString() ?? null,
    savedMethodDeletedAt: owned.vaultDeletedAt?.toISOString() ?? null,
    policyVersion: policy.version,
    pendingHolds: pending.length,
    agents: agents.length,
  };
}

async function agentNames(deps: AppDeps, mandate: Mandate): Promise<Map<string, AgentName>> {
  const agents = await deps.store.agents.listByMandate(mandate.id);
  return new Map(agents.map((a) => [a.id as string, { id: a.id, name: a.name }]));
}

async function rowsOf(
  deps: AppDeps,
  receipts: Receipt[],
  names: Map<string, AgentName>,
): Promise<ReceiptRow[]> {
  const view = createViewer(deps);
  return Promise.all(
    receipts.map(async (receipt) => ({
      view: await view(receipt),
      agent: names.get(receipt.attempt.agentId) ?? {
        id: receipt.attempt.agentId,
        name: "unknown agent",
      },
    })),
  );
}
