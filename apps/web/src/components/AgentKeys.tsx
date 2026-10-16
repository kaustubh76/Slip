"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type IssueResult, issueKey, revokeKey } from "../app/actions/agents";

/**
 * Issuing and revoking agent keys. A new key is shown once, here, and held only in this
 * component's state: Slip keeps the hash, so no page can ever show it again, and it never goes
 * into a URL, a log or the query cache.
 */
export function IssueAgentKey() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);

  if (result?.status === "issued") {
    return (
      <div className="slip-note slip-pen">
        <p className="slip-sentence">The key for {result.name}:</p>
        <p className="slip-mono slip-key">{result.apiKey}</p>
        <p className="slip-caption">
          Copy it now. Slip keeps only its hash, so this is the only time it can be shown.
        </p>
        <button
          type="button"
          className="slip-button"
          onClick={() => {
            setResult(null);
            setName("");
            router.refresh();
          }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void issueKey(name).then((answer) => {
          setBusy(false);
          setResult(answer);
          if (answer.status === "issued") {
            router.refresh();
          }
        });
      }}
    >
      <div className="slip-field">
        <label htmlFor="agent-name" className="slip-field-label">
          Name the agent
        </label>
        <input
          id="agent-name"
          className="slip-blank"
          style={{ inlineSize: "22ch" }}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="shopper-2"
        />
      </div>
      <div className="slip-dialog-actions">
        <button
          type="submit"
          className="slip-button"
          data-variant="ink"
          disabled={busy || name.trim() === ""}
          aria-busy={busy}
        >
          {busy ? "Issuing a key…" : "Issue a key"}
        </button>
      </div>
      {result === null ? null : (
        <p className="slip-note slip-pen" role="status">
          {result.status === "unknown"
            ? "Slip could not tell whether that key was issued. Reload the page to see."
            : result.message}
        </p>
      )}
    </form>
  );
}

export function RevokeAgentKey({ agentId, name }: { agentId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="slip-button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setBusy(true);
          void revokeKey(agentId).then((answer) => {
            setBusy(false);
            setMessage(
              answer.status === "revoked"
                ? null
                : answer.status === "unknown"
                  ? "Slip could not tell whether that key was revoked. Reload the page to see."
                  : answer.message,
            );
            router.refresh();
          });
        }}
      >
        {busy ? `Revoking ${name}'s key…` : `Revoke ${name}'s key`}
      </button>
      {message === null ? null : (
        <p className="slip-note slip-pen" role="status">
          {message}
        </p>
      )}
    </>
  );
}
