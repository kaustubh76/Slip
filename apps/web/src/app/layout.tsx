import "@slip/ui/tokens.css";
import "@slip/ui/components.css";
import { pendingHolds } from "@slip/app";
import { parseTheme, THEME_COOKIE } from "@slip/ui";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LiveUpdates } from "../components/LiveUpdates";
import { Tabs } from "../components/Tabs";
import { ThemeToggle } from "../components/ThemeToggle";
import { disclosure } from "../server/disclosure";
import { stampTokenFor } from "../server/live";
import { currentOwner } from "../server/owner";
import { SIMULATED_SERVICES } from "../server/runtime";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--slip-plex-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--slip-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Slip",
  description: "Every purchase your agent tries, checked before PayPal moves the money.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const owner = await currentOwner();
  const [waiting, stamp] =
    owner === null
      ? [null, null]
      : await Promise.all([
          pendingHolds(owner.deps, owner.ownerId, owner.mandateId),
          stampTokenFor(owner.deps, owner.mandateId),
        ]);
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      {...(theme === null ? {} : { "data-slip-theme": theme })}
    >
      <body className="slip-page">
        <header className="slip-masthead">
          <Tabs {...(waiting === null ? {} : { holds: waiting.length })} />
          <div className="slip-masthead-right">
            {stamp === null ? null : <LiveUpdates initialToken={stamp} />}
            <ThemeToggle initial={theme} />
          </div>
        </header>
        <p className="slip-band">
          <span>{disclosure(SIMULATED_SERVICES)}</span>
        </p>
        <main className="slip-main">{children}</main>
      </body>
    </html>
  );
}
