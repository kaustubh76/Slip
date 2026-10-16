import { defineConfig } from "vitest/config";
import { workspaceSources } from "../../vitest.shared.ts";

export default defineConfig({
  ...workspaceSources,
  test: {
    name: "check",
    include: ["src/**/*.test.ts"],
  },
});
