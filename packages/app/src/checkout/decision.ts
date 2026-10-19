import { createHash } from "node:crypto";
import { decide, isSnapshotFresh, prepareCheck } from "@slip/check";
import {
  type AgentAuth,
  type AgentId,
  attemptId,
  type CheckoutRequest,
  type ClassifierAnswer,
  type Decision,
  type OfferSnapshot,
  type OffersFailure,
  type Policy,
  type RecordAttemptInput,
  requestId,
  snapshotId,
} from "@slip/domain";
import { withDeadline } from "../deadline.js";
import type { AppDeps } from "../deps.js";
import { searchContextFor } from "./search-context.js";

export type SnapshotSource = "cache" | "fetched" | "not-found" | "stale" | "none";

export interface SnapshotOutcome {
  /** `null` when Slip has no prices for the product at all (→ R1 HELD). */
  snapshot: OfferSnapshot | null;
  source: SnapshotSource;
  failure: OffersFailure | null;
}

/**
 * The offers the check runs on: a snapshot still fresh under the owner's policy is reused;
 * otherwise Channel3 is asked (within its deadline) and the answer saved. A product Channel3 does
 * not know becomes a zero-offer snapshot — the check then says "offer not found" rather than
 * holding. Any other failure falls back to the last snapshot, stale or not, and the check's R1
 * holds the purchase for the owner.
 */
export async function currentSnapshot(
  deps: AppDeps,
  request: CheckoutRequest,
  policy: Policy,
  now: Date,
): Promise<SnapshotOutcome> {
  const latest = await deps.store.snapshots.latestForProduct(request.productId);
  if (latest !== null && isSnapshotFresh(latest, policy, now)) {
    return { snapshot: latest, source: "cache", failure: null };
  }

  let fetched: Awaited<ReturnType<AppDeps["offers"]["fetchProduct"]>>;
  try {
    const result = await withDeadline(deps.clock, deps.config.offersTimeoutMs, (signal) =>
      deps.offers.fetchProduct(request.productId, signal),
    );
    fetched = result.timedOut ? { ok: false, reason: "TIMEOUT" } : result.value;
  } catch (error) {
    deps.log.error("offers.fetch_threw", { productId: request.productId, error: String(error) });
    fetched = { ok: false, reason: "UNAVAILABLE" };
  }

  const fetchedAt = deps.clock.now();
  if (fetched.ok) {
    const snapshot: OfferSnapshot = {
      id: snapshotId(deps.ids.uuid()),
      productId: request.productId,
      title: fetched.product.title,
      selectedOptions: fetched.product.selectedOptions,
      offers: fetched.product.offers,
      rawHash: fetched.product.rawHash,
      fetchedAt,
    };
    await deps.store.snapshots.save(snapshot, fetched.product.raw);
    return { snapshot, source: "fetched", failure: null };
  }

  if (fetched.reason === "NOT_FOUND") {
    // No such product: nothing to compare and nothing to pay for. The variant mirrors the request
    // so the check reports the real problem (offer not found), not a variant mismatch.
    const raw = { notFound: true, productId: request.productId };
    const snapshot: OfferSnapshot = {
      id: snapshotId(deps.ids.uuid()),
      productId: request.productId,
      title: "",
      selectedOptions: request.selectedOptions ?? [],
      offers: [],
      rawHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
      fetchedAt,
    };
    await deps.store.snapshots.save(snapshot, raw);
    return { snapshot, source: "not-found", failure: "NOT_FOUND" };
  }

  deps.log.warn("offers.unavailable", { productId: request.productId, reason: fetched.reason });
  return latest === null
    ? { snapshot: null, source: "none", failure: fetched.reason }
    : { snapshot: latest, source: "stale", failure: fetched.reason };
}

/**
 * Runs the check. The classifier is asked only when the check needs it (gap above the flag line),
 * within its deadline; a listing with no text cannot instruct an agent and is not sent. Any
 * timeout, error or refusal is `NO_ANSWER`, which R4a holds for the owner. `reuse` replays an
 * answer already obtained (a re-run after a policy change).
 */
export async function checkOffers(
  deps: AppDeps,
  input: {
    request: CheckoutRequest;
    policy: Policy;
    snapshot: OfferSnapshot | null;
    now: Date;
    reuse?: ClassifierAnswer;
  },
): Promise<{ decision: Decision; classifier: ClassifierAnswer }> {
  const { request, policy, snapshot, now } = input;
  const prepared = prepareCheck({ snapshot, request, policy, now });
  if (prepared.kind !== "ready") {
    return { decision: prepared.decision, classifier: "NOT_RUN" };
  }
  let answer: ClassifierAnswer = "NOT_RUN";
  if (prepared.classifierRequired) {
    answer =
      input.reuse ??
      (await classify(deps, {
        listingText: prepared.chosen.listingText,
        snapshot,
        agentId: request.agentId,
        productId: request.productId,
        now,
      }));
  }
  return { decision: decide(prepared, policy, answer), classifier: answer };
}

/**
 * Asks the steering classifier about everything the agent could have read: the chosen merchant's
 * own listing text, and what Slip's own search showed this agent for the product (D69).
 *
 * Both halves matter, and on real data only the second exists — a Channel3 offer carries no text
 * (D67), so before this the classifier was never called on a real purchase and R3 could not fire.
 * With neither there is genuinely nothing to judge, and an unflagged answer is the right one:
 * Slip has seen nothing to object to.
 */
async function classify(
  deps: AppDeps,
  input: {
    listingText: string | null;
    snapshot: OfferSnapshot | null;
    agentId: AgentId;
    productId: string;
    now: Date;
  },
): Promise<ClassifierAnswer> {
  const listingText = input.listingText ?? "";
  const searchContext = await searchContextFor(deps, {
    agentId: input.agentId,
    productId: input.productId,
    now: input.now,
  });
  if (listingText.trim() === "" && searchContext === null) {
    return { instruction_like: false };
  }
  try {
    const result = await withDeadline(deps.clock, deps.config.classifierTimeoutMs, (signal) =>
      deps.classifier.classify(
        { listingText, productTitle: input.snapshot?.title ?? "", searchContext },
        signal,
      ),
    );
    if (result.timedOut) {
      deps.log.warn("classifier.timeout", {});
      return "NO_ANSWER";
    }
    deps.log.info("classifier.verdict", {
      answer: result.value.answer,
      model: result.value.model,
      promptVersion: result.value.promptVersion,
    });
    return result.value.answer;
  } catch (error) {
    deps.log.error("classifier.threw", { error: String(error) });
    return "NO_ANSWER";
  }
}

/**
 * What `record` writes for a decision: PAID pays in one step; HELD holds for the owner and, when
 * there is a USD price to reserve, places an authorization; REJECTED writes the decision alone.
 * Ids come from the injected source; the lease holder proves this checkout still owns the product.
 */
export function recordInputFor(
  deps: AppDeps,
  input: {
    auth: AgentAuth;
    request: CheckoutRequest;
    decision: Decision;
    now: Date;
    leaseHolder: string;
  },
): RecordAttemptInput {
  const { auth, request, decision, now } = input;
  const chosen = decision.checkResult.chosen;
  const priced = chosen?.priceCents != null && chosen.currency === "USD";
  return {
    attempt: {
      id: attemptId(deps.ids.uuid()),
      agentId: auth.agent.id,
      mandateId: auth.mandate.id,
      productId: request.productId,
      origin: "AGENT",
      parentAttemptId: null,
      chosenOfferUrl: request.chosenOfferUrl,
      selectedOptions: request.selectedOptions ?? null,
      reason: request.reason,
      decision,
      createdAt: now,
    },
    payment:
      decision.outcome === "PAID"
        ? { intent: "CAPTURE", requestId: requestId(deps.ids.uuid()) }
        : decision.outcome === "HELD" && priced
          ? { intent: "AUTHORIZE", requestId: requestId(deps.ids.uuid()) }
          : null,
    hold:
      decision.outcome === "HELD"
        ? { expiresAt: new Date(now.getTime() + deps.config.holdTtlMs) }
        : null,
    leaseHolder: input.leaseHolder,
  };
}
