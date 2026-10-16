import { defineConfig } from "vitest/config";
import { workspaceSources } from "../../vitest.shared.ts";

export default defineConfig({
  ...workspaceSources,
  test: {
    name: "web",
    // Server-side units only (session, composition root, action mapping). Browser flows are
    // Playwright's job; they need a built app, so they run in their own CI step.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
