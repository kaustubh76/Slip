import { ConflictError, InvariantError, SlipError } from "@slip/domain";
import { UNIQUE_CONSTRAINT_CODES } from "../codes.js";

interface PgErrorLike {
  code: string;
  message: string;
  constraint: string | undefined;
}

/**
 * Drizzle wraps driver errors in `DrizzleQueryError` with the driver error as `cause`;
 * postgres.js puts the constraint in `constraint_name`, PGlite in `constraint`. Walk the chain
 * and normalise.
 */
function findPgError(error: unknown): PgErrorLike | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
    };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      const constraint =
        typeof candidate.constraint_name === "string"
          ? candidate.constraint_name
          : typeof candidate.constraint === "string"
            ? candidate.constraint
            : undefined;
      return { code: candidate.code, message: candidate.message, constraint };
    }
    current = candidate.cause;
  }
  return null;
}

/**
 * Turns a database error into the domain error the `Store` contract promises. Errors that are
 * already domain errors pass through; anything unrecognised (connection loss, timeouts) is
 * returned unchanged so it surfaces as what it is.
 */
export function translateDbError(error: unknown): unknown {
  if (error instanceof SlipError) {
    return error;
  }
  const pg = findPgError(error);
  if (pg === null) {
    return error;
  }
  switch (pg.code) {
    case "23505": {
      const code = (pg.constraint && UNIQUE_CONSTRAINT_CODES[pg.constraint]) || "UNIQUE_VIOLATION";
      return new ConflictError(code, `${code}: ${pg.message}`, { cause: error });
    }
    case "23503":
      return new InvariantError(
        `refers to a row that does not exist (${pg.constraint ?? "foreign key"})`,
        {
          cause: error,
        },
      );
    case "23514":
    case "23001":
    case "23502":
    case "22P02":
    case "22003":
      return new InvariantError(pg.message, { cause: error });
    default:
      return error;
  }
}

/** Runs a store operation and translates whatever it throws. */
export async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translateDbError(error);
  }
}
