import type { StateLine } from "@slip/receipt";

const WORDS: Partial<Record<StateLine["word"], string>> = { NONE: "NO ORDER" };

/**
 * Where the money stands, typed like a till: glyph, status word, plain words. A line PayPal is
 * still working on is announced politely when it changes; with `announce` it always is, so the
 * final word (CAPTURED, VOIDED) is read out too — for the one receipt a page is about.
 */
export function StatusLine({ state, announce = false }: { state: StateLine; announce?: boolean }) {
  return (
    <p
      className="slip-status"
      data-in-flight={state.inFlight ? "" : undefined}
      aria-live={announce || state.inFlight ? "polite" : undefined}
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
