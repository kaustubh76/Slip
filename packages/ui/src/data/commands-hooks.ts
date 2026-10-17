"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DecisionAnswer,
  LimitsAnswer,
  LimitsInput,
  PreviewAnswer,
  Refused,
  RevokeMandateAnswer,
} from "./commands.js";
import { slipKeys } from "./keys.js";
import { useSlip } from "./provider.js";

/**
 * The owner's commands as hooks. None of them is optimistic: nothing on the page changes until the
 * server says what happened, because the page must never show money as moved, held or released on
 * a guess. A command whose answer was lost is `unknown` — Slip is checking — and the hook reads the
 * data again until the outcome shows; it never sends the command a second time on its own (D48).
 */

export type CommandStatus = "idle" | "busy" | "unknown";

/** While an answer is unknown: read again this often, for this long. */
const REREAD_EVERY_MS = 1_000;
const REREAD_FOR_MS = 30_000;

type Preview = Extract<PreviewAnswer, { status: "preview" }>;

export interface HoldDecisionState {
  /** What approving would charge, once asked for. */
  preview: Preview | null;
  refusal: Refused | null;
  status: CommandStatus;
  /** The server's answer to the decision this tab sent, if it sent one. */
  decided: Extract<DecisionAnswer, { status: "done" }> | null;
  /** Asks what approving would charge. An explicit command: it can price the item again. */
  loadPreview(): Promise<void>;
  /** Approves at exactly the amount the owner was shown. */
  approve(expectedAmountCents: number): Promise<void>;
  decline(): Promise<void>;
  /** Forgets the preview, refusal and answer (closing the dialog). */
  reset(): void;
}

/** The owner's decision on one hold. */
export function useHoldDecision(id: string): HoldDecisionState {
  const { client } = useSlip();
  const queries = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [refusal, setRefusal] = useState<Refused | null>(null);
  const [status, setStatus] = useState<CommandStatus>("idle");
  const [decided, setDecided] = useState<HoldDecisionState["decided"]>(null);
  const sending = useRef(false);

  const refresh = useCallback(async () => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: slipKeys.receipt(id) }),
      queries.invalidateQueries({ queryKey: slipKeys.receiptsAll }),
      queries.invalidateQueries({ queryKey: slipKeys.holds }),
      queries.invalidateQueries({ queryKey: slipKeys.mandate }),
    ]);
  }, [queries, id]);

  // A lost answer: read the receipt until the decision shows (no longer PENDING, nothing in flight).
  useEffect(() => {
    if (status !== "unknown") {
      return;
    }
    let stopped = false;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (stopped) {
        return;
      }
      if (Date.now() - started > REREAD_FOR_MS) {
        clearInterval(timer);
        return;
      }
      try {
        const detail = await client.receipt(id);
        queries.setQueryData(slipKeys.receipt(id), detail);
        if (detail.view.hold?.status !== "PENDING" && !detail.view.state.inFlight) {
          clearInterval(timer);
          await refresh();
          if (!stopped) {
            setStatus("idle");
          }
        }
      } catch {
        // Still unreachable: keep trying until the time is up.
      }
    }, REREAD_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [status, client, queries, id, refresh]);

  const settle = useCallback(
    async (answer: DecisionAnswer) => {
      if (answer.status === "done") {
        setDecided(answer);
        setRefusal(null);
        setStatus("idle");
        await refresh();
        return;
      }
      if (answer.status === "unknown") {
        setStatus("unknown");
        return;
      }
      setRefusal(answer);
      setStatus("idle");
      if (answer.reason === "ALREADY_DECIDED" || answer.reason === "EXPIRED") {
        await refresh();
      }
    },
    [refresh],
  );

  const run = useCallback(
    async (send: () => Promise<DecisionAnswer>) => {
      if (sending.current) {
        return;
      }
      sending.current = true;
      setStatus("busy");
      try {
        await settle(await send());
      } finally {
        sending.current = false;
      }
    },
    [settle],
  );

  return {
    preview,
    refusal,
    status,
    decided,
    loadPreview: async () => {
      setPreview(null);
      setRefusal(null);
      const answer = await client.commands.previewApproval(id);
      if (answer.status === "preview") {
        setPreview(answer);
        setStatus("idle");
      } else if (answer.status === "refused") {
        setRefusal(answer);
        setStatus("idle");
      } else {
        setStatus("unknown");
      }
    },
    approve: (expectedAmountCents) =>
      run(() => client.commands.approveHold(id, expectedAmountCents)),
    decline: () => run(() => client.commands.declineHold(id)),
    reset: () => {
      setPreview(null);
      setRefusal(null);
      setDecided(null);
      if (!sending.current) {
        setStatus("idle");
      }
    },
  };
}

/** One command with its status and answer, sent at most once at a time. */
function useCommand<A extends unknown[], R extends { status: string }>(
  send: (...args: A) => Promise<R>,
  after: (answer: R) => Promise<void>,
) {
  const [status, setStatus] = useState<CommandStatus>("idle");
  const [answer, setAnswer] = useState<R | null>(null);
  const sending = useRef(false);
  const run = useCallback(
    async (...args: A): Promise<R | null> => {
      if (sending.current) {
        return null;
      }
      sending.current = true;
      setStatus("busy");
      try {
        const result = await send(...args);
        setAnswer(result);
        setStatus(result.status === "unknown" ? "unknown" : "idle");
        await after(result);
        return result;
      } finally {
        sending.current = false;
      }
    },
    [send, after],
  );
  return { run, status, answer, clear: () => setAnswer(null) };
}

/** New limits, as the next version, based on the version the owner was looking at. */
export function useUpdateLimits() {
  const { client } = useSlip();
  const queries = useQueryClient();
  const command = useCommand(
    (input: LimitsInput, basedOnVersion: number) =>
      client.commands.updateLimits(input, basedOnVersion),
    async (_answer: LimitsAnswer) => {
      // Refused or not, show the version in force now (a stale tab learns about the newer one).
      await Promise.all([
        queries.invalidateQueries({ queryKey: slipKeys.policies }),
        queries.invalidateQueries({ queryKey: slipKeys.mandate }),
      ]);
    },
  );
  return { save: command.run, status: command.status, answer: command.answer };
}

/** The kill switch. It can take a while: every open hold is released, one PayPal call each. */
export function useRevokeMandate() {
  const { client } = useSlip();
  const queries = useQueryClient();
  const command = useCommand(
    (typed: string) => client.commands.revokeMandate(typed),
    async (_answer: RevokeMandateAnswer) => {
      await queries.invalidateQueries({ queryKey: slipKeys.all });
    },
  );
  return { revoke: command.run, status: command.status, answer: command.answer };
}

/**
 * Issuing and revoking agent keys. An issued key is shown once: it lives in this hook's state
 * only — never in the query cache, a URL or a log — and `dismiss` forgets it for good.
 */
export function useAgentKeys() {
  const { client } = useSlip();
  const queries = useQueryClient();
  const refresh = useCallback(async () => {
    await queries.invalidateQueries({ queryKey: slipKeys.agents });
  }, [queries]);
  const issue = useCommand((name: string) => client.commands.issueKey(name), refresh);
  const revoke = useCommand((agentId: string) => client.commands.revokeKey(agentId), refresh);
  const issued = issue.answer?.status === "issued" ? issue.answer : null;
  return {
    issue: issue.run,
    issueStatus: issue.status,
    issueAnswer: issue.answer,
    issued,
    dismiss: issue.clear,
    revoke: revoke.run,
    revokeStatus: revoke.status,
    revokeAnswer: revoke.answer,
  };
}
