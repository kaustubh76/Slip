import { describe, expect, it } from "vitest";
import { authoriseCron, cronSecret } from "./cron";

/**
 * The resolver captures holds and voids authorizations, so this endpoint is a way to move money
 * from outside. Every case below is about who gets turned away.
 */

const ask = (over: Partial<Parameters<typeof authoriseCron>[0]> = {}) =>
  authoriseCron({ authorization: null, secret: undefined, ...over });

describe("who may run the resolver over HTTP", () => {
  it("nobody, until a secret is configured", () => {
    expect(ask()).toBe("unconfigured");
    expect(ask({ authorization: "Bearer anything" })).toBe("unconfigured");
  });

  it("a bearer token is the only proof; a header anyone can type is not one", () => {
    // `x-vercel-cron` used to open this endpoint whenever no secret was set. Anyone who can reach
    // the deployment can send that header, so it was an unauthenticated way to move money (D74).
    expect(ask({ authorization: "x-vercel-cron" })).toBe("unconfigured");
  });

  it("takes the secret under either name, so Vercel's own injected one works", () => {
    expect(cronSecret({ SLIP_CRON_SECRET: "ours" } as unknown as NodeJS.ProcessEnv)).toBe("ours");
    expect(cronSecret({ CRON_SECRET: "theirs" } as unknown as NodeJS.ProcessEnv)).toBe("theirs");
    expect(
      cronSecret({
        SLIP_CRON_SECRET: "ours",
        CRON_SECRET: "theirs",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("ours");
    expect(cronSecret({} as unknown as NodeJS.ProcessEnv)).toBeUndefined();
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

  it("a secret that exists is the only way through", () => {
    expect(ask({ secret: "s3cret" })).toBe("unauthorized");
    expect(ask({ secret: "s3cret", authorization: "Bearer s3cret" })).toBe("ok");
  });
});
