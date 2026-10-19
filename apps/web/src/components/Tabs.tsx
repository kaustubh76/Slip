"use client";

import { useHolds } from "@slip/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/receipts", "Receipts"],
  ["/holds", "Holds"],
  ["/limits", "Limits"],
  ["/agents", "Agents"],
  ["/bench", "Bench"],
  ["/mandate", "Mandate"],
] as const;

/** The sections that need no session: the bench is evidence, and anyone may read it. */
const PUBLIC: ReadonlySet<string> = new Set(["/bench"]);

/**
 * The index tabs; the open one has its bottom rule cut, like a folder. Holds counts live.
 *
 * Signed out, only the sections that answer are shown. Every other one redirects straight back to
 * the way in, and a row of tabs that all land in the same place reads as a broken index.
 */
export function Tabs({ signedIn, demo = false }: { signedIn: boolean; demo?: boolean }) {
  const path = usePathname();
  const waiting = useHolds({ enabled: signedIn });
  const holds = waiting.data?.pending.length;
  const sections = signedIn ? TABS : TABS.filter(([href]) => PUBLIC.has(href));
  return (
    <nav className="slip-tabs" aria-label="Sections">
      <span className="slip-title" aria-hidden="true">
        Slip
      </span>
      {[...sections, ...(demo && signedIn ? ([["/demo", "Demo"]] as const) : [])].map(
        ([href, label]) => (
          <Link
            key={href}
            href={href}
            className="slip-tab"
            aria-current={
              // The simulated PayPal page lives under /demo but is not the console.
              path === href || (href !== "/demo" && path.startsWith(`${href}/`))
                ? "page"
                : undefined
            }
          >
            {label}
            {href === "/holds" && holds !== undefined && holds > 0 ? ` ${holds}` : ""}
          </Link>
        ),
      )}
    </nav>
  );
}
