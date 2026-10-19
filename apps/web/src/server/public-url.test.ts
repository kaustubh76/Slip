import { describe, expect, it } from "vitest";
import { publicUrl } from "./public-url";

describe("publicUrl", () => {
  it("lands on the public base URL, keeping its path and the query", () => {
    expect(publicUrl("http://localhost:3000", "/mandate?setup=active").href).toBe(
      "http://localhost:3000/mandate?setup=active",
    );
    expect(publicUrl("https://slip.example/app/", "/sign-in").href).toBe(
      "https://slip.example/app/sign-in",
    );
    expect(publicUrl("https://slip.example/app", "mandate").href).toBe(
      "https://slip.example/app/mandate",
    );
  });
});
