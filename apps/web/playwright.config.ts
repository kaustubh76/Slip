import { defineConfig, devices } from "@playwright/test";

/**
 * Browser flows against the built app (`pnpm web:build` first), in demo mode: the in-memory store
 * and the stand-ins for Channel3 and PayPal, so nothing here needs a key. Every test opens its own
 * demo desk, so tests never share data. The base URL is plain http so the session cookie is not
 * `__Host-`/Secure-only, which a production build would otherwise insist on.
 */
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env["CI"] ? 2 : 3,
  retries: process.env["CI"] ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `${BASE}/sign-in`,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    env: {
      SLIP_DEMO: "1",
      SLIP_BASE_URL: BASE,
      SLIP_DEMO_LATENCY_MS: "300",
      SLIP_DEMO_MAX_DESKS: "1000",
      // Every test opens a desk, all from one address.
      SLIP_DEMO_DESKS_PER_ADDRESS: "1000",
      // Next fills only unset variables from a developer's apps/web/.env.local; set to empty here,
      // the tests never reach their local database or a real service's keys.
      DATABASE_URL: "",
      SLIP_ENCRYPTION_KEY: "",
      CHANNEL3_API_KEY: "",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      PAYPAL_WEBHOOK_ID: "",
      ANTHROPIC_API_KEY: "",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
