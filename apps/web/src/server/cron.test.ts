import { describe, expect, it } from "vitest";
import { authoriseCron } from "./cron";

/**
 * The resolver captures holds and voids authorizations, so this endpoint is a way to move money
 * from outside. Every case below is about who gets turned away.
 */

const ask = (over: Partial<Parameters<typeof authoriseCron>[0]> = {}) =>
  authoriseCron({ authorization: null, vercelCron: null, secret: undefined, ...over });

describe("who may run the resolver over HTTP", () => {
  it("nobody, until a secret is configured", () => {
    expect(ask()).toBe("unconfigured");
    expect(ask({ authorization: "Bearer anything" })).toBe("unconfigured");
  });

  it("Vercel's own scheduler, which cannot send a header of ours", () => {
    expect(ask({ vercelCron: "1" })).toBe("ok");
  });

  it("the secret as a bearer token, with or without the word", () => {
    expect(ask({ secret: "s3cret", authorization: "Bearer s3cret" })).toBe("ok");
    expect(ask({ secret: "s3cret", authorization: "bearer s3cret" })).toBe("ok");
    expect(ask({ secret: "s3cret", authorization: "s3cret" })).toBe("ok");
    expect(ask({ secret: " s3cret ", authorization: "Bearer s3cret" })).toBe("ok");
  });

  it("nobody with the wrong secret, a prefix of it, or none at all", () => {
    expect(ask({ secret: "s3cret", authorization: "Bearer wrong" })).toBe("unauthorized");
    expect(ask({ secret: "s3cret", authorization: "Bearer s3cre" })).toBe("unauthorized");
    expect(ask({ secret: "s3cret", authorization: null })).toBe("unauthorized");
    expect(ask({ secret: "s3cret", authorization: "Bearer " })).toBe("unauthorized");
  });

  it("not Vercel's marker once a secret exists: it is forgeable by anyone who can reach us", () => {
    // A deployment that chose a secret must not also accept a weaker proof.
    expect(ask({ secret: "s3cret", vercelCron: "1" })).toBe("unauthorized");
    expect(ask({ secret: "s3cret", vercelCron: "1", authorization: "Bearer s3cret" })).toBe("ok");
  });
});
