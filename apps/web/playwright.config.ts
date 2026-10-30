import { defineConfig, devices } from "@playwright/test";

/**
 * Browser flows against the built app (`pnpm web:build` first), on two servers.
 *
 * **Demo** (:3100 by default) is most of the suite: the in-memory store and the stand-ins for Channel3 and
 * PayPal, so nothing needs a key, and every test opens its own desk so tests never share data.
 *
 * **Owner** (:3101 by default) is the same build without `SLIP_DEMO`, which is the deployment shape a real
 * owner meets: no desks, no stand-in catalogue, and the only way in is the credential they set
 * (D71). It had no browser coverage at all until that existed, so `owner-start.spec.ts` runs there
 * and nowhere else.
 *
 * The base URLs are plain http so the session cookie is not `__Host-`/Secure-only, which a
 * production build would otherwise insist on.
 */
/**
 * Overridable, because a hardcoded port makes the whole suite unrunnable when anything else on the
 * machine happens to hold it — which is not a hypothetical: an unrelated server sat on 3101 on
 * 29 Oct 2026 and the owner project could not start at all. The defaults are unchanged.
 */
const PORT = Number(process.env["SLIP_E2E_PORT"] ?? 3100);
const BASE = `http://localhost:${PORT}`;
const OWNER_PORT = Number(process.env["SLIP_E2E_OWNER_PORT"] ?? 3101);
const OWNER_BASE = `http://localhost:${OWNER_PORT}`;

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
  /**
   * Both servers get 120 s to answer `/sign-in`, and that number is **not** a guess waiting to be
   * raised. Measured on 30 Oct 2026 at load average 61: the demo server answered in **1.5 s** and
   * the owner server in **1.0 s** — the budget is some eighty times the cost.
   *
   * It did fail once today, at load average 201, and the temptation then was to raise it. That
   * would have been fitting the repo to a machine in a state where nothing else passed either: the
   * same hour produced eleven browser "failures" that were all timeouts and no defects. A startup
   * budget is the one that fails the whole file before a single test runs, so it reports nothing
   * when it trips — which is a reason to leave it generous, not a reason to keep inflating it.
   *
   * The owner server answers this quickly because it does not build its database at startup; the
   * first request that touches it does, which is what COLD_DATABASE in `owner-start.spec.ts` pays
   * for.
   */
  webServer: [
    {
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
        // Next fills only unset variables from a developer's apps/web/.env.local; set to empty
        // here, the tests never reach their local database or a real service's keys.
        DATABASE_URL: "",
        SLIP_ENCRYPTION_KEY: "",
        CHANNEL3_API_KEY: "",
        PAYPAL_CLIENT_ID: "",
        PAYPAL_CLIENT_SECRET: "",
        PAYPAL_WEBHOOK_ID: "",
        ANTHROPIC_API_KEY: "",
      },
    },
    {
      // A fresh database each time the server starts. It is kept on disk for the run, but the
      // stand-in PayPal numbers its setups from one again on every start, so a database left by
      // an earlier run makes the second owner collide with the first on the setup order's id.
      command: `rm -rf .data/e2e-owner && pnpm exec next start -p ${OWNER_PORT}`,
      url: `${OWNER_BASE}/sign-in`,
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
      env: {
        // No SLIP_DEMO: the shape a real owner meets. An in-process Postgres on disk, because
        // without the demo there is no in-memory store to fall back to.
        SLIP_BASE_URL: OWNER_BASE,
        DATABASE_URL: "pglite://.data/e2e-owner",
        // A throwaway 32-byte key: it encrypts nothing but this suite's stand-in vault ids.
        SLIP_ENCRYPTION_KEY: "sXyk7slMgRFZhfOkAEblHWq2z2k/FwWFgywJ3FgYRos=",
        CHANNEL3_API_KEY: "",
        PAYPAL_CLIENT_ID: "",
        PAYPAL_CLIENT_SECRET: "",
        PAYPAL_WEBHOOK_ID: "",
        ANTHROPIC_API_KEY: "",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      testIgnore: /owner-start\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "owner",
      testMatch: /owner-start\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: OWNER_BASE },
    },
  ],
});
