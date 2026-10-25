"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, Plus, Trash2 } from "lucide-react";
import { api, errorMessage, get, idemKey } from "@/lib/api";
import type { CohortView, Programme, VisitForm } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { SealedSlot } from "@/components/status";
import { shortHash } from "@/lib/format";
import styles from "./wizard.module.css";

interface Members {
  members: Array<{ userId: string; email: string; displayName: string; roles: string[]; status: string }>;
}

const STEPS = ["Context", "Hidden criterion", "Roster", "Preview and publish"] as const;

export default function NewCohortPage() {
  return (
    <Suspense>
      <Wizard />
    </Suspense>
  );
}

function Wizard() {
  const org = useOrg();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const resumeId = params.get("cohort");
  const [stepState, setStep] = useState<number | null>(resumeId ? null : 0);
  const [cohortId, setCohortId] = useState<string | null>(resumeId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const programmes = useQuery({ queryKey: ["programmes", org], queryFn: () => get<Programme[]>(`/v1/organizations/${org}/programmes`) });
  const members = useQuery({ queryKey: ["members", org], queryFn: () => get<Members>(`/v1/organizations/${org}/members`), refetchOnMount: "always" });
  const cohort = useQuery({ queryKey: ["cohort", cohortId], queryFn: () => get<CohortView>(`/v1/cohorts/${cohortId}`), enabled: !!cohortId });
  // Resuming a draft: pick up at the first step the server says is unfinished.
  const step = stepState ?? (cohort.data ? (!cohort.data.criterion.set ? 1 : cohort.data.assignments.length === 0 ? 2 : 3) : 0);
  const preview = useQuery({ queryKey: ["blind-preview", cohortId], queryFn: () => get<VisitForm>(`/v1/cohorts/${cohortId}/blind-preview`), enabled: !!cohortId && step === 3 });
  const alreadyPublished = !!resumeId && !!cohort.data && cohort.data.state !== "DRAFT";
  // Navigation is a side effect: leave the wizard once the server says this cohort is past DRAFT.
  useEffect(() => {
    if (alreadyPublished) router.replace(`/app/${org}/cohorts/${resumeId}`);
  }, [alreadyPublished, org, resumeId, router]);

  const inWeeks = (n: number) => new Date(Date.now() + n * 7 * 86400_000).toISOString().slice(0, 10);
  const [ctx, setCtx] = useState({ programmeId: params.get("programme") ?? "", code: "C1", name: "Cohort 1", dueAt: inWeeks(2) });
  const [target, setTarget] = useState("");
  const [showTarget, setShowTarget] = useState(false);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [rows, setRows] = useState([{ farmCode: "FARM-001", farmPseudonym: "FARM-001", auditorUserId: "" }]);
  const [rowIssues, setRowIssues] = useState<Array<{ row: number; field: string; message: string }>>([]);

  const auditors = (members.data?.members ?? []).filter((m) => m.status === "ACTIVE" && m.roles.includes("AUDITOR"));
  const programmeId = ctx.programmeId || programmes.data?.[0]?.id || "";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const submitContext = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!cohortId) {
        const c = await api<CohortView>("POST", `/v1/programmes/${programmeId}/cohorts`, { code: ctx.code.toUpperCase(), name: ctx.name, dueAt: new Date(`${ctx.dueAt}T23:59:00`).toISOString() });
        setCohortId(c.id);
        // The draft id lives in the URL, so leaving to invite auditors never loses this cohort.
        router.replace(`/app/${org}/cohorts/new?cohort=${c.id}`);
      }
      setStep(1);
    });
  };

  const submitCriterion = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ targetCommitment: string }>("PUT", `/v1/cohorts/${cohortId}/criterion`, { operator: "gte", targetCount: Number(target) });
      setCommitment(r.targetCommitment);
      // The plaintext leaves browser memory as soon as it is committed.
      setTarget("");
      setShowTarget(false);
      await members.refetch();
      setStep(2);
    });
  };

  const submitRoster = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const already = cohort.data?.assignments.length ?? 0;
      if (rows.length) {
        const check = await api<{ valid: boolean; issues: typeof rowIssues }>("POST", `/v1/cohorts/${cohortId}/assignments`, { preview: true, assignments: rows });
        setRowIssues(check.issues);
        if (!check.valid) throw new Error("Fix the highlighted roster rows.");
        await api("POST", `/v1/cohorts/${cohortId}/assignments`, { assignments: rows });
        setRows([]);
      } else if (!already) {
        throw new Error("Add at least one assignment.");
      }
      await qc.invalidateQueries({ queryKey: ["cohort", cohortId] });
      setStep(3);
    });
  };

  const publish = () =>
    run(async () => {
      const published = await api<CohortView>("POST", `/v1/cohorts/${cohortId}/publish`, undefined, { "idempotency-key": idemKey() });
      qc.setQueryData(["cohort", cohortId], published);
      await qc.invalidateQueries({ queryKey: ["programmes", org] });
      router.push(`/app/${org}/cohorts/${cohortId}`);
    });

  const issueFor = (row: number, field: string) => rowIssues.find((i) => i.row === row && i.field === field)?.message;

  return (
    <>
      <PageHeader title="New cohort" back={{ href: `/app/${org}/programmes`, label: "Programmes" }} description="Everything in a cohort shares one hidden criterion. Once published, the roster and criterion are frozen and committed onchain." />
      <ol className={styles.steps} aria-label="Cohort setup steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? styles.current : i < step ? styles.done : undefined} aria-current={i === step ? "step" : undefined}>
            <span className={styles.n}>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <div className="panel panel-pad stack" style={{ maxWidth: 820 }}>
        {error ? <div className="notice notice-error" role="alert">{error}</div> : null}

        {step === 0 ? (
          <form className="stack" onSubmit={submitContext}>
            <div className="field">
              <label htmlFor="prog">Programme</label>
              <select id="prog" className="select" required value={programmeId} onChange={(e) => setCtx({ ...ctx, programmeId: e.target.value })} disabled={!!cohortId}>
                {(programmes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="row" style={{ alignItems: "start" }}>
              <div className="field" style={{ flex: "0 0 160px" }}><label htmlFor="code">Cohort code</label><input id="code" className="input" required value={ctx.code} onChange={(e) => setCtx({ ...ctx, code: e.target.value })} disabled={!!cohortId} /></div>
              <div className="field" style={{ flex: 1, minWidth: 220 }}><label htmlFor="name">Name</label><input id="name" className="input" required value={ctx.name} onChange={(e) => setCtx({ ...ctx, name: e.target.value })} disabled={!!cohortId} /></div>
              <div className="field" style={{ flex: "0 0 180px" }}><label htmlFor="due">Due date</label><input id="due" type="date" className="input" required min={new Date().toISOString().slice(0, 10)} value={ctx.dueAt} onChange={(e) => setCtx({ ...ctx, dueAt: e.target.value })} disabled={!!cohortId} /></div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" disabled={busy || !programmeId}>Continue</button></div>
          </form>
        ) : null}

        {step === 1 ? (
          <form className="stack" onSubmit={submitCriterion}>
            <div className="notice notice-pending">
              <Lock aria-hidden="true" />
              <span>The target is encrypted on the server and committed onchain as a salted hash. Auditors and unrelated reviewers can never retrieve it before closure. You, as the person entering it, will know the value: that is the trust boundary.</span>
            </div>
            <div className="field" style={{ maxWidth: 360 }}>
              <label htmlFor="target">Minimum shade-tree count</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <span className="muted" aria-hidden="true" style={{ fontSize: 20 }}>≥</span>
                <input id="target" className="input num" type={showTarget ? "text" : "password"} inputMode="numeric" autoComplete="off" required pattern="\d{1,6}" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} />
                <button type="button" className="btn btn-ghost" onClick={() => setShowTarget((v) => !v)} aria-label={showTarget ? "Hide value" : "Show value"}>
                  {showTarget ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              <span className="hint">A whole number from 0 to 100,000. Masked by default.</span>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn btn-primary" disabled={busy || target === ""}>Commit criterion</button></div>
          </form>
        ) : null}

        {step === 2 ? (
          <form className="stack" onSubmit={submitRoster}>
            <p className="muted">Use pseudonymous farm labels only. Each row becomes one fixed assignment, registered onchain under a random opaque key.</p>
            {auditors.length === 0 ? (
              <div className="notice notice-pending" style={{ alignItems: "center" }}>
                <span style={{ flex: 1 }}>No auditors have joined yet. <Link href={`/app/${org}/settings/members`}>Invite them from Members</Link>; this draft stays saved and you can continue it from the cohort page.</span>
                <button type="button" className="btn btn-secondary" onClick={() => members.refetch()} disabled={members.isFetching}>Refresh list</button>
              </div>
            ) : null}
            {(cohort.data?.assignments ?? []).length ? (
              <div className="hint">Already on the roster: {cohort.data!.assignments.map((a) => a.farmPseudonym).join(", ")}</div>
            ) : null}
            <div className={styles.roster}>
              {rows.map((r, i) => (
                <div key={i} className={styles.rosterRow}>
                  <div className="field"><label htmlFor={`fc${i}`}>Farm code</label><input id={`fc${i}`} className="input" required value={r.farmCode} aria-invalid={!!issueFor(i, "farmCode")} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, farmCode: e.target.value } : x)))} />{issueFor(i, "farmCode") ? <span className="field-error">{issueFor(i, "farmCode")}</span> : null}</div>
                  <div className="field"><label htmlFor={`fp${i}`}>Pseudonym</label><input id={`fp${i}`} className="input" required value={r.farmPseudonym} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, farmPseudonym: e.target.value } : x)))} /></div>
                  <div className="field"><label htmlFor={`au${i}`}>Auditor</label>
                    <select id={`au${i}`} className="select" required value={r.auditorUserId} aria-invalid={!!issueFor(i, "auditorUserId")} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, auditorUserId: e.target.value } : x)))}>
                      <option value="">Choose…</option>
                      {auditors.map((a) => <option key={a.userId} value={a.userId}>{a.displayName} ({a.email})</option>)}
                    </select>
                    {issueFor(i, "auditorUserId") ? <span className="field-error">{issueFor(i, "auditorUserId")}</span> : null}
                  </div>
                  <button type="button" className="btn btn-ghost" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /></button>
                </div>
              ))}
            </div>
            <div className="spread">
              <button type="button" className="btn btn-secondary" onClick={() => { const n = rows.length + (cohort.data?.assignments.length ?? 0) + 1; const code = `FARM-${String(n).padStart(3, "0")}`; setRows([...rows, { farmCode: code, farmPseudonym: code, auditorUserId: "" }]); }}>
                <Plus aria-hidden="true" /> Add assignment
              </button>
              <button className="btn btn-primary" disabled={busy}>Save roster and preview</button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <div className="stack">
            <h3>Exactly what each auditor will see</h3>
            {preview.data ? (
              <div className={styles.preview}>
                <div className="spread"><strong>{preview.data.farm.pseudonym}</strong><span className="subtle">{preview.data.code}</span></div>
                <p className="hint">{preview.data.notice}</p>
                <ul className={styles.fields}>
                  {["Visit date", "Observed shade-tree count", "Capture method", "Notes", "Photos (up to 3)", "Evidence consent"].map((f) => <li key={f}>{f}</li>)}
                </ul>
                <SealedSlot />
                <p className="subtle" style={{ fontSize: 12.5 }}>The preview is generated by the same server projection auditors receive. It contains no target, pass status or criterion metadata.</p>
              </div>
            ) : preview.error ? <div className="notice notice-error">{errorMessage(preview.error)}</div> : <div className="skeleton" style={{ height: 160 }} />}
            <dl className="kv">
              <dt>Assignments</dt><dd className="num">{cohort.data?.expectedCount ?? 0}</dd>
              <dt>Target commitment</dt><dd className="mono">{shortHash(commitment ?? cohort.data?.chain.targetCommitment ?? null, 14)}</dd>
              <dt>Cohort key</dt><dd className="mono">{shortHash(cohort.data?.chain.cohortKey, 14)}</dd>
            </dl>
            <div className="notice">Publishing freezes the roster and criterion, then sends three registry transactions: create cohort, register assignments, freeze roster. Auditors get access only after they confirm.</div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button className="btn btn-ghost" onClick={() => setStep(2)}>Back to roster</button>
              <button className="btn btn-primary btn-lg" onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Freeze and publish"}</button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
