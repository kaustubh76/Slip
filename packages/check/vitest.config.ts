import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "check",
    include: ["src/**/*.test.ts"],
  },
});
