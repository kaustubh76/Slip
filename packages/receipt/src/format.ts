/**
 * Times and ids as the receipt prints them. Always UTC, never the reader's locale, so the server
 * and the browser print the same characters.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `14:02 UTC` */
export function utcTime(date: Date): string {
  return `${date.toISOString().slice(11, 16)} UTC`;
}

/** `2026-10-13 14:02 UTC` */
export function utcDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 10)} ${utcTime(date)}`;
}

/** `13 Oct 14:02 UTC` — for a deadline the owner reads at a glance. */
export function utcDayTime(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${utcTime(date)}`;
}

/** `7c1e…a4f2` — enough of a receipt id to tell receipts apart on screen. */
export function shortNo(id: string): string {
  const hex = id.replaceAll("-", "");
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}
