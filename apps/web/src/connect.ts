/**
 * What an owner needs in order to point an agent at their Slip: the endpoint, the one command a
 * client takes, and the configuration block for clients that read a file instead.
 *
 * It lives apart from the components because the demo console and the owner's own agents page both
 * hand it out, and a key pasted into two slightly different commands is a support problem nobody
 * can see. Pure, so the exact strings can be tested without a browser.
 *
 * **The key is only ever known once.** Slip stores its hash, so the snippets carry the real key at
 * the moment it is issued and the name of an environment variable at every other time. Nothing here
 * puts a key in a URL: it travels as a header, which is also the only way the endpoint accepts it.
 */

/** Stands in for the key once it can no longer be shown. A shell reads it from the environment. */
export const KEY_PLACEHOLDER = "$SLIP_AGENT_KEY";

export interface ConnectDetails {
  /** Where an MCP client connects. */
  endpoint: string;
  /** For agents that speak plain HTTP instead of MCP. */
  restEndpoint: string;
  /** One line, for a client configured from a terminal. */
  command: string;
  /** The same thing for a client that reads a config file. */
  config: string;
  /** True when the snippets carry the real key, which is the case exactly once. */
  carriesKey: boolean;
}

export function connectDetails(input: {
  base: string;
  apiKey?: string | undefined;
}): ConnectDetails {
  const base = input.base.replace(/\/+$/, "");
  const endpoint = `${base}/api/mcp`;
  const key = input.apiKey === undefined || input.apiKey === "" ? KEY_PLACEHOLDER : input.apiKey;
  return {
    endpoint,
    restEndpoint: `${base}/api/v1/agent/checkout`,
    command: `claude mcp add --transport http slip ${endpoint} --header "Authorization: Bearer ${key}"`,
    config: JSON.stringify(
      { mcpServers: { slip: { url: endpoint, headers: { Authorization: `Bearer ${key}` } } } },
      null,
      2,
    ),
    carriesKey: key !== KEY_PLACEHOLDER,
  };
}
