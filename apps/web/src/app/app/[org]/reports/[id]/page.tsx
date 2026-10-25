"use client";

import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Download, FileArchive, FileSpreadsheet, FileText, Link2 } from "lucide-react";
import { api, errorMessage, get } from "@/lib/api";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { Status } from "@/components/status";
import { ErrorState, Loading } from "@/components/states";
import { has, useOrgRoles } from "@/components/use-me";
import { formatDate, titleCase } from "@/lib/format";

interface Report { id: string; version: number; status: string; manifestSha256: string; generatedAt: string; assignmentCode: string; farmPseudonym: string; cohortCode: string; shareGrants: Array<{ id: string; recipientHint: string; expiresAt: string; downloadLimit: number; downloadsUsed: number }> }

export default function ReportPage() {
  const org = useOrg();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { roles } = useOrgRoles(org);
  const q = useQuery({ queryKey: ["report", id], queryFn: () => get<Report>(`/v1/reports/${id}`) });
  const [recipient, setRecipient] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const dl = (format: string) => `/v1/reports/${id}/download?format=${format}`;

  async function share() {
    setError(null);
    try {
      const g = await api<{ url: string }>("POST", `/v1/reports/${id}/share-grants`, { recipientHint: recipient, expiresInHours: 72, downloadLimit: 3 });
      setLink(g.url);
      setRecipient("");
      await qc.invalidateQueries({ queryKey: ["report", id] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader title={`Report for ${r.farmPseudonym}`} back={{ href: `/app/${org}/reports`, label: "Reports" }} description={`${r.assignmentCode}, cohort ${r.cohortCode}. Version ${r.version}, generated ${formatDate(r.generatedAt, true)}.`} actions={<Status tone={r.status === "APPROVED" ? "success" : r.status === "DISPUTED" ? "error" : "pending"}>{titleCase(r.status)}</Status>} />
      <div className="stack-lg" style={{ maxWidth: 820 }}>
        {r.status !== "APPROVED" ? <div className="notice notice-pending">This report is not approved. The PDF carries a {r.status === "DISPUTED" ? "DISPUTED" : "NOT APPROVED"} watermark.</div> : null}
        <section className="panel">
          <div className="panel-head"><h2 style={{ fontSize: 17 }}>Downloads</h2></div>
          <div className="panel-pad stack">
            <div className="row">
              <a className="btn btn-secondary" href={dl("pdf")}><FileText aria-hidden="true" /> Report PDF</a>
              <a className="btn btn-secondary" href={dl("csv")}><FileSpreadsheet aria-hidden="true" /> CSV row</a>
              <a className="btn btn-primary" href={dl("zip")}><FileArchive aria-hidden="true" /> Proof packet (ZIP)</a>
            </div>
            <p className="hint">The packet contains the disclosed criterion and its salt, so share it only with the intended verifier. Every download is logged.</p>
            <dl className="kv"><dt>Manifest SHA-256</dt><dd className="mono">{r.manifestSha256}</dd></dl>
          </div>
        </section>

        {has(roles, "MANAGER") ? (
          <section className="panel">
            <div className="panel-head"><h2 style={{ fontSize: 17 }}>Share with a verifier</h2></div>
            <div className="panel-pad stack">
              {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
              <div className="row" style={{ alignItems: "end" }}>
                <div className="field" style={{ flex: 1, minWidth: 220 }}>
                  <label htmlFor="recipient">Recipient</label>
                  <input id="recipient" className="input" placeholder="e.g. Buyer sustainability team" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={share} disabled={recipient.trim().length < 2}><Link2 aria-hidden="true" /> Create link</button>
              </div>
              <p className="hint">Links expire after 72 hours and allow 3 downloads. They don&apos;t need a BlindCount account.</p>
              {link ? (
                <div className="notice notice-success" style={{ alignItems: "center" }}>
                  <span className="mono" style={{ flex: 1 }}>{link}</span>
                  <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(link).catch(() => setError("Couldn't copy automatically. Select the link and copy it."))}><Copy aria-hidden="true" /> Copy</button>
                </div>
              ) : null}
              {r.shareGrants.length ? (
                <table className="table">
                  <thead><tr><th>Recipient</th><th>Expires</th><th>Downloads</th><th /></tr></thead>
                  <tbody>{r.shareGrants.map((g) => (
                    <tr key={g.id}><td>{g.recipientHint}</td><td className="muted">{formatDate(g.expiresAt, true)}</td><td className="num">{g.downloadsUsed} / {g.downloadLimit}</td>
                      <td style={{ textAlign: "right" }}><button className="btn btn-danger" onClick={async () => { try { await api("DELETE", `/v1/share-grants/${g.id}`); await qc.invalidateQueries({ queryKey: ["report", id] }); } catch (e) { setError(errorMessage(e)); } }}>Revoke</button></td></tr>
                  ))}</tbody>
                </table>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="panel panel-pad stack-sm">
          <h3>How a verifier checks it</h3>
          <p className="muted">They open <a href="/verify">/verify</a> and drop the ZIP, or run <span className="mono">blindcount-verify --packet file.zip --rpc &lt;their RPC&gt;</span>. Nothing is uploaded to BlindCount.</p>
          <a className="btn btn-ghost" style={{ justifySelf: "start" }} href={dl("zip")}><Download aria-hidden="true" /> Download packet to test</a>
        </section>
      </div>
    </>
  );
}
