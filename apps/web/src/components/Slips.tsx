import { SlipClientError } from "@slip/ui";
import Link from "next/link";

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
}: {
  what: string;
  error: Error | null;
  onRetry?: () => void;
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
