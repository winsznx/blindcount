"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage, get } from "@/lib/api";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { Status } from "@/components/status";
import { Empty, ErrorState, Loading } from "@/components/states";
import { useMe } from "@/components/use-me";
import { forgetDevice, loadDevice, storageEstimate } from "@/lib/device";
import { pendingOnDevice } from "@/lib/field";
import { Dialog } from "@/components/dialog";
import { bytes, formatDate } from "@/lib/format";

interface Device { id: string; label: string; userEmail: string; mine: boolean; enrolledAt: string; revokedAt: string | null; attestationLevel: string }

export default function Devices() {
  const org = useOrg();
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["devices", org], queryFn: () => get<Device[]>(`/v1/organizations/${org}/devices`) });
  const quota = useQuery({ queryKey: ["quota"], queryFn: storageEstimate });
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Device | null>(null);
  const waiting = useQuery({
    queryKey: ["pending-on-device", org, me.data?.id],
    enabled: !!me.data,
    queryFn: async () => {
      const device = me.data ? await loadDevice(org, me.data.id) : null;
      return new Set(device ? await pendingOnDevice(device) : []);
    },
  });

  async function revoke(d: Device) {
    setError(null);
    try {
      await api("DELETE", `/v1/organizations/${org}/devices/${d.id}`);
      if (d.mine && me.data) await forgetDevice(org, me.data.id);
      await qc.invalidateQueries({ queryKey: ["devices", org] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader title="Devices" description="Signing keys enrolled for field submissions. A revoked key can't finalize new observations; past signatures stay verifiable." />
      <div className="stack-lg">
        {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : !q.data?.length ? (
          <Empty title="No devices enrolled">Field auditors enroll a device the first time they open a visit.</Empty>
        ) : (
          <section className="panel table-wrap">
            <table className="table">
              <thead><tr><th>Device</th><th>Person</th><th>Key type</th><th>Enrolled</th><th>Status</th><th /></tr></thead>
              <tbody>
                {q.data.map((d) => (
                  <tr key={d.id}>
                    <td><strong style={{ fontWeight: 550 }}>{d.label}</strong>{d.mine ? <div className="subtle" style={{ fontSize: 12.5 }}>Yours</div> : null}</td>
                    <td className="muted">{d.userEmail}</td>
                    <td className="muted">Software key (WebCrypto P-256)</td>
                    <td className="muted">{formatDate(d.enrolledAt)}</td>
                    <td>{d.revokedAt ? <Status tone="neutral">Revoked</Status> : <Status tone="success">Active</Status>}</td>
                    <td style={{ textAlign: "right" }}>{!d.revokedAt ? <button className="btn btn-danger" onClick={() => setConfirming(d)}>Revoke</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <section className="panel panel-pad stack-sm">
          <h3>Storage on this browser</h3>
          <p className="muted">{quota.data ? `${bytes(quota.data.usage)} used of about ${bytes(quota.data.quota)} available.` : "Storage estimate unavailable in this browser."} Finalized visits upload automatically when you&apos;re online; don&apos;t clear this site&apos;s data while any are waiting.</p>
          <p className="hint">Keys are not hardware-attested. BlindCount does not claim device identity beyond possession of this browser key.</p>
        </section>
      </div>
      <Dialog open={!!confirming} onClose={() => setConfirming(null)} title={`Revoke ${confirming?.label ?? "this device"}?`}>
        <p className="muted">This key can no longer sign new submissions. Everything it already signed stays verifiable.</p>
        {confirming?.mine && (waiting.data?.size ?? 0) > 0 ? (
          <div className="notice notice-error">{waiting.data!.size} finalized visit{waiting.data!.size === 1 ? " is" : "s are"} still waiting to upload from this device. Revoking now means {waiting.data!.size === 1 ? "it" : "they"} will be refused and must be redone. Upload first.</div>
        ) : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => setConfirming(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => { const d = confirming; setConfirming(null); if (d) void revoke(d); }}>Revoke key</button>
        </div>
      </Dialog>
    </>
  );
}
