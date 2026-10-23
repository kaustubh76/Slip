import type { AgentId, MandateId, OwnerId } from "./ids.js";
import type { Policy } from "./policy.js";
import type { Transitions } from "./state-machine.js";

export interface Owner {
  id: OwnerId;
  email: string | null;
  createdAt: Date;
}

/**
 * The owner's one-time consent. PENDING until the first PayPal checkout saves their payment
 * method; ACTIVE while Slip may charge it; REVOKED for good (the kill switch).
 */
export const MANDATE_STATUSES = ["PENDING", "ACTIVE", "REVOKED"] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export const MANDATE_TRANSITIONS: Transitions<MandateStatus> = {
  PENDING: ["ACTIVE", "REVOKED"],
  ACTIVE: ["REVOKED"],
  REVOKED: [],
};

/** The vault id itself never appears here; only `MandateRepo.vaultIdForCharge` returns it. */
export interface Mandate {
  id: MandateId;
  ownerId: OwnerId;
  status: MandateStatus;
  /** The PayPal order of the first, human-approved purchase that saved the payment method. */
  setupOrderId: string | null;
  paypalCustomerId: string | null;
  hasVaultId: boolean;
  createdAt: Date;
  activatedAt: Date | null;
  revokedAt: Date | null;
  /** When PayPal confirmed the vaulted method was deleted after the revoke. */
  vaultDeletedAt: Date | null;
  /** When Slip last checked this permission's payments against PayPal's own record (D75). */
  reconciledAt: Date | null;
  /** Purchases whose amount PayPal and Slip disagree about, as of then. A record Slip
   * cannot tie to a purchase at all has no permission to be counted under, and is logged. */
  reconcileUnmatched: number;
}

/** The thresholds an owner can edit; the version is assigned by the store. */
export type PolicyLimits = Omit<Policy, "version">;

/** An agent acts under exactly one mandate and authenticates with an API key (only its hash is stored). */
export interface Agent {
  id: AgentId;
  mandateId: MandateId;
  name: string;
  /** First characters of the key, for the owner to recognise it. Never the key. */
  apiKeyPrefix: string;
  createdAt: Date;
  revokedAt: Date | null;
}

/** What a request with a valid key resolves to. The caller refuses unless the mandate is ACTIVE. */
export interface AgentAuth {
  agent: Agent;
  mandate: Mandate;
  policy: Policy;
}
