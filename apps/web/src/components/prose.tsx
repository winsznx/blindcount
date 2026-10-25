import type { ReactNode } from "react";

export function Prose({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <article style={{ maxWidth: 720, margin: "0 auto", padding: "56px 16px 0", display: "grid", gap: 20, fontSize: 16, lineHeight: 1.65 }}>
      <h1>{title}</h1>
      {lead ? <p className="muted" style={{ fontSize: 18 }}>{lead}</p> : null}
      {children}
    </article>
  );
}
