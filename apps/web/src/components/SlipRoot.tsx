"use client";

import { createSlipClient, type SlipCommands, SlipProvider } from "@slip/ui";
import { type ReactNode, useState } from "react";
import { issueKey, revokeKey } from "../app/actions/agents";
import { approve, decline, previewHoldApproval } from "../app/actions/holds";
import { saveLimits } from "../app/actions/limits";
import { revokeTheMandate } from "../app/actions/mandate";

/** The owner's commands are this app's server actions. */
const commands: SlipCommands = {
  previewApproval: previewHoldApproval,
  approveHold: approve,
  declineHold: decline,
  updateLimits: saveLimits,
  revokeMandate: revokeTheMandate,
  issueKey,
  revokeKey,
};

/** Where the kit is plugged in: one client and one query cache for the whole browser tab. */
export function SlipRoot({ children }: { children: ReactNode }) {
  const [client] = useState(() => createSlipClient({ commands }));
  return <SlipProvider client={client}>{children}</SlipProvider>;
}
