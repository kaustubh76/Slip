import { describe, expect, it } from "vitest";
import * as errors from "./errors.js";

type ErrorClass = typeof errors.SlipError;

const classes = Object.entries(errors).filter(
  (entry): entry is [string, ErrorClass] =>
    typeof entry[1] === "function" && entry[1].prototype instanceof Error,
);

/** One instance of each class, built through its own constructor. */
function sample(module: typeof errors, name: string): errors.SlipError {
  switch (name) {
    case "SlipError":
      return new module.SlipError("SOME_CODE", "something");
    case "ConflictError":
      return new module.ConflictError("ROW_EXISTS", "the row exists");
    case "IllegalTransitionError":
      return new module.IllegalTransitionError("payment", "CAPTURED", "FAILED");
    case "NotFoundError":
      return new module.NotFoundError("hold", "x");
    case "MandateNotActiveError":
      return new module.MandateNotActiveError("m", "REVOKED");
    case "PolicyChangedError":
      return new module.PolicyChangedError(1, 2);
    case "HoldAlreadyDecidedError":
      return new module.HoldAlreadyDecidedError("h", "APPROVED");
    case "HoldNotReadyError":
      return new module.HoldNotReadyError("h", "INITIATED");
    default: {
      const Ctor = (module as unknown as Record<string, new (message: string) => errors.SlipError>)[
        name
      ];
      if (Ctor === undefined) {
        throw new Error(`no class ${name}`);
      }
      return new Ctor("message");
    }
  }
}

describe("Slip errors", () => {
  it("every class names itself, and its errors carry that name", () => {
    expect(classes.length).toBeGreaterThanOrEqual(13);
    for (const [name, Ctor] of classes) {
      expect(Object.hasOwn(Ctor, "kind"), `${name} declares its own kind`).toBe(true);
      expect(Ctor.kind).toBe(name);
      const error = sample(errors, name);
      expect(error.name).toBe(name);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(errors.SlipError);
      expect(error).toBeInstanceOf(Ctor);
    }
  });

  it("an error is an instance of its own class and its parents, never of a sibling", () => {
    const expired = new errors.HoldExpiredError("h");
    expect(expired instanceof errors.HoldExpiredError).toBe(true);
    expect(expired instanceof errors.SlipError).toBe(true);
    expect(expired instanceof errors.HoldNotReadyError).toBe(false);
    expect(expired instanceof errors.ConflictError).toBe(false);
    expect(new errors.SlipError("X", "x") instanceof errors.ConflictError).toBe(false);
    expect(new Error("plain") instanceof errors.SlipError).toBe(false);
    expect((null as unknown) instanceof errors.SlipError).toBe(false);
    expect(("HoldExpiredError" as unknown) instanceof errors.HoldExpiredError).toBe(false);
  });

  it("is recognised across two copies of this module, both ways", async () => {
    // Next.js bundles pages and route handlers separately, so one process holds two copies of
    // these classes; the query string makes Vite load a second, separate instance of the module.
    const path = "./errors.ts?copy";
    const copy = (await import(/* @vite-ignore */ path)) as typeof errors;
    expect(copy.SlipError).not.toBe(errors.SlipError);
    for (const [name, Ctor] of classes) {
      const Other = (copy as unknown as Record<string, ErrorClass>)[name];
      if (Other === undefined) {
        throw new Error(`the copy has no ${name}`);
      }
      const fromCopy = sample(copy, name);
      const fromHere = sample(errors, name);
      expect(fromCopy instanceof Ctor, `${name} from the copy`).toBe(true);
      expect(fromHere instanceof Other, `${name} into the copy`).toBe(true);
      expect(fromCopy instanceof errors.SlipError).toBe(true);
    }
    const foreign = new copy.LeaseLostError("agent/product");
    expect(foreign instanceof errors.LeaseLostError).toBe(true);
    expect(foreign instanceof errors.MandateNotActiveError).toBe(false);
    expect(foreign.code).toBe("LEASE_LOST");
  });

  it("a class that forgot its own kind does not answer for its parent", () => {
    class Unnamed extends errors.ConflictError {}
    const conflict = new errors.ConflictError("X", "x");
    expect(conflict instanceof Unnamed).toBe(false);
    expect(new Unnamed("Y", "y") instanceof Unnamed).toBe(true);
    expect(new Unnamed("Y", "y") instanceof errors.ConflictError).toBe(true);
  });
});
