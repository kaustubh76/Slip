import {
  type AgentCard,
  AgentCardSchema,
  type Holds,
  HoldsSchema,
  type MandateSummary,
  MandateSummarySchema,
  type PolicyView,
  PolicyViewSchema,
  type ReceiptDetail,
  ReceiptDetailSchema,
  type ReceiptPage,
  ReceiptPageSchema,
} from "@slip/receipt";
import { z } from "zod";
import { type SlipCommands, safeCommands } from "./commands.js";

/**
 * One typed object over the owner's read API and the host's commands. Every response is checked
 * against its wire schema, so a page never renders a shape it was not built for; a failure is a
 * `SlipClientError` that says what kind of failure it is.
 */

export type SlipClientErrorKind = "signed-out" | "not-found" | "server" | "invalid";

export class SlipClientError extends Error {
  readonly kind: SlipClientErrorKind;
  readonly status: number;

  constructor(kind: SlipClientErrorKind, status: number, message: string) {
    super(message);
    this.name = "SlipClientError";
    this.kind = kind;
    this.status = status;
  }
}

export interface ReceiptsQuery {
  before?: string | null;
  agent?: string | null;
  limit?: number;
}

export interface SlipClient {
  receipts(query?: ReceiptsQuery, signal?: AbortSignal): Promise<ReceiptPage>;
  receipt(id: string, signal?: AbortSignal): Promise<ReceiptDetail>;
  holds(signal?: AbortSignal): Promise<Holds>;
  agents(signal?: AbortSignal): Promise<AgentCard[]>;
  policies(signal?: AbortSignal): Promise<PolicyView[]>;
  mandate(signal?: AbortSignal): Promise<MandateSummary>;
  /** How much has happened under the mandate, as one short token (see the change stamp). */
  stamp(signal?: AbortSignal): Promise<string>;
  readonly commands: SlipCommands;
}

const AgentsSchema = z.object({ agents: z.array(AgentCardSchema) });
const PoliciesSchema = z.object({ versions: z.array(PolicyViewSchema) });
const StampSchema = z.object({ token: z.string().min(1).max(200) });

export function createSlipClient(options: {
  /** Where the API lives; "" for the same origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  commands: SlipCommands;
}): SlipClient {
  const base = (options.baseUrl ?? "").replace(/\/$/, "");
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function get<S extends z.ZodType>(
    path: string,
    schema: S,
    signal?: AbortSignal,
  ): Promise<z.infer<S>> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      throw new SlipClientError("server", 0, "Slip could not be reached.");
    }
    if (!response.ok) {
      const kind: SlipClientErrorKind =
        response.status === 401
          ? "signed-out"
          : response.status === 404
            ? "not-found"
            : response.status >= 500
              ? "server"
              : "invalid";
      throw new SlipClientError(kind, response.status, `GET ${path} answered ${response.status}`);
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new SlipClientError("invalid", response.status, `GET ${path}: unexpected shape`);
    }
    return parsed.data;
  }

  const qs = (query: ReceiptsQuery): string => {
    const params = new URLSearchParams();
    if (query.before) {
      params.set("before", query.before);
    }
    if (query.agent) {
      params.set("agent", query.agent);
    }
    if (query.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    const text = params.toString();
    return text === "" ? "" : `?${text}`;
  };

  return {
    receipts: (query = {}, signal) =>
      get(`/api/v1/receipts${qs(query)}`, ReceiptPageSchema, signal),
    receipt: (id, signal) =>
      get(`/api/v1/receipts/${encodeURIComponent(id)}`, ReceiptDetailSchema, signal),
    holds: (signal) => get("/api/v1/holds", HoldsSchema, signal),
    agents: async (signal) => (await get("/api/v1/agents", AgentsSchema, signal)).agents,
    policies: async (signal) => (await get("/api/v1/policies", PoliciesSchema, signal)).versions,
    mandate: (signal) => get("/api/v1/mandate", MandateSummarySchema, signal),
    stamp: async (signal) => (await get("/api/v1/stamp", StampSchema, signal)).token,
    commands: safeCommands(options.commands),
  };
}
