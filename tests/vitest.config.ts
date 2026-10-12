import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    include: ["src/**/*.test.ts"],
    // Each PGlite test clones a migrated database; the first migration takes a second or two.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
