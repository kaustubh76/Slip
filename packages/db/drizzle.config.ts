import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` diffs src/schema.ts against the committed snapshots; no database needed.
// Trigger and lookup-table SQL lives in hand-written migrations created with `--custom`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
