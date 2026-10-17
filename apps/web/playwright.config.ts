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
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
