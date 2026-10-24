import { describe, expect, it } from "vitest";
import { judgeOrigin } from "./origin";

/**
 * The rule is "present must match, absent passes", which has two edges worth pinning: a platform
 * calling Slip server-to-server must not be locked out for sending no header, and a browser that
 * declines to name where it came from must not be let through for the same reason.
 */

const allowed = ["slip.example", "localhost"];
const judge = (origin: string | null) => judgeOrigin({ origin, allowed });

describe("judgeOrigin", () => {
  it("passes a caller that sends no origin at all, which is every server-to-server client", () => {
    expect(judge(null)).toBe("ok");
    expect(judge("")).toBe("ok");
    expect(judge("   ")).toBe("ok");
  });

  it("passes Slip's own pages, whatever port or scheme they are served on", () => {
    expect(judge("https://slip.example")).toBe("ok");
    expect(judge("http://localhost:3000")).toBe("ok");
    expect(judge("http://localhost:3200")).toBe("ok");
  });

  it("refuses another site", () => {
    expect(judge("https://evil.example")).toBe("foreign");
    // The near miss that reads like Slip's own and is not: a subdomain is a different host.
    expect(judge("https://slip.example.evil.test")).toBe("foreign");
    expect(judge("https://notslip.example")).toBe("foreign");
  });

  it("refuses an opaque origin rather than reading it as no origin", () => {
    // A sandboxed frame, or a POST redirected across origins: a browser saying "somewhere I will
    // not name". Waving it through on the technicality that it is not a URL is the hole.
    expect(judge("null")).toBe("foreign");
    expect(judge("NULL")).toBe("foreign");
  });

  it("refuses anything it cannot read as an origin", () => {
    expect(judge("slip.example")).toBe("foreign");
    expect(judge("¬a url")).toBe("foreign");
  });

  it("refuses everything when the deployment answers to no host it knows", () => {
    expect(judgeOrigin({ origin: "https://slip.example", allowed: [] })).toBe("foreign");
    // Except a caller that is not a browser, which was never the thing being judged.
    expect(judgeOrigin({ origin: null, allowed: [] })).toBe("ok");
  });
});
