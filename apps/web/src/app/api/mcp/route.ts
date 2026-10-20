import { createSlipMcpEndpoint } from "@slip/mcp";
import { isDemo } from "../../../server/demo";
import { deskSearch } from "../../../server/demo/search";
import { logApiError } from "../../../server/owner-route";
import { deps, fakes, runtime as slipRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Slip's MCP server: `POST /api/mcp` with `Authorization: Bearer slip_live_…`. It runs in this
 * process because the demo's state lives here; the tools are the same use cases as the REST agent
 * endpoint, so an agent gets the same decisions either way. The application is read per request,
 * never while the module loads (`next build` evaluates route modules).
 */
const endpoint = createSlipMcpEndpoint({
  deps,
  // The demo searches the visitor's own desk catalogue; everywhere else, Channel3 itself when
  // there is a key for it. Either way the endpoint records what it showed this agent (D69).
  search: async (mandateId) =>
    isDemo()
      ? deskSearch((await fakes()).offers, mandateId)
      : ((await slipRuntime()).catalogue?.forMandate(mandateId) ?? undefined),
  onError: logApiError,
});

export const POST = endpoint;
export const GET = endpoint;
export const DELETE = endpoint;
