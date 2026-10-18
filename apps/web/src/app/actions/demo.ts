"use server";

import { z } from "zod";
import { isDemo } from "../../server/demo";
import { ERRAND_NAMES } from "../../server/demo/catalogue";
import {
  type ConsoleAnswer,
  consoleErrand,
  type Desk,
  PAYPAL_SCRIPTS,
  repriceDesk,
  scriptKey,
  settlePending,
} from "../../server/demo/console";
import { requireOwner } from "../../server/owner";
import { fakes, runtime } from "../../server/runtime";

/**
 * The demo console's commands: demo mode only, and only ever on the signed-in owner's own desk.
 * Like every action they answer with a result, never a thrown error.
 */

type Answer = ConsoleAnswer | { status: "unknown" };

const NOT_DEMO: { status: "refused"; message: string } = {
  status: "refused",
  message: "The console exists in demo mode only.",
};

async function desk(): Promise<Desk | null> {
  if (!isDemo()) {
    return null;
  }
  const owner = await requireOwner();
  const { deps, demo } = await runtime();
  return {
    deps,
    fakes: await fakes(),
    ownerId: owner.ownerId,
    mandateId: owner.mandateId,
    desks: demo.desks,
  };
}

async function guarded(work: (desk: Desk) => Promise<ConsoleAnswer>): Promise<Answer> {
  const mine = await desk();
  if (mine === null) {
    return NOT_DEMO;
  }
  try {
    return await work(mine);
  } catch (error) {
    mine.deps.log.error("web.demo_console_failed", { error: String(error) });
    return { status: "unknown" };
  }
}

const ErrandSchema = z.enum(ERRAND_NAMES);
const ScriptSchema = z.enum(PAYPAL_SCRIPTS);

export async function runConsoleErrand(name: string, paypal: string): Promise<Answer> {
  const errand = ErrandSchema.safeParse(name);
  const script = ScriptSchema.safeParse(paypal);
  if (!errand.success || !script.success) {
    return { status: "refused", message: "No such errand." };
  }
  return guarded((d) => consoleErrand(d, errand.data, script.data));
}

export async function settleConsolePending(): Promise<Answer> {
  return guarded(settlePending);
}

export async function raiseStandingDeskPrice(): Promise<Answer> {
  return guarded((d) => repriceDesk(d, 800));
}

export async function issueScriptKey(): Promise<
  | { status: "issued"; apiKey: string }
  | { status: "refused"; message: string }
  | { status: "unknown" }
> {
  const mine = await desk();
  if (mine === null) {
    return NOT_DEMO;
  }
  try {
    return await scriptKey(mine);
  } catch {
    return { status: "unknown" };
  }
}
