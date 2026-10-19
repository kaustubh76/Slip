import {
  createMcpHandler,
  localhostAllowedOrigins,
  type McpHttpHandler,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { type AppDeps, apiKeyFromHeader, hashApiKey } from "@slip/app";
import { type ProductSearch, recordingSearch } from "./search.js";
import { createSlipServer } from "./server.js";

/**
 * Slip's MCP server over HTTP: a web-standard `(request) => response` any host can mount (the web
 * app serves it at /api/mcp). Each request is checked in order:
 *
 * 1. **Origin.** A browser page on another site is turned away (DNS-rebinding defence); clients
 *    that are not browsers send no Origin and pass.
 * 2. **The agent's key**, from `Authorization: Bearer`, on every request — so a key revoked
 *    mid-conversation fails on its very next call. A cancelled permission still reads its receipts;
 *    `checkout` then refuses, as it would over REST.
 * 3. **The MCP exchange**, served statelessly for both protocol eras: 2025-era clients through the
 *    SDK's stateless fallback, 2026-07-28 clients per request. Nothing is kept between requests.
 *
 * The key is never logged. Errors are reported through `onError` and answered without detail.
 */

export interface SlipMcpEndpointOptions {
  /** The application, read on every request (a host's runtime may build it lazily). */
  deps: () => Promise<AppDeps>;
  /** A catalogue for this agent's permission, when the host has one (see `search_products`). */
  search?: (mandateId: string) => ProductSearch | undefined | Promise<ProductSearch | undefined>;
  /** Hostnames a browser Origin may carry. Defaults to the public base URL's host. */
  allowedOriginHosts?: readonly string[];
  /** The largest request body read, in bytes. A checkout is under 3 KB. */
  maxRequestBodyBytes?: number;
  onError?: (error: unknown) => void;
}

export const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function createSlipMcpEndpoint(
  options: SlipMcpEndpointOptions,
): (request: Request) => Promise<Response> {
  const report = (error: unknown) => options.onError?.(error);
  let handler: McpHttpHandler | undefined;
  const mcp = (): McpHttpHandler => {
    handler ??= createMcpHandler(
      async ({ authInfo }) => {
        if (authInfo === undefined) {
          throw new Error("an unauthenticated request reached the MCP handler");
        }
        const mandateId = String(authInfo.extra?.["mandateId"] ?? "");
        const deps = await options.deps();
        const catalogue =
          options.search === undefined ? undefined : await options.search(mandateId);
        return createSlipServer({
          deps,
          apiKey: authInfo.token,
          // Whatever the host's catalogue is, Slip remembers what it showed this agent, so the
          // checkout that follows can have the steering check read it (D69). `clientId` is the
          // agent the key authenticated as, set below.
          search:
            catalogue === undefined
              ? undefined
              : recordingSearch(deps, String(authInfo.clientId ?? ""), catalogue),
        });
      },
      {
        legacy: "stateless",
        responseMode: "json",
        maxRequestBodySize: options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BYTES,
        // No tool list ever changes, so no client needs to hold a subscription stream open.
        maxSubscriptions: 8,
        onerror: report,
      },
    );
    return handler;
  };

  return async (request) => {
    try {
      const deps = await options.deps();
      const foreign = originValidationResponse(request, [
        ...(options.allowedOriginHosts ?? originHosts(deps.config.publicBaseUrl)),
      ]);
      if (foreign !== undefined) {
        return foreign;
      }
      const key = apiKeyFromHeader(request.headers.get("authorization"));
      if (key === null) {
        return unauthorized("Send your Slip key as Authorization: Bearer slip_live_...");
      }
      const auth = await deps.store.agents.authenticate(hashApiKey(key));
      if (auth === null) {
        return unauthorized("Unknown or revoked Slip key.");
      }
      return await mcp().fetch(request, {
        authInfo: {
          token: key,
          clientId: auth.agent.id,
          scopes: [],
          extra: { mandateId: auth.mandate.id },
        },
      });
    } catch (error) {
      report(error);
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: "Slip could not answer that just now." },
        },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

/** The public base URL's host, and every localhost name when that host is local. */
export function originHosts(publicBaseUrl: string): string[] {
  const host = new URL(publicBaseUrl).hostname;
  return LOCAL_HOSTS.has(host) ? [host, ...localhostAllowedOrigins()] : [host];
}

/** A 401 an HTTP client can act on (RFC 6750). The message must stay ASCII: it is a header. */
function unauthorized(message: string): Response {
  return Response.json(
    { error: "invalid_token", error_description: message },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer realm="slip", error="invalid_token", error_description="${message}"`,
      },
    },
  );
}
