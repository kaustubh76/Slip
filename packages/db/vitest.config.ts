import { defineConfig } from "vitest/config";
import { workspaceSources } from "../../vitest.shared.ts";

export default defineConfig({
  ...workspaceSources,
  test: {
    name: "db",
    include: ["src/**/*.test.ts"],
    // PGlite boots a WASM Postgres per test file; real Postgres creates a database per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
