"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Keeps the page up to date while the owner watches it: it asks how much has happened (one short
 * token), and when that changes it re-reads the page from the server. Nothing is guessed on the
 * client — the roll, the tray and the receipts always show what the server rendered.
 *
 * It stops while the tab is hidden, because an unwatched tab has nothing to show.
 */
export function LiveUpdates({
  initialToken,
  everyMs = 2_000,
}: {
  initialToken: string;
  everyMs?: number;
}) {
  const router = useRouter();
  const token = useRef(initialToken);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped || document.hidden) {
        return;
      }
      try {
        const response = await fetch("/api/v1/stamp", { cache: "no-store" });
        if (!response.ok) {
          setReachable(response.status !== 401);
          return;
        }
        setReachable(true);
        const { token: latest } = (await response.json()) as { token: string };
        if (latest !== token.current) {
          token.current = latest;
          router.refresh();
        }
      } catch {
        // Offline, or the server restarted: say so quietly and keep trying.
        setReachable(false);
      }
    };

    const loop = () => {
      timer = setTimeout(async () => {
        await tick();
        if (!stopped) {
          loop();
        }
      }, everyMs);
    };
    loop();

    const onVisible = () => {
      if (!document.hidden) {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs, router]);

  return (
    <p className="slip-live slip-meta" aria-live="polite">
      {reachable ? "live" : "not connected"}
    </p>
  );
}
