import { defineConfig } from "vitest/config";
import { workspaceSources } from "../vitest.shared.ts";

export default defineConfig({
  ...workspaceSources,
  test: {
    name: "e2e",
    include: ["src/**/*.test.ts"],
    // Each PGlite test clones a migrated database. Migrating the template takes a second or two
    // alone, but far longer while every project boots WASM Postgres at once in `pnpm test`.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
