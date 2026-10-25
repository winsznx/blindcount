"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, FileCheck2, FolderKanban, KeyRound, LayoutGrid, LogOut, MapPin, Menu, Settings, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { api, ApiFailure, get, type ChainConfig, type Role } from "@/lib/api";
import { Logo } from "./logo";
import { FieldSync } from "./field-sync";
import { has, useMe } from "./use-me";
import styles from "./app-shell.module.css";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  roles: Role[];
}

function navFor(org: string): NavItem[] {
  const base = `/app/${org}`;
  return [
    { href: `${base}/overview`, label: "Overview", icon: LayoutGrid, roles: ["OWNER", "MANAGER", "REVIEWER", "CUSTODIAN"] },
    { href: `${base}/visits`, label: "My visits", icon: MapPin, roles: ["AUDITOR"] },
    { href: `${base}/programmes`, label: "Programmes", icon: FolderKanban, roles: ["OWNER", "MANAGER", "REVIEWER", "CUSTODIAN"] },
    { href: `${base}/reviews`, label: "Review desk", icon: ClipboardList, roles: ["REVIEWER", "MANAGER"] },
    { href: `${base}/reports`, label: "Reports", icon: FileCheck2, roles: ["OWNER", "MANAGER", "REVIEWER"] },
    { href: `${base}/settings/members`, label: "Members", icon: Users, roles: ["OWNER", "MANAGER"] },
    { href: `${base}/settings/devices`, label: "Devices", icon: KeyRound, roles: ["OWNER", "MANAGER", "AUDITOR", "REVIEWER", "CUSTODIAN"] },
    { href: `${base}/settings/security`, label: "Security", icon: Settings, roles: ["OWNER", "MANAGER"] },
  ];
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

export function AppShell({ org, children }: { org: string; children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const online = useOnline();
  const chain = useQuery({ queryKey: ["chain-config"], queryFn: () => get<ChainConfig>("/v1/system/chain-config"), staleTime: 60_000 });
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const unauthenticated = me.error instanceof ApiFailure && me.error.status === 401;
  const membership = me.data?.memberships.find((m) => m.organization.id === org);
  // Redirects are navigation side effects driven by the session query result.
  useEffect(() => {
    if (unauthenticated) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    else if (me.data && !membership) router.replace("/app");
  }, [unauthenticated, me.data, membership, router, pathname]);

  // Only when there is no session at all: a failed background refresh while offline must never unmount work in progress.
  if (me.error && !me.data && !unauthenticated) {
    return (
      <div className={styles.loading} role="alert">
        <div className="stack" style={{ justifyItems: "center", textAlign: "center", padding: 16 }}>
          <Logo />
          <p className="muted">Can&apos;t reach BlindCount. Anything you finalized on this device is safe and uploads when you&apos;re back online.</p>
          <button className="btn btn-secondary" onClick={() => me.refetch()}>Try again</button>
        </div>
      </div>
    );
  }
  if (me.isLoading || !membership) {
    return (
      <div className={styles.loading} aria-busy="true">
        <Logo />
      </div>
    );
  }
  const roles = membership.roles;
  const items = navFor(org).filter((i) => has(roles, ...i.roles));
  const isFieldOnly = roles.every((r) => r === "AUDITOR");
  const bottomItems = isFieldOnly ? items.filter((i) => i.label === "My visits" || i.label === "Devices") : items.slice(0, 3);
  const env = chain.data?.appEnv === "production" ? null : chain.data ? `${chain.data.chainName}` : null;

  async function signOut() {
    setSigningOut(true);
    await api("POST", "/v1/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/sign-in");
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Workspace">
        <Link href="/app" className={styles.brand}>
          <Logo />
        </Link>
        {me.data && me.data.memberships.length > 1 ? (
          <label className={styles.orgSwitch}>
            <span className="sr-only">Organization</span>
            <select className="select" value={org} onChange={(e) => router.push(`/app/${e.target.value}`)}>
              {me.data.memberships.map((m) => (
                <option key={m.organization.id} value={m.organization.id}>
                  {m.organization.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className={styles.orgName}>{membership.organization.name}</div>
        )}
        <nav className={styles.nav}>
          {items.map((i) => {
            const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
            return (
              <Link key={i.href} href={i.href} className={active ? styles.active : undefined} aria-current={active ? "page" : undefined}>
                <i.icon aria-hidden="true" />
                {i.label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.sideFoot}>
          <div className={styles.who}>
            <div className={styles.avatar} aria-hidden="true">
              {me.data!.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className={styles.whoName}>{me.data!.displayName}</div>
              <div className={styles.whoRoles}>{roles.map((r) => r.charAt(0) + r.slice(1).toLowerCase()).join(", ")}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-block" onClick={signOut} disabled={signingOut} style={{ justifyContent: "flex-start" }}>
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      <div className={styles.body}>
        <header className={styles.topbar}>
          <Link href="/app" className={styles.mobileBrand}>
            <Logo />
          </Link>
          <div className={styles.topRight}>
            <span role="status" aria-live="polite" className={`status ${online ? "status-success" : "status-pending"}`}>
              {online ? "Online" : "Offline"}
            </span>
            {env ? (
              <span className="status status-active" title={chain.data ? `Registry ${chain.data.registryAddress}` : undefined}>
                <ShieldCheck aria-hidden="true" />
                {env}
              </span>
            ) : null}
            <button className={`btn btn-ghost ${styles.mobileOnly}`} onClick={signOut} aria-label="Sign out">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>
        <main id="main" className={styles.main}>
          {children}
        </main>
        <footer className={styles.appFoot}>
          <span>Sealed records prove what was submitted, not that a count was true.</span>
          <span>
            <Link href="/verify">Verify a packet</Link> · <Link href="/status">Status</Link> · <Link href="/privacy">Privacy</Link>
          </span>
        </footer>
      </div>

      {has(roles, "AUDITOR") ? <FieldSync org={org} userId={me.data!.id} /> : null}

      <nav className={styles.bottomNav} aria-label="Mobile navigation">
        {bottomItems.map((i) => {
          const active = pathname.startsWith(i.href);
          return (
            <Link key={i.href} href={i.href} className={active ? styles.bnActive : undefined} aria-current={active ? "page" : undefined}>
              <i.icon aria-hidden="true" />
              <span>{i.label}</span>
            </Link>
          );
        })}
        {!isFieldOnly ? (
          <button type="button" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen}>
            <Menu aria-hidden="true" />
            <span>Menu</span>
          </button>
        ) : null}
      </nav>

      {menuOpen ? (
        <div className={styles.sheetBackdrop} onClick={() => setMenuOpen(false)}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="spread">
              <strong>{membership.organization.name}</strong>
              <button className="btn btn-ghost" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X aria-hidden="true" /></button>
            </div>
            {me.data && me.data.memberships.length > 1 ? (
              <label className={styles.orgSwitch}>
                <span className="sr-only">Organization</span>
                <select className="select" value={org} onChange={(e) => { setMenuOpen(false); router.push(`/app/${e.target.value}`); }}>
                  {me.data.memberships.map((m) => <option key={m.organization.id} value={m.organization.id}>{m.organization.name}</option>)}
                </select>
              </label>
            ) : null}
            <nav className={styles.nav}>
              {items.map((i) => {
                const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
                return (
                  <Link key={i.href} href={i.href} className={active ? styles.active : undefined} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                    <i.icon aria-hidden="true" />
                    {i.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className={styles.pageHeader}>
      <div className="stack-sm" style={{ minWidth: 0 }}>
        {back ? (
          <Link href={back.href} className={styles.back}>
            {back.label}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {description ? <p className="muted" style={{ maxWidth: 680 }}>{description}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
