import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "db",
    include: ["src/**/*.test.ts"],
    // PGlite boots a WASM Postgres per test file; real Postgres creates a database per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
