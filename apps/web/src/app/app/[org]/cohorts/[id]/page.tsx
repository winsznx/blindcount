"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ClipboardList, Lock, ShieldCheck } from "lucide-react";
import { api, errorMessage, get, idemKey } from "@/lib/api";
import type { CohortView, Progress } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { AssignmentStatus, CohortStatus, OutcomeStatus, SealedSlot } from "@/components/status";
import { ErrorState, Loading } from "@/components/states";
import { Dialog } from "@/components/dialog";
import { useReauth } from "@/components/reauth";
import { TxLink } from "@/components/tx-link";
import { has, useOrgRoles } from "@/components/use-me";
import { formatDate, shortHash } from "@/lib/format";

const MOVING = ["PUBLISH_PENDING", "CLOSING_PENDING"];

export default function CohortDetail() {
  const org = useOrg();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { roles } = useOrgRoles(org);
  const { guard, dialog } = useReauth();
  const cohort = useQuery({
    queryKey: ["cohort", id],
    queryFn: () => get<CohortView>(`/v1/cohorts/${id}`),
    refetchInterval: (q) => (q.state.data && (MOVING.includes(q.state.data.state) || q.state.data.assignments.some((a) => a.status === "ANCHOR_PENDING")) ? 2500 : false),
  });
  const progress = useQuery({ queryKey: ["progress", id], queryFn: () => get<Progress>(`/v1/cohorts/${id}/progress`), refetchInterval: 5000 });
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDisclose, setConfirmDisclose] = useState(false);
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [decideVoid, setDecideVoid] = useState<{ id: string; decision: "APPROVE" | "REJECT"; farm: string; reason: string | null } | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (cohort.isLoading) return <Loading />;
  if (cohort.error || !cohort.data) return <ErrorState error={cohort.error} onRetry={() => cohort.refetch()} />;
  const c = cohort.data;
  const p = progress.data;
  const isManager = has(roles, "MANAGER");
  const isCustodian = has(roles, "CUSTODIAN");
  const canApproveVoid = has(roles, "REVIEWER", "OWNER");

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await guard(async () => {
        await fn();
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ["cohort", id] }), qc.invalidateQueries({ queryKey: ["progress", id] })]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirmClose(false);
      setConfirmDisclose(false);
    }
  }

  const explorer = c.chain.explorerUrl;
  return (
    <>
      {dialog}
      <PageHeader
        title={c.name}
        back={{ href: `/app/${org}/programmes/${c.programme.id}`, label: c.programme.name }}
        description={<>Cohort {c.code}. Due {formatDate(c.dueAt)}.{c.programme.dataSource === "SIMULATED_DEMO" ? " Simulated demo data." : ""}</>}
        actions={
          <>
            <CohortStatus state={c.state} />
            {c.state === "DISCLOSED" ? (
              <Link className="btn btn-secondary" href={`/app/${org}/reviews?cohort=${c.id}`}>
                <ClipboardList aria-hidden="true" /> Review desk
              </Link>
            ) : null}
          </>
        }
      />

      <div className="stack-lg">
        {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
        {c.lastError && ["PUBLISH_FAILED", "ACTIVE"].includes(c.state) ? (
          <div className="notice notice-error" role="alert">
            Last chain operation failed: {c.lastError}. {c.state === "PUBLISH_FAILED" ? "Nothing was disclosed. You can retry publishing." : "Closure was not completed and nothing was disclosed."}
          </div>
        ) : null}

        <section className="panel panel-pad stack">
          <div className="spread">
            <div className="stack-sm">
              <span className="label">Criterion</span>
              <SealedSlot value={c.criterion.targetCount ?? null} operator={c.criterion.operator} />
            </div>
            <div className="row">
              {c.state === "DRAFT" && isManager ? <Link className="btn btn-primary" href={`/app/${org}/cohorts/new?cohort=${c.id}`}>Continue setup</Link> : null}
              {c.state === "PUBLISH_FAILED" && isManager ? <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api("POST", `/v1/cohorts/${id}/publish`, undefined, { "idempotency-key": idemKey() }))}>Retry publish</button> : null}
              {c.state === "ACTIVE" && isManager ? <button className="btn btn-primary" disabled={busy} onClick={() => setConfirmClose(true)}>Close cohort</button> : null}
              {c.state === "CLOSED" && isCustodian ? <button className="btn btn-primary" disabled={busy} onClick={() => setConfirmDisclose(true)}><ShieldCheck aria-hidden="true" /> Disclose criterion</button> : null}
              {c.state === "CLOSED" && !isCustodian ? <span className="hint">Waiting for the criterion custodian to disclose.</span> : null}
            </div>
          </div>
          {MOVING.includes(c.state) ? (
            <div className="notice notice-pending" role="status" aria-live="polite">
              {c.state === "PUBLISH_PENDING" ? "Registering the cohort on chain. Auditors get access when the roster freeze is confirmed." : "Waiting for the onchain closure to confirm. The criterion stays sealed until then."}
            </div>
          ) : null}
          <hr className="divider" />
          <dl className="kv">
            <dt>Network</dt><dd>Chain {c.chain.chainId}, registry <span className="mono">{shortHash(c.chain.registryAddress, 8)}</span></dd>
            <dt>Target commitment</dt><dd className="mono">{shortHash(c.chain.targetCommitment, 14)}</dd>
            <dt>Publish transactions</dt>
            <dd className="row" style={{ gap: 10 }}>{c.chain.publishTxHashes.length ? c.chain.publishTxHashes.map((h) => <TxLink key={h} hash={h} explorer={explorer} />) : <span className="subtle">Not published yet</span>}</dd>
            <dt>Close transaction</dt><dd><TxLink hash={c.chain.closeTxHash} explorer={explorer} /></dd>
            <dt>Disclosure receipt</dt><dd><TxLink hash={c.chain.disclosureTxHash} explorer={explorer} /></dd>
          </dl>
        </section>

        {p && c.state === "ACTIVE" && p.blockers.length ? (
          <section className="panel panel-pad stack-sm">
            <h3>Closure is blocked by {p.blockers.length} assignment{p.blockers.length === 1 ? "" : "s"}</h3>
            <p className="muted">Every assignment needs a chain-confirmed first submission or an approved void before the criterion can be disclosed. This protects audits that are still open.</p>
          </section>
        ) : null}

        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 17 }}>Assignments</h2>
            {p ? <span className="subtle num">{p.total - p.blockers.length} of {p.total} terminal</span> : null}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Farm</th><th>Auditor</th><th>Status</th><th>Anchor</th>{c.state === "DISCLOSED" ? <th>Outcome</th> : null}<th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {c.assignments.map((a) => (
                  <tr key={a.id}>
                    <td><strong style={{ fontWeight: 550 }}>{a.farmPseudonym}</strong><div className="subtle" style={{ fontSize: 12.5 }}>{a.code}</div></td>
                    <td className="muted">{a.auditor?.displayName ?? "—"}</td>
                    <td>
                      <AssignmentStatus status={a.status} />
                      {a.voidReason ? <div className="subtle" style={{ fontSize: 12.5, marginTop: 4 }}>Void reason: {a.voidReason}</div> : null}
                      {a.status === "ANCHOR_FAILED" && has(roles, "OWNER", "MANAGER") ? <div style={{ fontSize: 12.5, marginTop: 4 }}><Link href={`/app/${org}/settings/security#chain-queue`}>Retry from the chain queue</Link></div> : null}
                    </td>
                    <td><TxLink hash={a.anchorTxHash} explorer={explorer} /></td>
                    {c.state === "DISCLOSED" ? <td><OutcomeStatus outcome={a.outcome} /></td> : null}
                    <td style={{ textAlign: "right" }}>
                      {c.state === "ACTIVE" && isManager && ["PENDING", "IN_PROGRESS", "EXPIRED"].includes(a.status) && !a.observationId ? <button className="btn btn-ghost" onClick={() => { setVoidFor(a.id); setVoidReason(""); }}>Request void</button> : null}
                      {a.status === "VOID_PENDING" && canApproveVoid ? (
                        <span className="row" style={{ justifyContent: "flex-end" }}>
                          <button className="btn btn-secondary" disabled={busy} onClick={() => { setDecisionReason(""); setDecideVoid({ id: a.id, decision: "APPROVE", farm: a.farmPseudonym, reason: a.voidReason }); }}>Approve void</button>
                          <button className="btn btn-ghost" disabled={busy} onClick={() => { setDecisionReason(""); setDecideVoid({ id: a.id, decision: "REJECT", farm: a.farmPseudonym, reason: a.voidReason }); }}>Reject</button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} title="Close this cohort?">
        {p && p.blockers.length ? (
          <>
            <p className="muted">These assignments are not yet sealed or voided, so the registry will refuse closure:</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{p.blockers.map((b) => <li key={b.assignmentId}>{b.farmPseudonym} ({b.code}): {b.status.toLowerCase().replace(/_/g, " ")}{b.late ? ", late" : ""}</li>)}</ul>
          </>
        ) : (
          <p className="muted">Closure is irreversible. The registry checks that every assignment is terminal, then no more submissions are accepted. The criterion is disclosed in a separate step by the custodian.</p>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => setConfirmClose(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api("POST", `/v1/cohorts/${id}/close`, undefined, { "idempotency-key": idemKey() }))}>Close cohort</button>
        </div>
      </Dialog>

      <Dialog open={confirmDisclose} onClose={() => setConfirmDisclose(false)} title="Disclose the criterion?">
        <p className="muted">The target will be shown to managers, reviewers and custodians in this organization, and each sealed observation is evaluated deterministically against it. Auditors never see it in the app. A salted disclosure receipt is recorded onchain.</p>
        <div className="notice"><Lock aria-hidden="true" />This is logged with your identity and can&apos;t be undone.</div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => setConfirmDisclose(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api("POST", `/v1/cohorts/${id}/disclose`))}>Disclose and evaluate</button>
        </div>
      </Dialog>

      <Dialog open={!!decideVoid} onClose={() => setDecideVoid(null)} title={decideVoid?.decision === "APPROVE" ? `Approve voiding ${decideVoid.farm}?` : `Reject the void for ${decideVoid?.farm ?? ""}?`}>
        <p className="muted">Requested reason: {decideVoid?.reason}</p>
        {decideVoid?.decision === "APPROVE" ? <p className="muted">As the second approver, you confirm this visit won&apos;t happen. The void is recorded onchain with both approvals, and the assignment counts as closed for this cohort.</p> : null}
        <div className="field">
          <label htmlFor="void-decision-reason">Your reason</label>
          <textarea id="void-decision-reason" className="textarea" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} />
          <span className="hint">Recorded with your name in the audit trail.</span>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => setDecideVoid(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || decisionReason.trim().length < 5} onClick={() => { const v = decideVoid; setDecideVoid(null); if (v) void act(() => api("POST", `/v1/assignments/${v.id}/void-approve`, { decision: v.decision, reason: decisionReason })); }}>
            {decideVoid?.decision === "APPROVE" ? "Approve void" : "Reject void"}
          </button>
        </div>
      </Dialog>

      <Dialog open={!!voidFor} onClose={() => setVoidFor(null)} title="Request a void">
        <p className="muted">Only an assignment with no submission can be voided. A second person (a reviewer or owner, not you) must approve it before it is recorded onchain.</p>
        <div className="field">
          <label htmlFor="void-reason">Reason</label>
          <textarea id="void-reason" className="textarea" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <span className="hint">At least 10 characters. Shown on reports.</span>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => setVoidFor(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || voidReason.trim().length < 10} onClick={() => { const a = voidFor; setVoidFor(null); void act(() => api("POST", `/v1/assignments/${a}/void-request`, { reason: voidReason })); }}>Request void</button>
        </div>
      </Dialog>
    </>
  );
}
