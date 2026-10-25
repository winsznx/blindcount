"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileCheck2, Sparkles } from "lucide-react";
import { api, errorMessage, get, idemKey } from "@/lib/api";
import type { ReviewDetail } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { OutcomeStatus, SealedSlot, Status } from "@/components/status";
import { ErrorState, Loading } from "@/components/states";
import { useReauth } from "@/components/reauth";
import { has, useOrgRoles } from "@/components/use-me";
import { formatDate, shortHash, titleCase } from "@/lib/format";
import styles from "./review.module.css";

const LABELS = [
  { value: "USEFUL", label: "Useful" },
  { value: "FALSE_POSITIVE", label: "False positive" },
  { value: "NEEDS_FOLLOW_UP", label: "Needs follow-up" },
] as const;

export default function ReviewPage() {
  const org = useOrg();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { guard, dialog } = useReauth();
  const { roles } = useOrgRoles(org);
  const q = useQuery({ queryKey: ["review", id], queryFn: () => get<ReviewDetail>(`/v1/reviews/${id}`) });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const first = r.versions[0]!;
  const isReviewer = has(roles, "REVIEWER");
  const corrections = r.versions.slice(1);
  const latest = r.versions[r.versions.length - 1]!;
  const outcomeOf = (versionId: string) => r.evaluations.find((e) => e.submissionVersionId === versionId)?.result ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["review", id] });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await guard(fn);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const decide = (decision: "APPROVE" | "APPROVE_ORIGINAL" | "DISPUTE" | "REQUEST_CORRECTION") => run(async () => {
    await api("POST", `/v1/reviews/${id}/decision`, { decision, reason });
  });
  const flags = r.assessments.flatMap((a) => a.flags.map((f) => ({ ...f, provider: a.provider })));
  const aiRuns = r.assessments.filter((a) => a.provider !== "deterministic");

  return (
    <>
      {dialog}
      <PageHeader title={r.assignment.farmPseudonym} back={{ href: `/app/${org}/reviews`, label: "Review desk" }} description={<>Cohort {r.cohort.code}. Audited by {r.auditor?.displayName ?? "unknown"}.{r.cohort.dataSource === "SIMULATED_DEMO" ? " Simulated demo data." : ""}</>} />

      <section className={styles.headline} aria-label="Result summary">
        <div><span className={styles.big}>{first.count}</span><span className="muted">original count</span></div>
        <div className={styles.vs}>evaluated against</div>
        <div><SealedSlot value={r.criterion?.targetCount ?? null} /></div>
        <div><OutcomeStatus outcome={r.evaluation?.result ?? null} /></div>
      </section>

      {error ? <div className="notice notice-error" role="alert" style={{ marginBottom: 16 }}>{error}</div> : null}
      {notice ? <div className="notice notice-pending" style={{ marginBottom: 16 }}>{notice}</div> : null}

      <div className={styles.grid}>
        <div className="stack">
          {corrections.length ? (
            <section className="panel panel-pad stack-sm" aria-label="Version history">
              <h2 style={{ fontSize: 17 }}>Version history</h2>
              <p className="muted" style={{ fontSize: 14 }}>Every version is signed by the auditor and anchored. The original never changes; you decide which version the report accepts.</p>
              <table className="table">
                <thead><tr><th>Version</th><th>Count</th><th>Reason</th><th>Outcome</th><th>Status</th></tr></thead>
                <tbody>
                  {r.versions.map((v) => (
                    <tr key={v.id}>
                      <td>v{v.version}{v.version === 1 ? <span className="subtle"> (original)</span> : null}</td>
                      <td className="num"><strong>{v.count}</strong></td>
                      <td className="muted" style={{ fontSize: 13.5 }}>{v.amendmentReason ?? "—"}</td>
                      <td><OutcomeStatus outcome={outcomeOf(v.id)} /></td>
                      <td>{r.acceptedVersionId === v.id ? <Status tone="success">Accepted</Status> : v.anchorStatus === "CONFIRMED" ? <Status tone="neutral">Anchored</Status> : <Status tone="pending">Anchoring</Status>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          <section className="panel panel-pad stack">
            <h2 style={{ fontSize: 17 }}>Evidence</h2>
            {first.evidence.length ? (
              <div className={styles.thumbs}>
                {first.evidence.map((e) => (
                  <figure key={e.id}>
                    <a href={`/v1/evidence/${e.id}/content`} target="_blank" rel="noreferrer"><img src={`/v1/evidence/${e.id}/content`} alt={`Evidence photo ${e.width}×${e.height}`} loading="lazy" /></a>
                    <figcaption className="mono">{shortHash(e.sha256, 8)} · {e.width}×{e.height}</figcaption>
                  </figure>
                ))}
              </div>
            ) : <p className="muted">No photos. Auditor&apos;s exception: {first.evidenceException}</p>}
            <dl className="kv">
              <dt>Visit date</dt><dd>{first.visitDate}</dd>
              <dt>Method</dt><dd>{titleCase(first.captureMethod)}</dd>
              <dt>Device time</dt><dd>{formatDate(first.deviceClaimedAt, true)} <span className="subtle">(claimed)</span></dd>
              <dt>Server receipt</dt><dd>{formatDate(first.receivedAt, true)}</dd>
              <dt>Anchor</dt><dd className="mono">{shortHash(first.anchorTxHash, 12)}</dd>
            </dl>
            <div className="field">
              <span className="label">Field notes</span>
              {/* Rendered as inert text. Instructions inside notes are never acted on. */}
              <p className={styles.notes}>{first.notes || <span className="subtle">No notes.</span>}</p>
            </div>
          </section>

          <section className="panel panel-pad stack">
            <div className="spread">
              <h2 style={{ fontSize: 17 }}>Flags for review</h2>
              <button className="btn btn-secondary" disabled={busy || !isReviewer} title={isReviewer ? undefined : "Only reviewers can run evidence checks"} onClick={() => run(async () => { const res = await api<{ status: string; error?: string }>("POST", `/v1/reviews/${id}/ai-review`); if (res.error) setNotice(res.error); })}>
                <Sparkles aria-hidden="true" /> Run AI evidence check
              </button>
            </div>
            {aiRuns.some((a) => a.status === "ERROR") ? <div className="notice notice-pending">AI unavailable; manual review required. Deterministic checks below still apply.</div> : null}
            {flags.length === 0 ? <p className="muted">No indicators raised. That does not mean the evidence is sufficient.</p> : (
              <ul className={styles.flags}>
                {flags.map((f) => (
                  <li key={f.id}>
                    <div className="spread"><strong>{titleCase(f.code)}</strong><span className="subtle" style={{ fontSize: 12.5 }}>{f.provider === "deterministic" ? "Deterministic check" : "AI suggestion"}, {f.severity}</span></div>
                    <p className="muted">{f.reason}</p>
                    <div className="row" role="group" aria-label="Your assessment of this flag">
                      {LABELS.map((l) => (
                        <button key={l.value} className={`btn ${f.humanLabel === l.value ? "btn-primary" : "btn-secondary"}`} disabled={busy || !isReviewer} aria-pressed={f.humanLabel === l.value} onClick={() => run(async () => { await api("POST", `/v1/reviews/${id}/flags/${encodeURIComponent(f.id)}/label`, { label: l.value }); })}>{l.label}</button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="panel panel-pad stack">
            <h2 style={{ fontSize: 17 }}>Decision</h2>
            {r.evaluation ? <p className="muted" style={{ fontSize: 13.5 }}>Deterministic rule {r.evaluation.ruleVersion}: {r.evaluation.observedCount} {r.evaluation.result === "MEETS_CRITERION" ? "≥" : "<"} {r.evaluation.targetCount}. AI cannot change this.</p> : null}
            {r.canDecide ? (
              <>
                <div className="field">
                  <label htmlFor="reason">Reason</label>
                  <textarea id="reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <span className="hint">Recorded with your name on the report.</span>
                </div>
                {corrections.length ? (
                  <>
                    <button className="btn btn-primary btn-block" disabled={busy || reason.trim().length < 5} onClick={() => decide("APPROVE")}>Accept correction (v{latest.version}: {latest.count})</button>
                    <button className="btn btn-secondary btn-block" disabled={busy || reason.trim().length < 5} onClick={() => decide("APPROVE_ORIGINAL")}>Keep original (v1: {first.count})</button>
                  </>
                ) : (
                  <button className="btn btn-primary btn-block" disabled={busy || reason.trim().length < 5} onClick={() => decide("APPROVE")}>Approve</button>
                )}
                <button className="btn btn-secondary btn-block" disabled={busy || reason.trim().length < 5} onClick={() => decide("DISPUTE")}>Mark disputed</button>
                <button className="btn btn-ghost btn-block" disabled={busy || reason.trim().length < 5} onClick={() => decide("REQUEST_CORRECTION")}>Request correction</button>
                <span className="hint">If you request a correction, the auditor reads your reason. Don&apos;t mention the criterion.</span>
              </>
            ) : (
              <div className="stack-sm">
                <Status tone={r.state === "APPROVED" ? "success" : r.state === "DISPUTED" ? "error" : "pending"}>{titleCase(r.state)}</Status>
                {r.decisionReason ? <p className="muted">{r.decisionReason}</p> : null}
                {r.decidedAt ? <span className="subtle" style={{ fontSize: 13 }}>{formatDate(r.decidedAt, true)}</span> : null}
              </div>
            )}
          </section>

          <section className="panel panel-pad stack">
            <h2 style={{ fontSize: 17 }}>Report</h2>
            {r.reports.map((rep) => (
              <Link key={rep.id} href={`/app/${org}/reports/${rep.id}`} className="row" style={{ justifyContent: "space-between" }}>
                <span>Version {rep.version}</span><Status tone={rep.status === "APPROVED" ? "success" : rep.status === "DISPUTED" ? "error" : "pending"}>{titleCase(rep.status)}</Status>
              </Link>
            ))}
            <GenerateReport observationId={r.observationId} org={org} disabled={busy} onDone={refresh} />
          </section>
        </aside>
      </div>
    </>
  );
}

function GenerateReport({ observationId, org, disabled, onDone }: { observationId: string; org: string; disabled: boolean; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("POST", `/v1/observations/${observationId}/reports`, undefined, { "idempotency-key": idemKey() });
      onDone();
      router.push(`/app/${org}/reports/${r.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <>
      {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
      <button className="btn btn-secondary btn-block" onClick={go} disabled={disabled || busy}>
        <FileCheck2 aria-hidden="true" /> {busy ? "Generating…" : "Generate report and proof packet"}
      </button>
      <span className="hint">Unreviewed reports are watermarked NOT APPROVED.</span>
    </>
  );
}
