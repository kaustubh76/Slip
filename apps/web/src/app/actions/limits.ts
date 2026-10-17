"use server";

import { updateLimits } from "@slip/app";
import {
  invalidRequest,
  type LimitsInput,
  LimitsInputSchema,
  PolicyVersionSchema,
} from "../../server/action-input";
import { requireOwner } from "../../server/owner";

/** The limits the owner typed, as numbers people write them (percent, dollars, minutes). */
export type { LimitsInput };

/** The version the page was showing, so a stale tab cannot overwrite a newer one. */
export type LimitsResult =
  | { status: "updated"; version: number }
  | { status: "refused"; reason: string; message: string }
  | { status: "unknown" };

const hundredths = (percent: number) => Math.round(percent * 100);
const cents = (dollars: number) => Math.round(dollars * 100);

/** A new version of the limits. Past decisions keep the version they were checked under. */
export async function saveLimits(
  input: LimitsInput,
  basedOnVersion: number,
): Promise<LimitsResult> {
  const { ownerId, mandateId, deps } = await requireOwner();
  const parsed = LimitsInputSchema.safeParse(input);
  if (!parsed.success || !PolicyVersionSchema.safeParse(basedOnVersion).success) {
    return invalidRequest("limits");
  }
  const values = parsed.data;
  try {
    const result = await updateLimits(
      deps,
      ownerId,
      mandateId,
      {
        maxOverpayPctHundredths: hundredths(values.maxOverpayPct),
        maxOverpayAbsCents: cents(values.maxOverpayDollars),
        flagPctHundredths: hundredths(values.flagPct),
        orderCapCents: cents(values.orderCapDollars),
        snapshotMaxAgeMs: Math.round(values.snapshotMaxAgeMinutes * 60_000),
      },
      { basedOnVersion },
    );
    if (result.status === "refused") {
      return { status: "refused", reason: result.reason, message: result.message };
    }
    return { status: "updated", version: result.policy.version };
  } catch (error) {
    deps.log.error("web.limits_failed", { mandateId, error: String(error) });
    return { status: "unknown" };
  }
}
