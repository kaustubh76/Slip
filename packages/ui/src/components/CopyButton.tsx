"use client";

import { useEffect, useState } from "react";

type Said = "" | "copied" | "not copied";

/**
 * Copies one value: an id the owner will paste somewhere else, such as into PayPal's own
 * dashboard. Where the browser has no clipboard or refuses the write, it says "not copied" rather
 * than claiming otherwise — the value beside it stays selectable, which is how every other secret
 * in Slip is copied today. What happened is announced, because a button whose only effect is
 * elsewhere tells a reader nothing by itself.
 */
export function CopyButton(props: { value: string; label: string }) {
  const [said, setSaid] = useState<Said>("");

  // The word fades on its own; a row of ids would otherwise end up saying "copied" several times.
  useEffect(() => {
    if (said === "") {
      return;
    }
    const timer = setTimeout(() => setSaid(""), 4_000);
    return () => clearTimeout(timer);
  }, [said]);

  const copy = (): void => {
    const writing = navigator.clipboard?.writeText(props.value);
    if (writing === undefined) {
      setSaid("not copied");
      return;
    }
    void writing.then(
      () => setSaid("copied"),
      () => setSaid("not copied"),
    );
  };

  return (
    <>
      <button
        type="button"
        className="slip-link slip-copy"
        onClick={copy}
        aria-label={`Copy ${props.label}`}
      >
        copy
      </button>
      <span className="slip-copied slip-pen" role="status">
        {said}
      </span>
    </>
  );
}
