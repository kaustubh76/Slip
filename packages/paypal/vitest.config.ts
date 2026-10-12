import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "paypal",
    include: ["src/**/*.test.ts"],
  },
});
