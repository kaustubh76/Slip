import type { NextConfig } from "next";

/**
 * The server must hold one copy of each workspace package: if `@slip/app` checked errors against
 * one copy of `@slip/domain` while `@slip/db` threw them from another, `instanceof` would fail and
 * typed refusals would become server errors. Turbopack bundles workspace packages (their real
 * paths are outside node_modules) into one server graph, so every route shares one copy; this
 * list keeps them together under any bundler that does honour it, and keeps PGlite's WASM files
 * where its own package expects them. Proven when the shell was built: a duplicate email through
 * `registerOwner` came back as the typed EMAIL_IN_USE refusal under `next start` (D42).
 */
const config: NextConfig = {
  serverExternalPackages: [
    "@slip/app",
    "@slip/check",
    "@slip/db",
    "@slip/domain",
    "@slip/offers",
    "@slip/paypal",
    "@slip/steering",
    "@electric-sql/pglite",
  ],
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md into the app when a coding agent runs it.
  agentRules: false,
  reactStrictMode: true,
};

export default config;
