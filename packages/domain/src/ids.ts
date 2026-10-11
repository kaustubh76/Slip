import { z } from "zod";
import type { Branded } from "./brand.js";
import { InvalidIdError } from "./errors.js";

/**
 * Every id Slip generates is a UUID created by the application before the row is written, so a
 * decision can reference its payment before either exists in the database (write-ahead). The
 * database stores them in `uuid` columns; validating here means a bad id fails at the boundary,
 * the same way in the Postgres store and in the in-memory fake.
 */
export type OwnerId = Branded<string, "OwnerId">;
export type AgentId = Branded<string, "AgentId">;
export type MandateId = Branded<string, "MandateId">;
/** Also the receipt id: one attempt, one receipt (D15). */
export type AttemptId = Branded<string, "AttemptId">;
export type SnapshotId = Branded<string, "SnapshotId">;
/** PayPal-Request-Id: one per PayPal operation, reused verbatim on every retry of it. */
export type RequestId = Branded<string, "RequestId">;

/** Policies are versioned per mandate, starting at 1; every edit creates the next version. */
export type PolicyVersion = Branded<number, "PolicyVersion">;

const UUID = z.uuid();

export function isUuid(value: unknown): value is string {
  return UUID.safeParse(value).success;
}

function uuidOf(kind: string, value: string): string {
  if (!isUuid(value)) {
    throw new InvalidIdError(`${kind} must be a UUID: ${String(value)}`);
  }
  return value.toLowerCase();
}

export const ownerId = (value: string): OwnerId => uuidOf("OwnerId", value) as OwnerId;
export const agentId = (value: string): AgentId => uuidOf("AgentId", value) as AgentId;
export const mandateId = (value: string): MandateId => uuidOf("MandateId", value) as MandateId;
export const attemptId = (value: string): AttemptId => uuidOf("AttemptId", value) as AttemptId;
export const snapshotId = (value: string): SnapshotId => uuidOf("SnapshotId", value) as SnapshotId;
export const requestId = (value: string): RequestId => uuidOf("RequestId", value) as RequestId;

/** zod schema factory for a branded UUID, for request and row parsing. */
export function uuidSchema<B extends string>() {
  return z.uuid().transform((s) => s.toLowerCase() as Branded<string, B>);
}

export function policyVersion(value: number): PolicyVersion {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidIdError(`PolicyVersion must be a positive integer: ${String(value)}`);
  }
  return value as PolicyVersion;
}
