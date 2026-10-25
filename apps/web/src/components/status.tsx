import { AlertTriangle, CheckCircle2, Circle, CircleDashed, Clock3, Lock, ShieldCheck, XCircle } from "lucide-react";
import { titleCase } from "@/lib/format";

type Tone = "success" | "error" | "pending" | "active" | "neutral";

const ASSIGNMENT: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: "neutral", label: "Open" },
  IN_PROGRESS: { tone: "neutral", label: "In progress" },
  RECEIVED: { tone: "pending", label: "Received" },
  ANCHOR_PENDING: { tone: "pending", label: "Anchoring" },
  ANCHOR_FAILED: { tone: "error", label: "Anchor failed" },
  SEALED: { tone: "success", label: "Sealed" },
  REVIEW_PENDING: { tone: "pending", label: "Needs review" },
  APPROVED: { tone: "success", label: "Approved" },
  DISPUTED: { tone: "error", label: "Disputed" },
  AMENDMENT_REQUESTED: { tone: "pending", label: "Correction requested" },
  VOID_PENDING: { tone: "pending", label: "Void pending" },
  VOIDED: { tone: "neutral", label: "Voided" },
  EXPIRED: { tone: "error", label: "Late" },
};

const COHORT: Record<string, { tone: Tone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  PUBLISH_PENDING: { tone: "pending", label: "Publishing onchain" },
  PUBLISH_FAILED: { tone: "error", label: "Publish failed" },
  ACTIVE: { tone: "active", label: "Collecting" },
  CLOSING_PENDING: { tone: "pending", label: "Closing onchain" },
  CLOSED: { tone: "success", label: "Closed" },
  DISCLOSED: { tone: "success", label: "Criterion disclosed" },
  ARCHIVED: { tone: "neutral", label: "Archived" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
  SUSPENDED: { tone: "error", label: "Suspended" },
};

const ICON: Record<Tone, typeof Circle> = { success: CheckCircle2, error: XCircle, pending: Clock3, active: CircleDashed, neutral: Circle };

export function Status({ tone, children, icon }: { tone: Tone; children: string; icon?: typeof Circle }) {
  const Icon = icon ?? ICON[tone];
  return (
    <span className={`status ${tone === "neutral" ? "" : `status-${tone}`}`}>
      <Icon aria-hidden="true" />
      {children}
    </span>
  );
}

export function AssignmentStatus({ status }: { status: string }) {
  const s = ASSIGNMENT[status] ?? { tone: "neutral" as const, label: titleCase(status) };
  return <Status tone={s.tone}>{s.label}</Status>;
}

export function CohortStatus({ state }: { state: string }) {
  const s = COHORT[state] ?? { tone: "neutral" as const, label: titleCase(state) };
  return <Status tone={s.tone}>{s.label}</Status>;
}

export function OutcomeStatus({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="subtle">—</span>;
  return outcome === "MEETS_CRITERION" ? <Status tone="success" icon={ShieldCheck}>Meets criterion</Status> : <Status tone="error" icon={AlertTriangle}>Below criterion</Status>;
}

/** The concealed criterion. It is never a blank: the absence is explained. */
export function SealedSlot({ value, operator = "gte" }: { value?: number | null; operator?: string }) {
  if (value === null || value === undefined) {
    return (
      <span className="sealed-slot" title="The target is stored encrypted and committed onchain. It unlocks after every assignment is sealed and the cohort is closed.">
        <Lock aria-hidden="true" />
        Target sealed until cohort closes
      </span>
    );
  }
  return (
    <span className="sealed-slot revealed">
      <ShieldCheck aria-hidden="true" />
      Shade trees {operator === "gte" ? "≥" : operator} <strong className="num">{value}</strong>
    </span>
  );
}
