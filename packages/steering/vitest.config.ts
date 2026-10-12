import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "steering",
    include: ["src/**/*.test.ts"],
  },
});
