export function formatDate(iso: string | Date | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(undefined, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(d);
}

export function utc(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  return (typeof iso === "string" ? new Date(iso) : iso).toISOString().replace(".000Z", "Z");
}

export function shortHash(h: string | null | undefined, n = 10): string {
  if (!h) return "—";
  return h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-6)}` : h;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function titleCase(s: string): string {
  const lower = s.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
