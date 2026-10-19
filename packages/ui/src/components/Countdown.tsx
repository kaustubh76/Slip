import { DEFAULT_HOLD_TTL_MS } from "@slip/domain";
import { timeLeft } from "./time.js";

/**
 * How long is left to decide, drawn as well as written. The bar drains over the window a hold is
 * given, so a glance says whether this is today's problem or this minute's; the words beside it
 * carry the same thing for anyone who cannot see the bar, which is why the bar is hidden from
 * assistive tech rather than labelled.
 */
export function Countdown(props: {
  expiresAt: string;
  now: number;
  /** The whole window the bar drains over; a hold's 48 hours unless the host says otherwise. */
  windowMs?: number;
}) {
  const left = new Date(props.expiresAt).getTime() - props.now;
  const windowMs = props.windowMs ?? DEFAULT_HOLD_TTL_MS;
  const part = Math.max(0, Math.min(1, left / windowMs));
  const spent = part === 0;
  return (
    <p className="slip-countdown" data-spent={spent ? "" : undefined}>
      <span className="slip-countdown-track" aria-hidden="true">
        <span
          className="slip-countdown-bar"
          style={{ inlineSize: `${(part * 100).toFixed(1)}%` }}
        />
      </span>
      <span className="slip-countdown-words">
        {spent ? "Out of time; releasing it" : `${timeLeft(props.expiresAt, props.now)} to decide`}
      </span>
    </p>
  );
}
