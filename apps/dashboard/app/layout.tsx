import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "PathCompiler · Control plane",
  description: "Review discovered and approved product workflows.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            PathCompiler <span>control plane</span>
          </Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
