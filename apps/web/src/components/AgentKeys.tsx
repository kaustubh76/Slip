"use client";

import { useAgentKeys } from "@slip/ui";
import { useState } from "react";
import { ConnectAgent } from "./ConnectAgent";

/**
 * Issuing and revoking agent keys. A new key is shown once, here, and held only in this
 * component's state: Slip keeps the hash, so no page can ever show it again, and it never goes
 * into a URL, a log or the query cache.
 */
export function IssueAgentKey(props: { base: string }) {
  const keys = useAgentKeys();
  const [name, setName] = useState("");
  const busy = keys.issueStatus === "busy";
  const result = keys.issueAnswer;

  if (result?.status === "issued") {
    return (
      <div className="slip-note slip-pen">
        <p className="slip-sentence">The key for {result.name}:</p>
        <p className="slip-mono slip-key">{result.apiKey}</p>
        <p className="slip-caption">
          Copy it now. Slip keeps only its hash, so this is the only time it can be shown.
        </p>
        <ConnectAgent base={props.base} apiKey={result.apiKey} />
        <button
          type="button"
          className="slip-button"
          onClick={() => {
            keys.dismiss();
            setName("");
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
        void keys.issue(name);
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
            ? "Slip could not tell whether that key was issued. If it was, it appears above; a key that was issued cannot be shown again, so revoke it and issue another."
            : result.message}
        </p>
      )}
    </form>
  );
}

export function RevokeAgentKey({ agentId, name }: { agentId: string; name: string }) {
  const keys = useAgentKeys();
  const busy = keys.revokeStatus === "busy";
  const answer = keys.revokeAnswer;
  const message =
    answer === null || answer.status === "revoked"
      ? null
      : answer.status === "unknown"
        ? "Slip could not tell whether that key was revoked. It is checking; the card updates when it knows."
        : answer.message;
  return (
    <>
      <button
        type="button"
        className="slip-button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void keys.revoke(agentId)}
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
