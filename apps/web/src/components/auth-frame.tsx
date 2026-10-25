import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./logo";

export function AuthFrame({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", gridTemplateRows: "auto 1fr auto", padding: "0 16px" }}>
      <header style={{ maxWidth: 1160, width: "100%", margin: "0 auto", height: 64, display: "flex", alignItems: "center" }}>
        <Link href="/" aria-label="BlindCount home" style={{ textDecoration: "none" }}>
          <Logo />
        </Link>
      </header>
      <main id="main" style={{ display: "grid", placeItems: "center", padding: "24px 0 64px" }}>
        <div className="panel" style={{ width: "min(440px, 100%)", padding: 32, display: "grid", gap: 22 }}>
          <div className="stack-sm">
            <h1 style={{ fontSize: 26 }}>{title}</h1>
            {description ? <p className="muted">{description}</p> : null}
          </div>
          {children}
        </div>
      </main>
      <footer style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-3)", padding: "20px 0" }}>
        <Link href="/privacy" style={{ color: "inherit" }}>Privacy</Link> · <Link href="/terms" style={{ color: "inherit" }}>Terms</Link> · Prototype system
      </footer>
    </div>
  );
}
