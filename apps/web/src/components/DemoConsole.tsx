"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  issueScriptKey,
  raiseStandingDeskPrice,
  runConsoleErrand,
  settleConsolePending,
} from "../app/actions/demo";
import { answerOf } from "./answer";

export interface ConsoleErrand {
  name: string;
  label: string;
}

export interface ConsoleCall {
  at: string;
  call: string;
  receipt: string | null;
  detail: string;
  answer: string | null;
}

type ConsoleResult =
  | { status: "done"; message: string; receiptId: string | null }
  | { status: "refused"; message: string }
  | { status: "unknown" };

interface LogLine {
  n: number;
  label: string;
  text: string;
  receiptId: string | null;
}

let lines = 0;

const SCRIPTS = [
  ["answers", "PayPal answers"],
  ["times-out", "PayPal times out"],
  ["declines", "PayPal declines"],
  ["stays-pending", "PayPal leaves it pending"],
] as const;

/**
 * Drives this desk's agent and its stand-in PayPal, for showing Slip end to end: each errand is a
 * real checkout, the PayPal answer applies to that purchase only, and the call log shows what the
 * stand-in PayPal was asked and said. Everything here is simulated, and says so.
 */
export function DemoConsole(props: {
  errands: ConsoleErrand[];
  calls: ConsoleCall[];
  base: string;
}) {
  const router = useRouter();
  const [script, setScript] = useState<(typeof SCRIPTS)[number][0]>("answers");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [key, setKey] = useState<string | null>(null);

  // The call log lives on the server; read it again while the console is open.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 2_000);
    return () => clearInterval(timer);
  }, [router]);

  const run = async (label: string, send: () => Promise<ConsoleResult>) => {
    setBusy(true);
    const answer = await answerOf(send());
    setBusy(false);
    const line: LogLine =
      answer.status === "unknown"
        ? {
            n: ++lines,
            label,
            text: "No answer came back; the receipts will show what happened.",
            receiptId: null,
          }
        : {
            n: ++lines,
            label,
            text: answer.message,
            receiptId: answer.status === "done" ? answer.receiptId : null,
          };
    setLog((now) => [line, ...now].slice(0, 8));
    router.refresh();
  };

  return (
    <>
      {/* What the agent is told to do, and what PayPal was asked as a result, read together. */}
      <div className="slip-twoup">
        <article className="slip-sheet" data-perforated="">
          <p className="slip-meta">Demo console · simulated agent and PayPal</p>
          <h1 className="slip-title">Send the agent shopping</h1>
          <div className="slip-field">
            <label htmlFor="paypal-script" className="slip-field-label">
              When Slip pays
            </label>
            <select
              id="paypal-script"
              className="slip-select"
              value={script}
              onChange={(event) => setScript(event.target.value as typeof script)}
            >
              {SCRIPTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="slip-stack" data-choices="">
            {props.errands.map((errand) => (
              <button
                key={errand.name}
                type="button"
                className="slip-button"
                disabled={busy}
                onClick={() => void run(errand.label, () => runConsoleErrand(errand.name, script))}
              >
                {errand.label}
              </button>
            ))}
          </div>
          <div className="slip-dialog-actions">
            <button
              type="button"
              className="slip-button"
              disabled={busy}
              onClick={() => void run("Settle pending", settleConsolePending)}
            >
              Settle pending payments
            </button>
            <button
              type="button"
              className="slip-button"
              disabled={busy}
              onClick={() => void run("Reprice", raiseStandingDeskPrice)}
            >
              Raise the standing desk's price by $8
            </button>
          </div>
          {log.length === 0 ? null : (
            <ol className="slip-timeline slip-mono" aria-live="polite">
              {log.map((line) => (
                <li key={line.n}>
                  {line.label}: {line.text}{" "}
                  {line.receiptId === null ? null : (
                    <Link className="slip-link" href={`/receipts/${line.receiptId}`}>
                      Open the receipt
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </article>
        <article className="slip-sheet">
          <p className="slip-meta">Simulated PayPal · what it was asked</p>
          {props.calls.length === 0 ? (
            <p className="slip-caption">No PayPal calls yet.</p>
          ) : (
            <table className="slip-offers">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Call</th>
                  <th scope="col">Receipt</th>
                  <th scope="col">Answer</th>
                </tr>
              </thead>
              <tbody>
                {props.calls.map((call) => (
                  <tr key={`${call.at}-${call.call}-${call.receipt}-${call.detail}`}>
                    <td className="slip-mono">{call.at.slice(11, 19)}</td>
                    <th scope="row">{call.detail}</th>
                    <td className="slip-mono">{call.receipt ?? "—"}</td>
                    <td>{call.answer ?? "waiting…"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      </div>

      <article className="slip-sheet">
        <p className="slip-meta">Connect an agent</p>
        <p className="slip-prose">
          The same errands from a terminal, through Slip's MCP server, with a key of the script's
          own — or point any MCP client, such as Claude Code, at this desk with the same key.
        </p>
        {key === null ? (
          <button
            type="button"
            className="slip-button"
            onClick={() =>
              void answerOf(issueScriptKey()).then((answer) => {
                if (answer.status === "issued") {
                  setKey(answer.apiKey);
                }
              })
            }
          >
            Issue a key for the script
          </button>
        ) : (
          <>
            <p className="slip-mono slip-key">
              SLIP_AGENT_KEY={key} pnpm demo:agent --errand top-pick --url {props.base}
            </p>
            <p className="slip-mono slip-command">
              claude mcp add --transport http slip {props.base}/api/mcp --header "Authorization:
              Bearer {key}"
            </p>
            <p className="slip-caption">
              Copy them now. Slip keeps only the key's hash, so it is shown this once.
            </p>
          </>
        )}
      </article>
    </>
  );
}
