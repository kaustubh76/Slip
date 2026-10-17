import "@slip/ui/tokens.css";
import "@slip/ui/components.css";
import { CONTRAST_COOKIE, parseContrast, parseTheme, THEME_COOKIE } from "@slip/ui";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ContrastToggle } from "../components/ContrastToggle";
import { Shortcuts } from "../components/Shortcuts";
import { SlipRoot } from "../components/SlipRoot";
import { Tabs } from "../components/Tabs";
import { ThemeToggle } from "../components/ThemeToggle";
import { isDemo } from "../server/demo";
import { disclosure } from "../server/disclosure";
import { currentOwner } from "../server/owner";
import { SIMULATED_SERVICES } from "../server/runtime";
import { signOut } from "./actions/session";

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
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const moreContrast = parseContrast(jar.get(CONTRAST_COOKIE)?.value);
  const signedIn = (await currentOwner()) !== null;
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      {...(theme === null ? {} : { "data-slip-theme": theme })}
      {...(moreContrast ? { "data-slip-contrast": "more" } : {})}
    >
      <body className="slip-page">
        <SlipRoot>
          <header className="slip-masthead">
            <Tabs signedIn={signedIn} demo={isDemo()} />
            <div className="slip-masthead-right">
              <ThemeToggle initial={theme} />
              <ContrastToggle initial={moreContrast} />
              {signedIn ? <Shortcuts /> : null}
              {signedIn ? (
                <form action={signOut}>
                  <button type="submit" className="slip-link slip-meta">
                    Sign out
                  </button>
                </form>
              ) : null}
            </div>
          </header>
          <p className="slip-band">
            <span>{disclosure(SIMULATED_SERVICES)}</span>
          </p>
          <main className="slip-main">{children}</main>
        </SlipRoot>
      </body>
    </html>
  );
}
