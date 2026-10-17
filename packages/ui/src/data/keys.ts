/**
 * Every query the kit caches, by key. Live updates invalidate by these keys, so each piece of the
 * owner's data has exactly one.
 */
export const slipKeys = {
  all: ["slip"] as const,
  receipts: (agent: string | null = null) => ["slip", "receipts", { agent }] as const,
  receiptsAll: ["slip", "receipts"] as const,
  receipt: (id: string) => ["slip", "receipt", id] as const,
  receiptAll: ["slip", "receipt"] as const,
  holds: ["slip", "holds"] as const,
  agents: ["slip", "agents"] as const,
  policies: ["slip", "policies"] as const,
  mandate: ["slip", "mandate"] as const,
};
