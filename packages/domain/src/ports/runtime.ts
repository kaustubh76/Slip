/**
 * Time, identity and logging, injected so the application has no hidden globals: tests drive a
 * manual clock (no fake timers, which fight with database drivers) and get deterministic ids.
 */

export interface Clock {
  now(): Date;
  /**
   * Resolves `true` after `ms` milliseconds of this clock's time, or `false` as soon as `signal`
   * aborts. Never rejects, so a cancelled deadline leaves nothing unhandled.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<boolean>;
}

export interface IdSource {
  /** A new UUID. */
  uuid(): string;
}

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  /** Something a human must look at (a contradiction from PayPal, a payment that cannot settle). */
  error(event: string, fields?: LogFields): void;
}
