"use client";

import { useQuery } from "@tanstack/react-query";
import { PublicShell } from "@/components/public-shell";
import { Status } from "@/components/status";
import { get } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface SystemStatus { database: boolean; chain: { ok: boolean; chainId: number | null; blockNumber: string | null; error: string | null; relayerFunded: boolean | null }; jobs: Record<string, number>; openAlerts: number; ai: string; checkedAt: string }

export default function StatusPage() {
  const q = useQuery({ queryKey: ["status"], queryFn: () => get<SystemStatus>("/v1/system/status"), refetchInterval: 15_000, retry: false });
  const s = q.data;
  return (
    <PublicShell>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "56px 16px 0" }} className="stack-lg">
        <h1>System status</h1>
        {q.error ? <div className="notice notice-error">The API is not responding. Field drafts and finalized visits stay on your device until it is back.</div> : null}
        {s ? (
          <div className="panel">
            <table className="table">
              <tbody>
                <tr><td>API and database</td><td style={{ textAlign: "right" }}>{s.database ? <Status tone="success">Operational</Status> : <Status tone="error">Unavailable</Status>}</td></tr>
                <tr><td>Blockchain {s.chain.chainId ? `(chain ${s.chain.chainId}, block ${s.chain.blockNumber})` : ""}</td><td style={{ textAlign: "right" }}>{s.chain.ok ? <Status tone="success">Reachable</Status> : <Status tone="error">{s.chain.error ?? "Unreachable"}</Status>}</td></tr>
                <tr><td>Relayer gas</td><td style={{ textAlign: "right" }}>{s.chain.relayerFunded === null ? <Status tone="neutral">Unknown</Status> : s.chain.relayerFunded ? <Status tone="success">Funded</Status> : <Status tone="error">Empty</Status>}</td></tr>
                <tr><td>Anchoring queue</td><td style={{ textAlign: "right" }} className="num muted">{Object.entries(s.jobs).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(", ") || "empty"}</td></tr>
                <tr><td>Open operator alerts</td><td style={{ textAlign: "right" }} className="num">{s.openAlerts}</td></tr>
                <tr><td>AI evidence checks</td><td style={{ textAlign: "right" }}><Status tone="neutral">{s.ai === "configured" ? "Configured" : "Disabled"}</Status></td></tr>
              </tbody>
            </table>
          </div>
        ) : null}
        {s ? <p className="subtle">Checked {formatDate(s.checkedAt, true)}. If the chain is unreachable, submissions are kept as anchoring and closure is blocked; nothing is reported as sealed.</p> : null}
      </div>
    </PublicShell>
  );
}
