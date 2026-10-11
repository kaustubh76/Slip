/** Base class for every error Slip raises on purpose. `code` is stable and machine-readable. */
export class SlipError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidMoneyError extends SlipError {
  constructor(message: string) {
    super("INVALID_MONEY", message);
  }
}

export class InvalidIdError extends SlipError {
  constructor(message: string) {
    super("INVALID_ID", message);
  }
}

/** Two sources genuinely disagree about a status (not a repeat, not a stale report). */
export class IllegalTransitionError extends SlipError {
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
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} not found: ${id}`);
  }
}

/** A uniqueness or set-once rule was hit: the row already exists or a field is already set. */
export class ConflictError extends SlipError {}

/** A write would break a rule the store guarantees (outcome ↔ payment, append-only, bounds). */
export class InvariantError extends SlipError {
  constructor(message: string, options?: ErrorOptions) {
    super("INVARIANT", message, options);
  }
}

/** The checkout lease expired or was taken over; nothing was written. */
export class LeaseLostError extends SlipError {
  constructor(key: string) {
    super("LEASE_LOST", `checkout lease for ${key} is not held by this caller`);
  }
}

export class MandateNotActiveError extends SlipError {
  constructor(id: string, status: string) {
    super("MANDATE_NOT_ACTIVE", `mandate ${id} is ${status}`);
  }
}

/** The owner changed the limits after the check ran; the check must run again. */
export class PolicyChangedError extends SlipError {
  constructor(checkedVersion: number, currentVersion: number) {
    super(
      "POLICY_CHANGED",
      `checked under policy v${checkedVersion}, current is v${currentVersion}`,
    );
  }
}

export class HoldAlreadyDecidedError extends SlipError {
  constructor(id: string, status: string) {
    super("HOLD_ALREADY_DECIDED", `hold ${id} is already ${status}`);
  }
}

export class HoldExpiredError extends SlipError {
  constructor(id: string) {
    super("HOLD_EXPIRED", `hold ${id} has expired`);
  }
}

/** The authorization behind the hold is not confirmed yet; approve again shortly. */
export class HoldNotReadyError extends SlipError {
  constructor(id: string, paymentStatus: string) {
    super("HOLD_NOT_READY", `hold ${id} cannot be approved while its payment is ${paymentStatus}`);
  }
}
