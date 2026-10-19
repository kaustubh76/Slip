/**
 * The PayPal app chores a local run needs, kept apart from the command lines so they can be tested:
 * which webhook to keep, update or create, and a small client for PayPal's REST API that never
 * prints a secret or a token.
 */

/** Slip's webhook route on any host: a quick tunnel's URL changes, the path does not. */
export const WEBHOOK_PATH = "/api/webhooks/paypal";

export interface ExistingWebhook {
  id: string;
  url: string;
  event_types: { name: string }[];
}

export type WebhookPlan =
  | { action: "create" }
  | { action: "update"; id: string }
  | { action: "keep"; id: string };

/**
 * One webhook per app for Slip, matched by its path: re-pointed at a new tunnel URL rather than
 * recreated, so its id — which verification needs, and which `.env.local` holds — never changes,
 * and the app never reaches PayPal's ten-webhook limit.
 */
export function planWebhook(
  existing: readonly ExistingWebhook[],
  url: string,
  events: readonly string[],
): WebhookPlan {
  const ours = existing.find((w) => pathOf(w.url) === WEBHOOK_PATH);
  if (ours === undefined) {
    return { action: "create" };
  }
  const same =
    ours.url === url &&
    sameSet(
      ours.event_types.map((e) => e.name),
      events,
    );
  return same ? { action: "keep", id: ours.id } : { action: "update", id: ours.id };
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

export const SANDBOX_API = "https://api-m.sandbox.paypal.com";
export const LIVE_API = "https://api-m.paypal.com";

/** PayPal's REST API with client credentials. Errors carry the status and PayPal's issue names only. */
export async function paypalApi(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch) {
  const base = env["PAYPAL_ENV"]?.trim().toLowerCase() === "live" ? LIVE_API : SANDBOX_API;
  const id = env["PAYPAL_CLIENT_ID"]?.trim() ?? "";
  const secret = env["PAYPAL_CLIENT_SECRET"]?.trim() ?? "";
  if (id === "" || secret === "") {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (apps/web/.env.local)");
  }
  const auth = await fetchImpl(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!auth.ok) {
    throw new Error(`PayPal refused the credentials (${auth.status}) at ${base}`);
  }
  const token = ((await auth.json()) as { access_token: string }).access_token;
  return {
    base,
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      const parsed = text === "" ? null : (JSON.parse(text) as unknown);
      if (!response.ok) {
        const issues = ((parsed as { details?: { issue?: string }[] } | null)?.details ?? [])
          .map((d) => d.issue)
          .filter(Boolean)
          .join(", ");
        const name = (parsed as { name?: string } | null)?.name ?? "";
        throw new Error(
          `PayPal answered ${response.status} to ${method} ${path} ${name} ${issues}`.trim(),
        );
      }
      return parsed as T;
    },
  };
}
