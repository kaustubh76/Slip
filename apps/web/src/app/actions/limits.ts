"use server";

import { updateLimits } from "@slip/app";
import { revalidatePath } from "next/cache";
import { requireOwner } from "../../server/owner";

/** The limits the owner typed, as numbers people write them. */
export interface LimitsInput {
  /** Percent, one decimal: 5 means 5 %. */
  maxOverpayPct: number;
  /** Dollars: 8 means $8.00. */
  maxOverpayDollars: number;
  flagPct: number;
  orderCapDollars: number;
  /** Minutes. */
  snapshotMaxAgeMinutes: number;
}

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
  try {
    const result = await updateLimits(
      deps,
      ownerId,
      mandateId,
      {
        maxOverpayPctHundredths: hundredths(input.maxOverpayPct),
        maxOverpayAbsCents: cents(input.maxOverpayDollars),
        flagPctHundredths: hundredths(input.flagPct),
        orderCapCents: cents(input.orderCapDollars),
        snapshotMaxAgeMs: Math.round(input.snapshotMaxAgeMinutes * 60_000),
      },
      { basedOnVersion },
    );
    revalidatePath("/limits");
    revalidatePath("/receipts");
    if (result.status === "refused") {
      return { status: "refused", reason: result.reason, message: result.message };
    }
    return { status: "updated", version: result.policy.version };
  } catch (error) {
    deps.log.error("web.limits_failed", { mandateId, error: String(error) });
    return { status: "unknown" };
  }
}
