import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DemoControls } from "../components/demo-controls";
import { readSession } from "../lib/session";
import "./styles.css";

export const metadata: Metadata = {
  title: "PathCompiler · Demo workspace",
  description: "Reference workflows for PathCompiler development.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await readSession();
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/clients" className="brand">
            PathCompiler <span> / demo</span>
          </Link>
          <nav aria-label="Main navigation">
            <Link href="/clients">Clients</Link>
            <Link href="/plans">Plans</Link>
          </nav>
        </header>
        <DemoControls
          key={`${session.role}:${session.featureFlags.planStructure}`}
          role={session.role}
          planStructure={session.featureFlags.planStructure}
        />
        <main>{children}</main>
        <footer>
          Local reference app · Fictional data only · Role controls simulate
          permissions
        </footer>
      </body>
    </html>
  );
}
