import { describe, expect, it } from "vitest";
import { publicBaseUrl, publicUrl } from "./public-url";

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

describe("the address Slip believes it is at", () => {
  const env = (over: Record<string, string>) => over as unknown as NodeJS.ProcessEnv;

  it("is the one the operator set, whatever the host thinks", () => {
    // Behind a tunnel or a custom domain, what the operator named is the only thing that can be
    // right — the host only knows the address it gave out itself.
    expect(
      publicBaseUrl(
        env({
          SLIP_BASE_URL: "https://slip.example",
          RENDER_EXTERNAL_URL: "https://x.onrender.com",
        }),
      ),
    ).toBe("https://slip.example");
  });

  it("is the host's own, when the operator named none", () => {
    expect(publicBaseUrl(env({ RENDER_EXTERNAL_URL: "https://slip-demo.onrender.com" }))).toBe(
      "https://slip-demo.onrender.com",
    );
  });

  it("is empty when nobody said, so every caller keeps its own default", () => {
    expect(publicBaseUrl(env({}))).toBe("");
    expect(publicBaseUrl(env({ SLIP_BASE_URL: "   " }))).toBe("");
  });
});
