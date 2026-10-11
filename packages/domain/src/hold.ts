import type { AttemptId } from "./ids.js";
import type { Transitions } from "./state-machine.js";

/** A HELD attempt waits for its owner. No decision within the TTL → expired → hold released. */
export const HOLD_STATUSES = ["PENDING", "APPROVED", "DECLINED", "EXPIRED"] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export const HOLD_TRANSITIONS: Transitions<HoldStatus> = {
  PENDING: ["APPROVED", "DECLINED", "EXPIRED"],
  APPROVED: [],
  DECLINED: [],
  EXPIRED: [],
};

/** 48 hours; well inside PayPal's 3-day honor period for an authorization. */
export const DEFAULT_HOLD_TTL_MS = 48 * 60 * 60 * 1000;

/** Who decided an expired hold. */
export const SYSTEM_DECIDER = "system";

export interface Hold {
  attemptId: AttemptId;
  status: HoldStatus;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
}
