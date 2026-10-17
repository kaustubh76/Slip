"use client";

/**
 * A page that failed to render: said plainly on a slip, with a way to try again — never a stack
 * trace. Rendering a page only reads, so nothing about money changed because of it.
 */
export default function PageError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <article className="slip-sheet" role="alert">
      <p className="slip-meta">This page did not print</p>
      <p className="slip-sentence slip-pen">Slip could not show this page just now.</p>
      <p className="slip-prose">
        Showing a page never moves money: every purchase, hold and payment is as it was.
      </p>
      {error.digest === undefined ? null : (
        <p className="slip-caption slip-mono">Reference {error.digest}</p>
      )}
      <div className="slip-dialog-actions">
        <button type="button" className="slip-button" onClick={retry}>
          Try again
        </button>
      </div>
    </article>
  );
}
