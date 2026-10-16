import "@slip/ui/tokens.css";
import "@slip/ui/components.css";
import { parseTheme, THEME_COOKIE } from "@slip/ui";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Tabs } from "../components/Tabs";
import { ThemeToggle } from "../components/ThemeToggle";

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
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      {...(theme === null ? {} : { "data-slip-theme": theme })}
    >
      <body className="slip-page">
        <header className="slip-masthead">
          <Tabs />
          <ThemeToggle initial={theme} />
        </header>
        <p className="slip-band">
          <span>
            Demo runs in PayPal sandbox. Slip is the seller. No real money moves; no order reaches a
            retailer.
          </span>
        </p>
        <main className="slip-main">{children}</main>
      </body>
    </html>
  );
}
