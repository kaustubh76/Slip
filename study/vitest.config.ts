import { defineConfig } from "vitest/config";
import { workspaceSources } from "../vitest.shared.ts";

export default defineConfig({
  ...workspaceSources,
  test: {
    name: "study",
    include: ["src/**/*.test.ts"],
  },
});
