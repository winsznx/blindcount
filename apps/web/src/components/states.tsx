import { AlertCircle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/api";

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 28 : 56, width: i === 0 ? "40%" : "100%" }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <div className="stack-sm">
        <span>{errorMessage(error)}</span>
        {onRetry ? (
          <button className="btn btn-secondary" style={{ justifySelf: "start" }} onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel panel-pad" style={{ display: "grid", justifyItems: "center", textAlign: "center", gap: 12, padding: "48px 24px" }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surface-sunk)", display: "grid", placeItems: "center", color: "var(--ink-2)" }}>
        <Inbox size={20} aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      {children ? <p className="muted" style={{ maxWidth: 420 }}>{children}</p> : null}
      {action}
    </div>
  );
}
