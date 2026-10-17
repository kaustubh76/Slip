import { defineConfig } from "vitest/config";
import { SOURCE_CONDITION } from "../../vitest.shared.ts";

/**
 * `react-server` is what marks this as a server runtime: the `server-only` package resolves to an
 * empty module under it, and throws under any other condition. Without it, importing a module
 * that guards itself with `server-only` would fail here even though the test *is* the server.
 */
const conditions = [SOURCE_CONDITION, "react-server", "module", "node", "development|production"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: "web",
    // Server-side units only (session, composition root, the demo desk). Browser flows are
    // Playwright's job: they need a built app, so they run in their own step.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
