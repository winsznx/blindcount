"use client";

import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, CloudOff, KeyRound, Lock, RotateCcw, ShieldCheck, Trash2, TriangleAlert, WifiOff } from "lucide-react";
import { api, ApiFailure, errorMessage, get } from "@/lib/api";
import type { VisitForm } from "@/lib/types";
import { useOrg } from "@/lib/use-org";
import { PageHeader, useOnline } from "@/components/app-shell";
import { SealedSlot } from "@/components/status";
import { ErrorState, Loading } from "@/components/states";
import { Dialog } from "@/components/dialog";
import { useMe } from "@/components/use-me";
import { createDevice, forgetDevice, loadDevice, publicJwk, saveDeviceId, webCryptoSupported, type DeviceRecord } from "@/lib/device";
import {
  discardRejected,
  emptyDraft,
  finalizeLocally,
  loadAmendment,
  loadDraft,
  loadFinal,
  localDate,
  MAX_EXCEPTION,
  photoFromFile,
  saveDraft,
  stageOf,
  syncFinalization,
  validateDraft,
  type Draft,
  type SignedFinalization,
} from "@/lib/field";
import { bytes, formatDate, shortHash, utc } from "@/lib/format";
import styles from "./visit.module.css";

const METHODS = [
  { value: "walkthrough_count", label: "Walk-through count" },
  { value: "plot_sample_count", label: "Plot sample count" },
  { value: "transect_count", label: "Transect count" },
] as const;

interface Local {
  device: DeviceRecord | null;
  draft: Draft;
  final: SignedFinalization | null;
}

export default function VisitPage() {
  const org = useOrg();
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const online = useOnline();
  const qc = useQueryClient();

  const form = useQuery({
    queryKey: ["visit", id],
    queryFn: () => get<VisitForm>(`/v1/assignments/${id}/form`),
    // Poll while any version (the original or a correction) is still being anchored.
    refetchInterval: (q) => (q.state.data?.submissions.some((v) => v.anchorStatus !== "CONFIRMED") ? 2500 : false),
  });
  const userId = me.data?.id;
  // Device state is read fresh on every mount: a cached snapshot would overwrite newer saved drafts.
  const local = useQuery({
    queryKey: ["visit-local", id, userId],
    enabled: !!userId && !!form.data && webCryptoSupported(),
    gcTime: 0,
    staleTime: 0,
    // Reads IndexedDB, not the network, so it must keep working offline.
    networkMode: "always",
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Local> => {
      const device = await loadDevice(org, userId!);
      const draft = device ? ((await loadDraft(device, id)) ?? emptyDraft(form.data!)) : emptyDraft(form.data!);
      const final = device ? await loadFinal(device, id) : null;
      return { device, draft: { ...draft, form: form.data! }, final };
    },
  });

  const [draft, setDraftState] = useState<Draft | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const fileInput = useRef<HTMLInputElement>(null);
  // The newest draft, readable from async handlers that started before the latest keystroke.
  const latestDraft = useRef<Draft | null>(null);

  if (!webCryptoSupported()) {
    return <div className="notice notice-error" role="alert">This browser can&apos;t create a secure signing key or store offline drafts, so it can&apos;t submit signed observations. Use a current version of Chrome, Safari, Edge or Firefox.</div>;
  }
  if (form.isLoading || local.isLoading) return <Loading />;
  if (!form.data) return <ErrorState error={form.error} onRetry={() => form.refetch()} />;
  if (!local.data) return <ErrorState error={local.error} onRetry={() => local.refetch()} />;

  const f = form.data;
  const d = draft ?? local.data.draft;
  const device = local.data.device;
  const final = local.data.final;
  const server = f.submissions[0];
  const stage = stageOf(final, server);
  const locked = stage !== "draft";
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["visit-local", id] }), qc.invalidateQueries({ queryKey: ["visit", id] }), qc.invalidateQueries({ queryKey: ["visits", org] })]);

  async function update(patch: Partial<Draft>) {
    const next = { ...(latestDraft.current ?? d), ...patch };
    latestDraft.current = next;
    setDraftState(next);
    if (!device) return;
    setSaved("saving");
    try {
      await saveDraft(device, next);
      setSaved("saved");
    } catch (e) {
      setSaved("failed");
      setError(errorMessage(e));
    }
  }

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      if (device && userId) await forgetDevice(org, userId);
      const rec = await createDevice(org, userId!);
      const label = `${navigator.platform || "Device"} · ${localDate()}`;
      const r = await api<{ id: string }>("POST", `/v1/organizations/${org}/devices`, { label, publicJwk: await publicJwk(rec) });
      await saveDeviceId(rec, r.id);
      // Keep whatever was typed while enrollment ran, and persist it under the new key.
      if (latestDraft.current) await saveDraft({ ...rec, deviceKeyId: r.id }, latestDraft.current);
      await qc.invalidateQueries({ queryKey: ["visit-local", id] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      const photos = [...d.photos];
      for (const file of Array.from(files)) {
        if (photos.length >= 3) throw new Error("At most 3 photos per visit.");
        const p = await photoFromFile(file);
        if (!photos.some((x) => x.sha256 === p.sha256)) photos.push(p);
      }
      await update({ photos });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function openReview() {
    const v = validateDraft(device, d);
    setIssues(v);
    if (!v.length) {
      setConfirmed(false);
      setReviewing(true);
    }
  }

  async function finalize() {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await finalizeLocally(device, d);
      setReviewing(false);
      latestDraft.current = null;
      setDraftState(null);
      if (navigator.onLine) await syncFinalization(device, id, signed).catch((e: unknown) => setError(errorMessage(e)));
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    if (!device || !final) return;
    setBusy(true);
    setError(null);
    try {
      await syncFinalization(device, id, final);
    } catch (e) {
      setError(e instanceof ApiFailure && e.code === "INVALID_SIGNATURE" && /revoked/.test(e.message) ? "This device's signing key was revoked. Discard this finalization, set up a new key, and finalize again." : errorMessage(e));
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function discard() {
    if (!device) return;
    await discardRejected(device, id);
    latestDraft.current = null;
    setDraftState(null);
    await refresh();
  }

  const keyRevoked = !!error && /revoked/i.test(error);

  return (
    <>
      <PageHeader title={f.farm.pseudonym} back={{ href: `/app/${org}/visits`, label: "My visits" }} description={<>{f.programme.name}. Due {formatDate(f.dueAt)}.{f.programme.dataSource === "SIMULATED_DEMO" ? " Simulated demo visit, not a real farm." : ""}</>} />

      <div className={styles.layout}>
        <div className="stack">
          <div className={styles.blindNote}>
            <Lock aria-hidden="true" />
            <div className="stack-sm">
              <strong>{f.notice}</strong>
              <SealedSlot />
            </div>
          </div>

          {form.error ? (
            <div className="notice notice-pending" role="status">
              <WifiOff aria-hidden="true" />
              Can&apos;t reach BlindCount right now. You can keep working; everything is saved on this device.
            </div>
          ) : null}
          {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
          {f.late && !locked ? <div className="notice notice-error"><TriangleAlert aria-hidden="true" />This visit is past its due date. You can still submit; it will be marked late for manager review.</div> : null}

          {(!device?.deviceKeyId || keyRevoked) && !locked ? (
            <section className="panel panel-pad stack">
              <div className="row"><KeyRound size={18} aria-hidden="true" /><h3>{keyRevoked ? "Set up a new signing key" : "Set up this device to sign"}</h3></div>
              <p className="muted">Your phone creates a private signing key that never leaves it. BlindCount stores only the public half, so it can check that the observation came from you on this device.</p>
              <button className="btn btn-primary btn-lg" onClick={enroll} disabled={busy || !online}>{online ? "Set up signing key" : "Connect to set up"}</button>
            </section>
          ) : null}

          {!locked ? (
            <section className="panel panel-pad stack" aria-label="Field observation">
              <div className="spread">
                <h2 style={{ fontSize: 18 }}>Observation</h2>
                <span className="subtle" role="status" aria-live="polite" style={{ fontSize: 13 }}>
                  {saved === "saving" ? "Saving on this device…" : saved === "saved" ? "Saved on this device" : saved === "failed" ? "Not saved" : device ? "Drafts save on this device" : ""}
                </span>
              </div>

              <div className="field">
                <label htmlFor="count">Observed shade trees</label>
                <div className="count-input">
                  <button type="button" aria-label="Decrease count" onClick={() => update({ count: String(Math.max(0, (Number(d.count) || 0) - 1)) })}>−</button>
                  <input id="count" inputMode="numeric" pattern="\d*" aria-describedby="count-hint" value={d.count} onChange={(e) => update({ count: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
                  <button type="button" aria-label="Increase count" onClick={() => update({ count: String(Math.min(100000, (Number(d.count) || 0) + 1)) })}>+</button>
                </div>
                <span id="count-hint" className="hint">Record what you observed. There is no target to aim for on this screen.</span>
              </div>

              <div className="row" style={{ alignItems: "start" }}>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="date">Visit date</label>
                  <input id="date" type="date" className="input" value={d.visitDate} max={localDate()} onChange={(e) => update({ visitDate: e.target.value })} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="method">Capture method</label>
                  <select id="method" className="select" value={d.captureMethod} onChange={(e) => update({ captureMethod: e.target.value as Draft["captureMethod"] })}>
                    {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="field">
                <label htmlFor="notes">Notes</label>
                <textarea id="notes" className="textarea" maxLength={2000} value={d.notes} onChange={(e) => update({ notes: e.target.value })} />
                <span className="hint num">{d.notes.length} / 2,000</span>
              </div>

              <div className="field">
                <span className="label">Photos</span>
                <div className={styles.photos}>
                  {d.photos.map((p) => (
                    <div key={p.fileId} className={styles.photo}>
                      {p.data ? <PhotoThumb data={p.data} mime={p.mime} alt={`Evidence photo, ${bytes(p.bytes)}`} /> : <div className={styles.missing}>Photo missing on this device</div>}
                      <div className={styles.photoMeta}><span className="mono">{shortHash(p.sha256, 6)}</span><button type="button" className="btn btn-ghost" aria-label="Remove photo" onClick={() => update({ photos: d.photos.filter((x) => x.fileId !== p.fileId) })}><Trash2 aria-hidden="true" /></button></div>
                    </div>
                  ))}
                  {d.photos.length < 3 ? (
                    <button type="button" className={styles.addPhoto} onClick={() => fileInput.current?.click()}>
                      <Camera aria-hidden="true" />
                      Take or add photo
                    </button>
                  ) : null}
                </div>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png" capture="environment" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
                <span className="hint">JPEG or PNG, up to 3 photos, 20 MB each. Each photo is fingerprinted with SHA-256 on this device.</span>
              </div>

              {d.photos.length === 0 ? (
                <div className="field">
                  <label htmlFor="exception">No photo? Explain why</label>
                  <input id="exception" className="input" maxLength={MAX_EXCEPTION} value={d.evidenceException} onChange={(e) => update({ evidenceException: e.target.value })} />
                </div>
              ) : null}

              <label className="check">
                <input type="checkbox" checked={d.consent} onChange={(e) => update({ consent: e.target.checked })} />
                <span>The farmer was told how these observations and photos will be used, and agreed.</span>
              </label>

              {issues.length ? (
                <div className="notice notice-error" role="alert"><div className="stack-sm"><strong>Before you finalize</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{issues.map((i) => <li key={i}>{i}</li>)}</ul></div></div>
              ) : null}

              <div className={styles.stickyCta}>
                <button className="btn btn-primary btn-lg btn-block" onClick={openReview} disabled={!device?.deviceKeyId || keyRevoked || !f.cohort.acceptingSubmissions}>
                  Review and finalize
                </button>
                {!f.cohort.acceptingSubmissions ? <span className="hint">This cohort is not accepting submissions.</span> : null}
              </div>
            </section>
          ) : (
            <>
              <Receipt f={f} final={final} stage={stage} busy={busy} online={online} onSync={sync} onDiscard={discard} />
              <Corrections f={f} />
              {f.correction && device?.deviceKeyId ? <CorrectionPanel f={f} device={device} online={online} onDone={refresh} /> : null}
            </>
          )}
        </div>
      </div>

      <Dialog open={reviewing} onClose={() => setReviewing(false)} title="Finalize your original observation">
        <dl className="kv">
          <dt>Farm</dt><dd>{f.farm.pseudonym}</dd>
          <dt>Observed</dt><dd><strong className="num" style={{ fontSize: 20 }}>{d.count}</strong> shade trees</dd>
          <dt>Visit date</dt><dd>{d.visitDate}</dd>
          <dt>Method</dt><dd>{METHODS.find((m) => m.value === d.captureMethod)?.label}</dd>
          <dt>Evidence</dt><dd>{d.photos.length ? d.photos.map((p) => <div key={p.fileId} className="mono">{shortHash(p.sha256, 10)}</div>) : d.evidenceException}</dd>
        </dl>
        <div className="notice notice-pending">This first count is signed on this device and becomes the permanent original. If a reviewer later asks for a correction, it is added as a new signed version and the original stays on every report.</div>
        <label className="check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I confirm this is my original field observation</span>
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => setReviewing(false)}>Keep editing</button>
          <button className="btn btn-primary" onClick={finalize} disabled={!confirmed || busy}>{busy ? "Signing…" : "Finalize original submission"}</button>
        </div>
      </Dialog>
    </>
  );
}

function Receipt({ f, final, stage, busy, online, onSync, onDiscard }: { f: VisitForm; final: SignedFinalization | null; stage: ReturnType<typeof stageOf>; busy: boolean; online: boolean; onSync: () => void; onDiscard: () => void }) {
  const s = f.submissions[0];
  const steps: Array<{ title: string; sub: string; state: "done" | "current" | "failed" | "" }> = [
    { title: "Finalized on this device", sub: final ? `Signed ${formatDate(final.finalizedAt, true)} (device clock, not an independent timestamp)` : "Signed on your device", state: "done" },
    { title: "Received by BlindCount", sub: s ? `Server receipt ${formatDate(s.receivedAt, true)}` : stage === "rejected" ? "Refused by the server" : "Waiting to upload", state: s ? "done" : stage === "rejected" ? "failed" : "current" },
    {
      title: "Blockchain confirmed",
      sub: s?.anchorStatus === "CONFIRMED" ? `Block ${s.anchorBlockNumber}, ${utc(s.anchorConfirmedAt)}` : s?.anchorStatus === "FAILED" ? "Anchoring is being retried by an operator. Your submission is safe on the server." : s ? "Anchoring the salted commitment…" : "After upload",
      state: stage === "sealed" ? "done" : stage === "failed" ? "failed" : s ? "current" : "",
    },
  ];
  const label = { done: "complete", current: "in progress", failed: "needs attention", "": "not started" } as const;
  return (
    <section className="panel panel-pad stack" aria-live="polite">
      <div className="spread">
        <h2 style={{ fontSize: 18 }}>{stage === "sealed" ? "Sealed" : stage === "local" ? "Waiting to sync" : stage === "rejected" ? "Not accepted" : "Submitted"}</h2>
        {stage === "sealed" ? <span className="status status-success"><ShieldCheck aria-hidden="true" />Sealed</span> : stage === "local" ? <span className="status status-pending"><CloudOff aria-hidden="true" />On this device only</span> : stage === "rejected" || stage === "failed" ? <span className="status status-error">Needs attention</span> : <span className="status status-pending">Anchoring</span>}
      </div>
      {stage === "local" ? <div className="notice notice-pending">Finalized and signed on this device. It uploads automatically as soon as you&apos;re online, then gets anchored onchain. Until the server receives it, it isn&apos;t independently timestamped, so don&apos;t clear this browser&apos;s data.</div> : null}
      {stage === "rejected" ? (
        <div className="notice notice-error">
          <div className="stack-sm">
            <span>BlindCount didn&apos;t accept this finalization: {final?.rejected}. Nothing was recorded, so you can discard it and finalize the visit again. Your photos stay on this device.</span>
            <button className="btn btn-secondary" style={{ justifySelf: "start" }} onClick={onDiscard}><RotateCcw aria-hidden="true" /> Discard and redo</button>
          </div>
        </div>
      ) : null}
      <ol className="timeline">
        {steps.map((st) => (
          <li key={st.title} className={st.state}>
            <span className="tl-dot">{st.state === "done" ? <Check aria-hidden="true" /> : null}</span>
            <div><div className="tl-title">{st.title}<span className="sr-only"> ({label[st.state]})</span></div><div className="tl-sub">{st.sub}</div></div>
          </li>
        ))}
      </ol>
      {s ? (
        <dl className="kv">
          <dt>Submitted count</dt><dd className="num">{s.count}</dd>
          <dt>Payload SHA-256</dt><dd className="mono">{s.payloadSha256}</dd>
          <dt>Commitment</dt><dd className="mono">{s.commitment}</dd>
          {s.anchorTxHash ? <><dt>Transaction</dt><dd className="mono">{f.explorerTxUrl ? <a href={`${f.explorerTxUrl}${s.anchorTxHash}`} target="_blank" rel="noreferrer">{s.anchorTxHash}</a> : s.anchorTxHash}</dd></> : null}
        </dl>
      ) : null}
      {stage === "local" ? <button className="btn btn-primary" style={{ justifySelf: "start" }} onClick={onSync} disabled={busy || !online}>{online ? (busy ? "Uploading…" : "Upload now") : "Offline: uploads automatically when connected"}</button> : null}
    </section>
  );
}

function Corrections({ f }: { f: VisitForm }) {
  const later = f.submissions.filter((s) => s.version > 1);
  if (!later.length) return null;
  return (
    <section className="panel panel-pad stack-sm" aria-label="Corrections">
      <h3>Corrections</h3>
      <p className="muted" style={{ fontSize: 14 }}>Each correction is a new signed version anchored after the original. Version 1 stays the permanent original.</p>
      <ul className="stack-sm" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {later.map((s) => (
          <li key={s.submissionId} className="spread" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <span>Version {s.version}: <strong className="num">{s.count}</strong> shade trees</span>
            {s.anchorStatus === "CONFIRMED" ? <span className="status status-success"><ShieldCheck aria-hidden="true" />Anchored</span> : <span className="status status-pending">Anchoring</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Workflow F on the phone: the reviewer's request, a recount, and a new signed version linked to the last. */
function CorrectionPanel({ f, device, online, onDone }: { f: VisitForm; device: DeviceRecord; online: boolean; onDone: () => Promise<unknown> }) {
  const c = f.correction!;
  const [count, setCount] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState<Draft["photos"]>([]);
  const [exception, setException] = useState("");
  const [consent, setConsent] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useQuery({ queryKey: ["amendment-local", f.assignmentId, c.nextVersion], networkMode: "always", gcTime: 0, queryFn: () => loadAmendment(device, f.assignmentId, c.nextVersion) });

  // Already submitted and anchoring: the corrections list above tracks it.
  if (!c.previousSubmissionId || f.submissions.some((s) => s.version === c.nextVersion)) return null;
  const amendment = { version: c.nextVersion, previousSubmissionId: c.previousSubmissionId, reason };
  const draft: Draft = { version: 1, form: f, visitDate: localDate(), count, captureMethod: "walkthrough_count", notes, photos, evidenceException: exception, consent, savedAt: new Date().toISOString() };

  async function submit() {
    const v = validateDraft(device, draft, amendment);
    setIssues(v);
    if (v.length) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await finalizeLocally(device, draft, amendment);
      if (navigator.onLine) await syncFinalization(device, f.assignmentId, signed);
      await pending.refetch();
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (pending.data && !pending.data.receipt) {
    return (
      <section className="panel panel-pad stack-sm">
        <h3>Correction signed</h3>
        <p className="muted">Version {c.nextVersion} is signed on this device and uploads automatically when you&apos;re online.</p>
        {pending.data.rejected ? <div className="notice notice-error">Not accepted: {pending.data.rejected}</div> : null}
      </section>
    );
  }

  return (
    <section className="panel panel-pad stack" aria-label="Correction requested">
      <div className="notice notice-pending">
        <div className="stack-sm">
          <strong>A reviewer asked for a correction</strong>
          <span>{c.reason}</span>
          <span className="subtle" style={{ fontSize: 13 }}>Requested {formatDate(c.requestedAt, true)}. Your original count stays on record; this adds version {c.nextVersion}.</span>
        </div>
      </div>
      {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
      <div className="field">
        <label htmlFor="c-count">Corrected shade-tree count</label>
        <input id="c-count" className="input num" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 6))} style={{ fontSize: 24, maxWidth: 200 }} />
      </div>
      <div className="field">
        <label htmlFor="c-reason">What changed</label>
        <textarea id="c-reason" className="textarea" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="c-notes">Notes</label>
        <textarea id="c-notes" className="textarea" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="field">
        <span className="label">New photos</span>
        <div className="row">
          {photos.map((p) => <span key={p.fileId} className="status"><Camera aria-hidden="true" />{shortHash(p.sha256, 6)}</span>)}
          {photos.length < 3 ? <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}><Camera aria-hidden="true" /> Add photo</button> : null}
        </div>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { const p = await photoFromFile(file); setPhotos((ps) => [...ps, p]); } catch (err) { setError(errorMessage(err)); } }} />
      </div>
      {photos.length === 0 ? (
        <div className="field">
          <label htmlFor="c-exception">No photo? Explain why</label>
          <input id="c-exception" className="input" maxLength={MAX_EXCEPTION} value={exception} onChange={(e) => setException(e.target.value)} />
        </div>
      ) : null}
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>The farmer was told how these observations and photos will be used, and agreed.</span>
      </label>
      {issues.length ? <div className="notice notice-error" role="alert"><ul style={{ margin: 0, paddingLeft: 18 }}>{issues.map((i) => <li key={i}>{i}</li>)}</ul></div> : null}
      <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy}>{busy ? "Signing…" : online ? `Sign and submit version ${c.nextVersion}` : `Sign version ${c.nextVersion} (uploads when online)`}</button>
    </section>
  );
}

function PhotoThumb({ data, mime, alt }: { data: ArrayBuffer; mime: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  // An object URL is a browser resource: create it with the effect and release it in the cleanup.
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([data], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data, mime]);
  return url ? <img src={url} alt={alt} /> : <div className={styles.missing} aria-hidden="true" />;
}
