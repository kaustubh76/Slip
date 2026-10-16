import type { StateLine } from "@slip/receipt";

const WORDS: Partial<Record<StateLine["word"], string>> = { NONE: "NO ORDER" };

/**
 * Where the money stands, typed like a till: glyph, status word, plain words. A line PayPal is
 * still working on is announced politely when it changes.
 */
export function StatusLine({ state }: { state: StateLine }) {
  return (
    <p
      className="slip-status"
      data-in-flight={state.inFlight ? "" : undefined}
      aria-live={state.inFlight ? "polite" : undefined}
    >
      {state.glyph === null ? null : <span aria-hidden="true">{state.glyph} </span>}
      <span className="slip-status-word" key={state.word}>
        {WORDS[state.word] ?? state.word}
      </span>
      <span aria-hidden="true"> · </span>
      <span className="slip-status-text">{state.text}</span>
    </p>
  );
}
