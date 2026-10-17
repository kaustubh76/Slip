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

/** The index tabs; the open one has its bottom rule cut, like a folder. Holds counts live. */
export function Tabs({ signedIn, demo = false }: { signedIn: boolean; demo?: boolean }) {
  const path = usePathname();
  const waiting = useHolds({ enabled: signedIn });
  const holds = waiting.data?.pending.length;
  return (
    <nav className="slip-tabs" aria-label="Sections">
      <span className="slip-title" aria-hidden="true">
        Slip
      </span>
      {[...TABS, ...(demo && signedIn ? ([["/demo", "Demo"]] as const) : [])].map(
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
