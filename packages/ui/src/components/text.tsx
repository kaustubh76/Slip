import type { ReactNode } from "react";

const AMOUNT = /(\$[\d,]+\.\d{2})/;

/** A printed sentence with its dollar amounts set in the heavier weight. */
export function withAmounts(text: string): ReactNode[] {
  return text.split(AMOUNT).map((part, i) =>
    i % 2 === 1 ? (
      <span key={`${i}-${part}`} className="slip-amount">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `11 Oct 2026 14:02 UTC` from an ISO time; always UTC, so server and browser agree. */
export function printedAt(iso: string): string {
  const date = new Date(iso);
  const time = iso.slice(11, 16);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${time} UTC`;
}

/** `14:02` from an ISO time. */
export function clockTime(iso: string): string {
  return iso.slice(11, 16);
}
