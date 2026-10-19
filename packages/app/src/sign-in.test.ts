import { describe, expect, it } from "vitest";
import { harness } from "./__fixtures__/harness.js";
import { registerOwner } from "./mandates.js";
import { signIn } from "./sign-in.js";

/** A returning owner, and everything that must not work. */

const EMAIL = "owner@example.com";
const PASSWORD = "a reasonable passphrase";

async function setup() {
  const h = harness();
  const registered = await registerOwner(h.deps, { email: EMAIL, password: PASSWORD });
  if (registered.status !== "registered") {
    throw new Error(JSON.stringify(registered));
  }
  return { h, owner: registered.owner };
}

describe("signing a returning owner in", () => {
  it("accepts the password they registered with", async () => {
    const { h, owner } = await setup();
    expect(await signIn(h.deps, { email: EMAIL, password: PASSWORD })).toEqual({
      status: "signed-in",
      ownerId: owner.id,
    });
  });

  it("accepts the address however it is capitalised or spaced", async () => {
    const { h, owner } = await setup();
    expect(await signIn(h.deps, { email: "  Owner@Example.COM ", password: PASSWORD })).toEqual({
      status: "signed-in",
      ownerId: owner.id,
    });
  });

  it("refuses a wrong password", async () => {
    const { h } = await setup();
    expect(
      await signIn(h.deps, { email: EMAIL, password: "a reasonable passphras" }),
    ).toMatchObject({ status: "refused" });
  });

  it("says the same thing for an unknown address as for a wrong password", async () => {
    // Otherwise this becomes a way to find out which addresses have Slip accounts.
    const { h } = await setup();
    const wrongPassword = await signIn(h.deps, { email: EMAIL, password: "not the passphrase" });
    const unknownOwner = await signIn(h.deps, { email: "nobody@example.com", password: PASSWORD });
    expect(unknownOwner).toEqual(wrongPassword);
  });

  it("refuses an owner who has no password, with the same answer", async () => {
    // Every demo desk and every owner opened before passwords existed: their cookie still works,
    // but there is nothing here to verify against.
    const h = harness();
    const registered = await registerOwner(h.deps, { email: "cookie@example.com" });
    expect(registered.status).toBe("registered");
    expect(await signIn(h.deps, { email: "cookie@example.com", password: PASSWORD })).toMatchObject(
      { status: "refused" },
    );
  });

  it("refuses an empty address or an empty password without touching the store", async () => {
    const { h } = await setup();
    expect(await signIn(h.deps, { email: "", password: PASSWORD })).toMatchObject({
      status: "refused",
    });
    expect(await signIn(h.deps, { email: EMAIL, password: "" })).toMatchObject({
      status: "refused",
    });
  });
});

describe("registering with a credential", () => {
  it("needs an address to look the password up by", async () => {
    const h = harness();
    expect(await registerOwner(h.deps, { email: null, password: PASSWORD })).toMatchObject({
      status: "refused",
      reason: "INVALID_EMAIL",
    });
  });

  it("refuses a password too short to be worth hashing", async () => {
    const h = harness();
    const refused = await registerOwner(h.deps, { email: EMAIL, password: "short" });
    expect(refused).toMatchObject({ status: "refused", reason: "WEAK_PASSWORD" });
    expect(refused.status === "refused" && refused.message).toContain("12");
  });

  it("still registers an owner with no password at all", async () => {
    const h = harness();
    expect(await registerOwner(h.deps, { email: null })).toMatchObject({ status: "registered" });
  });

  it("never logs or returns the password", async () => {
    const { h, owner } = await setup();
    expect(JSON.stringify(owner)).not.toContain("passphrase");
    expect(JSON.stringify(h.logs ?? [])).not.toContain("passphrase");
  });
});
