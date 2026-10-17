"use client";

import { CONTRAST_ATTRIBUTE, contrastCookie } from "@slip/ui";
import { useState } from "react";

/** "More contrast": faint ink and hairlines drawn at full strength, in either theme. */
export function ContrastToggle({ initial }: { initial: boolean }) {
  const [more, setMore] = useState(initial);
  const toggle = () => {
    const next = !more;
    if (next) {
      document.documentElement.setAttribute(CONTRAST_ATTRIBUTE, "more");
    } else {
      document.documentElement.removeAttribute(CONTRAST_ATTRIBUTE);
    }
    // biome-ignore lint/suspicious/noDocumentCookie: the server must read the choice on the next render
    document.cookie = contrastCookie(next);
    setMore(next);
  };
  return (
    <button type="button" className="slip-link slip-meta" aria-pressed={more} onClick={toggle}>
      More contrast
    </button>
  );
}
