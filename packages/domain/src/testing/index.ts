/**
 * Builders shared by the tests of every package (`@slip/domain/testing`). Pure and
 * deterministic: ids come from a counter shaped as UUIDs, time from the fixed `NOW`.
 */
import {
  type Attempt,
  type AttemptOrigin,
  type CheckoutRequest,
  type ClassifierAnswer,
  type Decision,
  RULE_OUTCOME,
  type RuleCode,
} from "../attempt.js";
import {
  type AgentId,
  type AttemptId,
  agentId,
  attemptId,
  type MandateId,
  mandateId,
  policyVersion,
  type SnapshotId,
  snapshotId,
} from "../ids.js";
import {
  type Cents,
  commissionToBps,
  gapPctHundredthsFloor,
  parseUsdNumberToCents,
} from "../money.js";
import type { Availability, Condition, Offer, OfferSnapshot, SelectedOption } from "../offer.js";

/** Fixed clock for every test; snapshots default to being fetched at this instant. */
export const NOW = new Date("2026-10-11T14:02:00.000Z");

let counter = 0;

/**
 * A valid v4-shaped UUID. With an argument it is stable (`testUuid(7)` is always the same id);
 * without one it is the next value of a per-module counter.
 */
export function testUuid(n?: number): string {
  let value = n;
  if (value === undefined) {
    counter += 1;
    value = counter;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`testUuid needs a non-negative integer, got ${String(value)}`);
  }
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

export const TEST_AGENT_ID: AgentId = agentId(testUuid(0xa9e47));
export const TEST_MANDATE_ID: MandateId = mandateId(testUuid(0x3a7d));

/** Minutes relative to `NOW`. */
export function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

export interface OfferSpec {
  /** Dollars, as Channel3 would send it. `null` models an unparsable price. */
  price: number | null;
  domain?: string;
  url?: string;
  /** Commission as a fraction (0.08 = 8 %). Defaults to 0, Channel3's "no data". `null` = unknown. */
  rate?: number | null;
  availability?: Availability;
  condition?: Condition;
  currency?: string;
  text?: string | null;
}

/** An offer that reads like a sentence: `offer({ price: 47.99, domain: "store-b.example", rate: 0.02 })`. */
export function offer(spec: OfferSpec): Offer {
  counter += 1;
  const domain = spec.domain ?? `store-${counter}.example`;
  return {
    url: spec.url ?? `https://${domain}/p/${counter}`,
    domain,
    priceCents: spec.price === null ? null : parseUsdNumberToCents(spec.price),
    currency: spec.currency ?? "USD",
    availability: spec.availability ?? "InStock",
    condition: spec.condition === undefined ? "new" : spec.condition,
    commissionBps:
      spec.rate === undefined ? 0 : spec.rate === null ? null : commissionToBps(spec.rate),
    listingText: spec.text ?? null,
  };
}

export interface SnapshotSpec {
  offers: Offer[];
  selected?: SelectedOption[];
  fetchedAt?: Date;
  productId?: string;
  id?: string;
}

export function snapshot(spec: SnapshotSpec): OfferSnapshot {
  const id = spec.id ?? testUuid();
  return {
    id: snapshotId(id),
    productId: spec.productId ?? "prod-1",
    title: "Test product",
    selectedOptions: spec.selected ?? [],
    offers: spec.offers,
    rawHash: `hash-${id}`,
    fetchedAt: spec.fetchedAt ?? NOW,
  };
}

export interface RequestSpec {
  url: string;
  selected?: SelectedOption[];
  agentId?: AgentId;
  productId?: string;
  reason?: string;
}

export function request(spec: RequestSpec): CheckoutRequest {
  return {
    agentId: spec.agentId ?? TEST_AGENT_ID,
    productId: spec.productId ?? "prod-1",
    chosenOfferUrl: spec.url,
    ...(spec.selected === undefined ? {} : { selectedOptions: spec.selected }),
    reason: spec.reason ?? "test",
  };
}

export interface DecisionSpec {
  ruleCode: RuleCode;
  /** The chosen offer; defaults to a $50.00 USD offer. `null` when the check never located one. */
  chosen?: Offer | null;
  /** The best comparable offer; defaults to the chosen one (gap 0). */
  best?: Offer | null;
  /** Extra rules that also tripped, after the deciding one. */
  alsoTripped?: RuleCode[];
  policyVersion?: number;
  snapshotId?: SnapshotId | null;
  classifier?: ClassifierAnswer;
  conflict?: boolean;
}

/**
 * A consistent `Decision` without running the check: outcome from `RULE_OUTCOME`, gap from the
 * two offers. Use `@slip/check` when the decision itself is under test.
 */
export function testDecision(spec: DecisionSpec): Decision {
  const chosen = spec.chosen === undefined ? offer({ price: 50 }) : spec.chosen;
  const best = spec.best === undefined ? chosen : spec.best;
  const gap =
    chosen?.priceCents != null && best?.priceCents != null
      ? ((chosen.priceCents - best.priceCents) as Cents)
      : null;
  return {
    outcome: RULE_OUTCOME[spec.ruleCode],
    ruleCode: spec.ruleCode,
    checkResult: {
      policyVersion: policyVersion(spec.policyVersion ?? 1),
      snapshotId: spec.snapshotId === undefined ? snapshotId(testUuid()) : spec.snapshotId,
      snapshotFetchedAt: NOW,
      comparableCount: best === null ? 0 : 2,
      chosen,
      best,
      gapAbsCents: gap,
      gapPctHundredths:
        gap !== null && best?.priceCents != null
          ? gapPctHundredthsFloor(gap, best.priceCents)
          : null,
      conflict: spec.conflict ?? false,
      classifier: spec.classifier ?? "NOT_RUN",
      ruleCodes: [spec.ruleCode, ...(spec.alsoTripped ?? [])],
      ruleCode: spec.ruleCode,
    },
  };
}

export interface AttemptSpec {
  decision: Decision;
  id?: AttemptId;
  agentId?: AgentId;
  mandateId?: MandateId;
  productId?: string;
  origin?: AttemptOrigin;
  parentAttemptId?: AttemptId | null;
  chosenOfferUrl?: string;
  createdAt?: Date;
}

export function testAttempt(spec: AttemptSpec): Attempt {
  return {
    id: spec.id ?? attemptId(testUuid()),
    agentId: spec.agentId ?? TEST_AGENT_ID,
    mandateId: spec.mandateId ?? TEST_MANDATE_ID,
    productId: spec.productId ?? "prod-1",
    origin: spec.origin ?? "AGENT",
    parentAttemptId: spec.parentAttemptId ?? null,
    chosenOfferUrl:
      spec.chosenOfferUrl ?? spec.decision.checkResult.chosen?.url ?? "https://store.example/p/1",
    selectedOptions: null,
    reason: "test",
    decision: spec.decision,
    createdAt: spec.createdAt ?? NOW,
  };
}
