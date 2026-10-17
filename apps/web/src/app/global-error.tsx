"use client";

import "@slip/ui/tokens.css";
import "@slip/ui/components.css";

/**
 * The last resort, when even the frame around every page failed: it replaces the root layout, so
 * it brings its own document and styles. The same slip as a page error, nothing more.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="slip-page">
        <title>Slip</title>
        <main className="slip-main">
          <article className="slip-sheet" role="alert">
            <p className="slip-meta">Slip did not print</p>
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
        </main>
      </body>
    </html>
  );
}
