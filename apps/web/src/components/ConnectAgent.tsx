"use client";

import { CopyButton } from "@slip/ui";
import { connectDetails } from "../connect";

/**
 * How an owner points an agent at their Slip. Until this existed, issuing a key told the owner to
 * copy it and nothing else: the endpoint, the header it travels in and the one command a client
 * takes were written only in the repository's docs and the demo console, which is not where
 * somebody with a fresh key is standing.
 *
 * It takes the key only when the key is still known — at the moment of issue, on the same screen,
 * never fetched again. Afterwards the same snippets name an environment variable instead, because
 * Slip keeps a hash and cannot show the key a second time.
 */
export function ConnectAgent(props: { base: string; apiKey?: string | undefined }) {
  const details = connectDetails(props);
  return (
    <div className="slip-stack">
      <p className="slip-field-label">Where it connects</p>
      <p className="slip-mono slip-command">
        {details.endpoint} <CopyButton value={details.endpoint} label="Copy the endpoint" />
      </p>

      <p className="slip-field-label">One command, for a client set up from a terminal</p>
      <p className="slip-mono slip-command">
        {details.command} <CopyButton value={details.command} label="Copy the command" />
      </p>

      <p className="slip-field-label">Or the same thing, for a client that reads a file</p>
      <p className="slip-mono slip-command">
        {details.config} <CopyButton value={details.config} label="Copy the configuration" />
      </p>

      <p className="slip-caption">
        {details.carriesKey
          ? "The key is in both snippets. This is the only time Slip can put it there: it keeps the hash, not the key."
          : "Slip keeps only the hash of a key, so these carry the name of an environment variable instead of the key itself. Issue a new key if the old one is lost."}{" "}
        An agent that does not speak MCP can post to {details.restEndpoint} with the same header and
        get the same decision.
      </p>
    </div>
  );
}
