import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import styles from "./public-shell.module.css";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/research", label: "Research" },
  { href: "/verify", label: "Verify a packet" },
  { href: "/demo", label: "Demo" },
];

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" aria-label="BlindCount home" className={styles.brand}>
            <Logo />
          </Link>
          <nav aria-label="Primary" className={styles.nav}>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className={styles.actions}>
            <Link href="/sign-in" className="btn btn-ghost">
              Sign in
            </Link>
            <Link href="/demo" className="btn btn-primary">
              View live demo
            </Link>
          </div>
        </div>
      </header>
      <main id="main" className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footInner}>
          <div className={styles.footBrand}>
            <Logo />
            <p className="muted">Sealed records prove what was submitted. They do not prove a count was true.</p>
            <p className="subtle" style={{ fontSize: 13 }}>
              Prototype system. Simulated farm scenarios. Real testnet verification.
            </p>
          </div>
          <div className={styles.footCols}>
            <div>
              <h4>Product</h4>
              <Link href="/#how">How it works</Link>
              <Link href="/demo">Live demo</Link>
              <Link href="/verify">Verify a packet</Link>
              <Link href="/sign-in">Sign in</Link>
            </div>
            <div>
              <h4>Evidence</h4>
              <Link href="/research">Research context</Link>
              <a href="https://doi.org/10.5061/dryad.v9s4mw77q" rel="noreferrer" target="_blank">
                Study dataset (Dryad)
              </a>
              <Link href="/status">System status</Link>
            </div>
            <div>
              <h4>Policies</h4>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </div>
          </div>
        </div>
        <div className={styles.footBase}>
          <span>BlindCount is a working name, built for the IEEE ClimateChain Hackathon 2026.</span>
          <span>No certification is implied.</span>
        </div>
      </footer>
    </div>
  );
}
