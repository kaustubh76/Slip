/**
 * Every error Slip raises on purpose. Callers branch on them with `instanceof`, and that has to
 * keep working when the same package is loaded twice: Next.js bundles its pages and its route
 * handlers into separate server graphs, each with its own copy of these classes, while the store
 * they share was built by whichever graph ran first. So each class names itself with an explicit
 * `kind` (a string, because a minifier may rename the class), every error records the kinds of its
 * whole class chain under a `Symbol.for` key that all copies share, and `instanceof` checks that
 * record instead of the prototype chain (D45).
 */
const KINDS = Symbol.for("slip.error.kinds");

type Branded = { [KINDS]?: unknown };

/** Base class for every error Slip raises on purpose. `code` is stable and machine-readable. */
export class SlipError extends Error {
  /** The class's stable name; each subclass declares its own. */
  static readonly kind: string = "SlipError";

  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = ownKind(new.target) ?? new.target.name;
    this.code = code;
    Object.defineProperty(this, KINDS, { value: kindsOf(new.target), enumerable: false });
  }

  /**
   * `error instanceof HoldExpiredError` is true for a `HoldExpiredError` made by any copy of this
   * module. A class without its own `kind` falls back to the ordinary prototype check rather than
   * answering for its parent.
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value === "object" && value !== null) {
      const kinds = (value as Branded)[KINDS];
      // biome-ignore lint/complexity/noThisInStatic: `this` is the class on the right of `instanceof`, a subclass included.
      const kind = ownKind(this);
      if (Array.isArray(kinds) && kind !== null) {
        return kinds.includes(kind);
      }
    }
    // biome-ignore lint/complexity/noThisInStatic: the ordinary check, against the class actually asked about.
    return Function.prototype[Symbol.hasInstance].call(this, value);
  }
}

function ownKind(ctor: object): string | null {
  const kind: unknown = Object.hasOwn(ctor, "kind") ? (ctor as { kind: unknown }).kind : null;
  return typeof kind === "string" ? kind : null;
}

/** The kinds of a class and every Slip class above it, most specific first. */
function kindsOf(ctor: object): readonly string[] {
  const kinds: string[] = [];
  for (let c: object | null = ctor; c !== null && c !== Error; c = Object.getPrototypeOf(c)) {
    const kind = ownKind(c);
    if (kind !== null) {
      kinds.push(kind);
    }
  }
  return Object.freeze(kinds);
}

export class InvalidMoneyError extends SlipError {
  static override readonly kind: string = "InvalidMoneyError";

  constructor(message: string) {
    super("INVALID_MONEY", message);
  }
}

export class InvalidIdError extends SlipError {
  static override readonly kind: string = "InvalidIdError";

  constructor(message: string) {
    super("INVALID_ID", message);
  }
}

/** Two sources genuinely disagree about a status (not a repeat, not a stale report). */
export class IllegalTransitionError extends SlipError {
  static override readonly kind: string = "IllegalTransitionError";

  readonly entity: string;
  readonly from: string;
  readonly to: string;

  constructor(entity: string, from: string, to: string) {
    super("ILLEGAL_TRANSITION", `${entity} status cannot move from ${from} to ${to}`);
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

export class NotFoundError extends SlipError {
  static override readonly kind: string = "NotFoundError";

  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} not found: ${id}`);
  }
}

/** A uniqueness or set-once rule was hit: the row already exists or a field is already set. */
export class ConflictError extends SlipError {
  static override readonly kind: string = "ConflictError";
}

/** A write would break a rule the store guarantees (outcome ↔ payment, append-only, bounds). */
export class InvariantError extends SlipError {
  static override readonly kind: string = "InvariantError";

  constructor(message: string, options?: ErrorOptions) {
    super("INVARIANT", message, options);
  }
}

/** The checkout lease expired or was taken over; nothing was written. */
export class LeaseLostError extends SlipError {
  static override readonly kind: string = "LeaseLostError";

  constructor(key: string) {
    super("LEASE_LOST", `checkout lease for ${key} is not held by this caller`);
  }
}

export class MandateNotActiveError extends SlipError {
  static override readonly kind: string = "MandateNotActiveError";

  constructor(id: string, status: string) {
    super("MANDATE_NOT_ACTIVE", `mandate ${id} is ${status}`);
  }
}

/** The owner changed the limits after the check ran; the check must run again. */
export class PolicyChangedError extends SlipError {
  static override readonly kind: string = "PolicyChangedError";

  constructor(checkedVersion: number, currentVersion: number) {
    super(
      "POLICY_CHANGED",
      `checked under policy v${checkedVersion}, current is v${currentVersion}`,
    );
  }
}

export class HoldAlreadyDecidedError extends SlipError {
  static override readonly kind: string = "HoldAlreadyDecidedError";

  constructor(id: string, status: string) {
    super("HOLD_ALREADY_DECIDED", `hold ${id} is already ${status}`);
  }
}

export class HoldExpiredError extends SlipError {
  static override readonly kind: string = "HoldExpiredError";

  constructor(id: string) {
    super("HOLD_EXPIRED", `hold ${id} has expired`);
  }
}

/** The authorization behind the hold is not confirmed yet; approve again shortly. */
export class HoldNotReadyError extends SlipError {
  static override readonly kind: string = "HoldNotReadyError";

  constructor(id: string, paymentStatus: string) {
    super("HOLD_NOT_READY", `hold ${id} cannot be approved while its payment is ${paymentStatus}`);
  }
}
