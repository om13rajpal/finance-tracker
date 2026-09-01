import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import "./globals.css";
import { Providers } from "./providers";

/**
 * The typefaces, actually loaded.
 *
 * tokens.css declares `@font-face { src: local('Bricolage Grotesque') }` and
 * nothing else — which resolves only if the font happens to be installed on the
 * machine, and silently falls back to a system grotesk everywhere else. Geist
 * and Geist Mono had no @font-face at all. So until now the product had been
 * rendering in fallbacks, not in its own type.
 *
 * These are self-hosted at build time: no runtime request, no layout shift, and
 * `display: swap` so text is never invisible while loading.
 *
 * Geist comes from Vercel's own `geist` package rather than next/font/google —
 * Next 14.2's bundled Google Fonts manifest predates Geist's arrival there, so
 * `next/font/google` rejects it as an unknown font.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sorted — every rupee in one of four buckets",
  description:
    "A private finance tracker for one person. Net worth, investments with FIFO cost basis, budgets, goals and tax — and it reads your bank emails so you don't have to type anything in.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
