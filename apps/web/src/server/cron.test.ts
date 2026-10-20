import { describe, expect, it } from "vitest";
import { authoriseCron, cronSecrets } from "./cron";

/**
 * The resolver captures holds and voids authorizations, so this endpoint is a way to move money
 * from outside. Every case below is about who gets turned away.
 */

const ask = (over: Partial<Parameters<typeof authoriseCron>[0]> = {}) =>
  authoriseCron({ authorization: null, secrets: [], ...over });

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

  it("takes either name, because Vercel will only ever send one of them", () => {
    // Vercel injects a bearer token only for a variable named exactly CRON_SECRET. Preferring
    // Slip's own name is how a deployment that followed the docs 401s its own scheduler for ever
    // — so both are accepted, and both work on their own (D76).
    const env = (over: Record<string, string>) => over as unknown as NodeJS.ProcessEnv;
    expect(cronSecrets(env({ SLIP_CRON_SECRET: "ours" }))).toEqual(["ours"]);
    expect(cronSecrets(env({ CRON_SECRET: "theirs" }))).toEqual(["theirs"]);
    expect(cronSecrets(env({ SLIP_CRON_SECRET: "ours", CRON_SECRET: "theirs" }))).toEqual([
      "ours",
      "theirs",
    ]);
    expect(cronSecrets(env({}))).toEqual([]);
    // A blank value is no secret at all, rather than one that shadows the other name.
    expect(cronSecrets(env({ SLIP_CRON_SECRET: "  ", CRON_SECRET: "theirs" }))).toEqual(["theirs"]);
  });

  it("lets either configured secret through", () => {
    const both = { secrets: ["ours", "theirs"] as const };
    expect(authoriseCron({ ...both, authorization: "Bearer ours" })).toBe("ok");
    expect(authoriseCron({ ...both, authorization: "Bearer theirs" })).toBe("ok");
    expect(authoriseCron({ ...both, authorization: "Bearer neither" })).toBe("unauthorized");
  });

  it("the secret as a bearer token, with or without the word", () => {
    expect(ask({ secrets: ["s3cret"], authorization: "Bearer s3cret" })).toBe("ok");
    expect(ask({ secrets: ["s3cret"], authorization: "bearer s3cret" })).toBe("ok");
    expect(ask({ secrets: ["s3cret"], authorization: "s3cret" })).toBe("ok");
    expect(ask({ secrets: [" s3cret "], authorization: "Bearer s3cret" })).toBe("ok");
  });

  it("nobody with the wrong secret, a prefix of it, or none at all", () => {
    expect(ask({ secrets: ["s3cret"], authorization: "Bearer wrong" })).toBe("unauthorized");
    expect(ask({ secrets: ["s3cret"], authorization: "Bearer s3cre" })).toBe("unauthorized");
    expect(ask({ secrets: ["s3cret"], authorization: null })).toBe("unauthorized");
    expect(ask({ secrets: ["s3cret"], authorization: "Bearer " })).toBe("unauthorized");
  });

  it("a secret that exists is the only way through", () => {
    expect(ask({ secrets: ["s3cret"] })).toBe("unauthorized");
    expect(ask({ secrets: ["s3cret"], authorization: "Bearer s3cret" })).toBe("ok");
  });
});
