import type { Metadata } from "next";
import type { ReactNode } from "react";

import { currentUser } from "@/lib/auth";
import { SignOutButton } from "./signout-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prediction Market",
  description: "A play-money prediction market. Points only — nothing here is worth money.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">
            Prediction Market
          </a>
          <nav>
            {user ? (
              <>
                <span className="balance">{user.balance.toLocaleString()} pts</span>
                <span className="handle">{user.handle ?? user.name}</span>
                {user.isAdmin && <span className="badge">admin</span>}
                <SignOutButton />
              </>
            ) : (
              <a href="/signin" className="button">
                Sign in
              </a>
            )}
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          Play money only. Points have no cash value and cannot be withdrawn or exchanged.
        </footer>
      </body>
    </html>
  );
}
