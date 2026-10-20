import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SLIP_WEBHOOK_EVENTS } from "@slip/paypal";
import { type ExistingWebhook, paypalApi, planWebhook, WEBHOOK_PATH } from "./paypal-admin";

/**
 * `pnpm paypal:webhook https://<public host> [--save]` — points the PayPal app's webhook for Slip
 * at `<public host>/api/webhooks/paypal`, creating it the first time and re-pointing it after (a
 * quick tunnel's address changes on every run; the webhook id does not). Subscribes to every event
 * Slip acts on that PayPal offers this app. Prints the webhook id; with `--save`, writes it to
 * apps/web/.env.local as PAYPAL_WEBHOOK_ID.
 */

const ENV_FILE = fileURLToPath(new URL("../.env.local", import.meta.url));
loadEnv(ENV_FILE);

/** The keys live in apps/web/.env.local; on a fresh clone there is no such file yet. */
function loadEnv(file: string): void {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    console.error(`No ${file}. Copy .env.example there and fill in the PayPal values first.`);
    process.exit(2);
  }
}

const [publicBase] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const save = process.argv.includes("--save");
if (publicBase === undefined || !publicBase.startsWith("https://")) {
  console.error(
    "Usage: pnpm paypal:webhook https://<public host> [--save]  (PayPal requires https)",
  );
  process.exit(2);
}
const url = new URL(WEBHOOK_PATH.slice(1), publicBase.endsWith("/") ? publicBase : `${publicBase}/`)
  .href;

const api = await paypalApi(process.env);
const offered = await api.call<{ event_types: { name: string }[] }>(
  "GET",
  "/v1/notifications/webhooks-event-types",
);
const available = new Set(offered.event_types.map((e) => e.name));
const events = SLIP_WEBHOOK_EVENTS.filter((e) => available.has(e));
const missing = SLIP_WEBHOOK_EVENTS.filter((e) => !available.has(e));
if (missing.length > 0) {
  console.log(`PayPal does not offer ${missing.join(", ")} to this app; subscribing to the rest.`);
}
const existing = await api.call<{ webhooks: ExistingWebhook[] }>(
  "GET",
  "/v1/notifications/webhooks",
);
const plan = planWebhook(existing.webhooks, url, events);
const eventTypes = events.map((name) => ({ name }));
let id: string;
if (plan.action === "create") {
  id = (
    await api.call<{ id: string }>("POST", "/v1/notifications/webhooks", {
      url,
      event_types: eventTypes,
    })
  ).id;
} else if (plan.action === "update") {
  await api.call("PATCH", `/v1/notifications/webhooks/${plan.id}`, [
    { op: "replace", path: "/url", value: url },
    { op: "replace", path: "/event_types", value: eventTypes },
  ]);
  id = plan.id;
} else {
  id = plan.id;
}
console.log(
  `${plan.action === "keep" ? "kept" : `${plan.action}d`} webhook ${id} → ${url} (${events.length} events, ${api.base})`,
);

if (save) {
  const lines = readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("PAYPAL_WEBHOOK_ID="));
  const body = `${lines.join("\n").replace(/\n+$/, "")}\nPAYPAL_WEBHOOK_ID=${id}\n`;
  writeFileSync(ENV_FILE, body, { mode: 0o600 });
  console.log("saved PAYPAL_WEBHOOK_ID in apps/web/.env.local");
}
