import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library cleans up by itself only with Vitest globals, which this repo does not use.
afterEach(() => {
  cleanup();
});
