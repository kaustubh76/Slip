import { SlipClientError } from "../data/client.js";
import { type LinkLike, PlainLink } from "./Link.js";

/**
 * The two states every read has besides the one anyone designs for: still arriving, and failed.
 *
 * They live in the kit because every class they use is the kit's, and because a host embedding
 * Slip needs them as much as this app does — a read over someone else's network fails in exactly
 * the same four ways. The link is the host's through `LinkLike`, as `Roll`'s and `HoldsTray`'s are,
 * so nothing here knows about a router.
 */

/** A slip still being read: its header is printed, its body is not yet ("feeding paper"). */
export function FeedingPaper({ label }: { label: string }) {
  return (
    <article className="slip-sheet" data-perforated="" aria-busy="true">
      <p className="slip-meta">{label}</p>
      <p className="slip-caption">Feeding paper…</p>
    </article>
  );
}

/** A read that failed, in plain words, with a way to try again — never a stack trace. */
export function ErrorSlip({
  what,
  error,
  onRetry,
  Link = PlainLink,
}: {
  what: string;
  error: Error | null;
  /** Offered only where trying again could help; a signed-out session never gets one. */
  onRetry?: () => void;
  Link?: LinkLike;
}) {
  if (error instanceof SlipClientError && error.kind === "signed-out") {
    return (
      <article className="slip-sheet" role="alert">
        <p className="slip-sentence slip-pen">Your session has ended.</p>
        <p>
          <Link href="/sign-in" className="slip-link">
            Sign in again →
          </Link>
        </p>
      </article>
    );
  }
  const reason =
    error instanceof SlipClientError && error.kind === "not-found"
      ? "it is not there, or it is not yours"
      : "Slip could not answer just now";
  return (
    <article className="slip-sheet" role="alert">
      <p className="slip-sentence slip-pen">
        Could not read {what}: {reason}.
      </p>
      {onRetry === undefined ? null : (
        <button type="button" className="slip-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </article>
  );
}
