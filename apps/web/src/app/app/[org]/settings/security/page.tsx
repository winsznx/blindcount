"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Status } from "@/components/status";
import { Download } from "lucide-react";
import { api, errorMessage, get, type ChainConfig } from "@/lib/api";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { ErrorState, Loading } from "@/components/states";
import { formatDate, utc } from "@/lib/format";

interface Org { id: string; name: string; retentionDays: number; dataPolicyVersion: string; countryCode: string; timeZone: string }
interface Job { id: string; kind: string; state: string; attempts: number; txHash: string | null; lastError: string | null; nextRetryAt: string; createdAt: string }

const JOB_LABEL: Record<string, string> = {
  publish_cohort: "Publish cohort",
  anchor_submission: "Anchor submission",
  close_cohort: "Close cohort",
  record_disclosure: "Record disclosure",
  void_assignment: "Void assignment",
  evidence_checks: "Evidence checks",
};

interface AuditEvent { id: string; actorId: string | null; actorType: string; action: string; objectType: string; objectId: string | null; traceId: string; recordedAt: string }

export default function Security() {
  const org = useOrg();
  const o = useQuery({ queryKey: ["org", org], queryFn: () => get<Org>(`/v1/organizations/${org}`) });
  const chain = useQuery({ queryKey: ["chain-config"], queryFn: () => get<ChainConfig>("/v1/system/chain-config") });
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["jobs", org], queryFn: () => get<Job[]>(`/v1/organizations/${org}/jobs`), refetchInterval: 5000 });
  const [jobError, setJobError] = useState<string | null>(null);
  async function requeue(id: string) {
    setJobError(null);
    try {
      await api("POST", `/v1/jobs/${id}/requeue`);
      await qc.invalidateQueries({ queryKey: ["jobs", org] });
    } catch (e) {
      setJobError(errorMessage(e));
    }
  }
  const events = useQuery({ queryKey: ["audit", org], queryFn: () => get<AuditEvent[]>(`/v1/organizations/${org}/audit-events`) });
  return (
    <>
      <PageHeader title="Security and retention" description="Trust assumptions, retention and the organization's append-only audit trail." />
      <div className="stack-lg">
        <section className="panel panel-pad stack">
          <h2 style={{ fontSize: 17 }}>Trust model for this prototype</h2>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Criteria are encrypted with an application-managed key, separate from other data. Platform operators could technically access it; customer-managed keys are not implemented.</li>
            <li>The organization&apos;s relayer pays gas and attests device enrollment. Verifiers rely on the published report signing key below.</li>
            <li>The void second-approver key is also server-held in this release; both approvals are recorded with distinct people in the audit trail.</li>
          </ul>
          {chain.data ? (
            <dl className="kv">
              <dt>Network</dt><dd>{chain.data.chainName} ({chain.data.chainId})</dd>
              <dt>Registry</dt><dd className="mono">{chain.data.registryAddress}</dd>
              <dt>Report signing key</dt><dd className="mono">{chain.data.reportSigningKeyFingerprint}</dd>
              <dt>Relayer</dt><dd className="mono">{chain.data.relayerAddress}</dd>
            </dl>
          ) : null}
        </section>
        {o.data ? (
          <section className="panel panel-pad">
            <dl className="kv">
              <dt>Retention</dt><dd>{o.data.retentionDays} days (prototype default, confirm before production)</dd>
              <dt>Data policy</dt><dd>{o.data.dataPolicyVersion}</dd>
              <dt>Time zone</dt><dd>{o.data.timeZone}</dd>
            </dl>
          </section>
        ) : null}
        <section className="panel" id="chain-queue">
          <div className="panel-head"><h2 style={{ fontSize: 17 }}>Chain queue</h2><span className="subtle" style={{ fontSize: 13 }}>Transactions the relayer is sending or retrying</span></div>
          {jobError ? <div className="panel-pad"><div className="notice notice-error" role="alert">{jobError}</div></div> : null}
          {jobs.data && jobs.data.length === 0 ? <div className="panel-pad"><p className="muted">Nothing waiting. Every queued transaction has confirmed.</p></div> : null}
          {jobs.data?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Job</th><th>State</th><th>Attempts</th><th>Last error</th><th /></tr></thead>
                <tbody>{jobs.data.map((j) => (
                  <tr key={j.id}>
                    <td>{JOB_LABEL[j.kind] ?? j.kind}<div className="subtle" style={{ fontSize: 12.5 }}>{formatDate(j.createdAt, true)}</div></td>
                    <td>{j.state === "DEAD" ? <Status tone="error">Stopped</Status> : j.state === "FAILED" ? <Status tone="pending">Retrying</Status> : j.state === "RUNNING" ? <Status tone="active">Sending</Status> : <Status tone="neutral">Queued</Status>}</td>
                    <td className="num">{j.attempts}</td>
                    <td className="muted" style={{ fontSize: 13, maxWidth: 360 }}>{j.lastError ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{j.state === "DEAD" || j.state === "FAILED" ? <button className="btn btn-secondary" onClick={() => requeue(j.id)}>Retry now</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head"><h2 style={{ fontSize: 17 }}>Audit trail</h2><a className="btn btn-secondary" href={`/v1/organizations/${org}/audit-events?format=csv`}><Download aria-hidden="true" /> Export CSV</a></div>
          {events.isLoading ? <div className="panel-pad"><Loading /></div> : events.error ? <div className="panel-pad"><ErrorState error={events.error} /></div> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Action</th><th>Object</th><th>Actor</th><th>Trace</th></tr></thead>
                <tbody>{events.data!.slice(0, 100).map((e) => (
                  <tr key={e.id}><td className="muted" title={utc(e.recordedAt)}>{formatDate(e.recordedAt, true)}</td><td>{e.action}</td><td className="muted">{e.objectType}</td><td className="muted">{e.actorType}</td><td className="mono subtle">{e.traceId.slice(0, 14)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
