"use client";

import { useClock } from "../data/clock.js";
import { useLive } from "../data/live.js";

/**
 * Keeps the page current and says, in words, how current it is: "live · 2s ago", "offline ·
 * reconnecting", "signed out". Put one on a page, inside the `SlipProvider`.
 */
export function LiveBadge(props: { initialToken?: string | null; everyMs?: number }) {
  const live = useLive({
    ...(props.initialToken === undefined ? {} : { initialToken: props.initialToken }),
    ...(props.everyMs === undefined ? {} : { everyMs: props.everyMs }),
  });
  const now = useClock(1_000);
  const ago =
    live.lastChangeAt === null ? null : Math.max(0, Math.round((now - live.lastChangeAt) / 1_000));
  const words =
    live.mode === "signed-out"
      ? "signed out"
      : live.mode === "offline"
        ? "offline · reconnecting"
        : ago === null
          ? "live"
          : ago < 60
            ? `live · ${ago}s ago`
            : "live";
  return (
    <p className="slip-live slip-meta" data-mode={live.mode} aria-live="polite">
      {words}
    </p>
  );
}
