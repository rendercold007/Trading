import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

/**
 * Root layout — document shell only.
 *
 * Deliberately carries no header, nav or footer. Two very different surfaces
 * live under it: the marketing landing page at `/`, which has its own warm
 * theme and its own minimal header, and the app itself under `(app)`, which
 * has the signed-in chrome. Putting the app header here would force it onto
 * the landing page, where a Portfolio link and a second sign-in button make
 * no sense.
 */

export const metadata: Metadata = {
  title: "Outcome",
  description:
    "A play-money prediction market. Trade on what you think will happen — points only, no cash value.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
