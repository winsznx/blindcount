"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { api, errorMessage, get, type Role } from "@/lib/api";
import { useOrg } from "@/lib/use-org";
import { PageHeader } from "@/components/app-shell";
import { Status } from "@/components/status";
import { ErrorState, Loading } from "@/components/states";
import { useReauth } from "@/components/reauth";
import { Dialog } from "@/components/dialog";
import { has, useMe, useOrgRoles } from "@/components/use-me";
import { formatDate } from "@/lib/format";

interface Members {
  members: Array<{ userId: string; email: string; displayName: string; roles: Role[]; status: string }>;
  invitations: Array<{ id: string; email: string; roles: Role[]; expiresAt: string; deliveryStatus: string; expired: boolean }>;
}

const ROLE_COPY: Record<Role, string> = { OWNER: "Owner", MANAGER: "Manager", AUDITOR: "Field auditor", REVIEWER: "Reviewer", CUSTODIAN: "Criterion custodian" };

export default function MembersPage() {
  const org = useOrg();
  const me = useMe();
  const qc = useQueryClient();
  const { roles } = useOrgRoles(org);
  const { guard, dialog } = useReauth();
  const q = useQuery({ queryKey: ["members", org], queryFn: () => get<Members>(`/v1/organizations/${org}/members`) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("AUDITOR");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const isOwner = has(roles, "OWNER");
  const invitable: Role[] = isOwner ? ["AUDITOR", "REVIEWER", "MANAGER", "CUSTODIAN", "OWNER"] : ["AUDITOR", "REVIEWER"];

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setSending(true);
    try {
      await guard(async () => {
        const r = await api<{ deliveryStatus: "SENT" | "FAILED" }>("POST", `/v1/organizations/${org}/invitations`, { email, roles: [role] });
        if (r.deliveryStatus === "SENT") setOk(`Invitation sent to ${email}.`);
        else setError(`The invitation for ${email} was created but the email couldn't be delivered. Use Resend below.`);
      });
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["members", org] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await guard(async () => { await fn(); });
      await qc.invalidateQueries({ queryKey: ["members", org] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      {dialog}
      <PageHeader title="Members" description="People with access to this organization. Removing someone takes effect on their next request." />
      <div className="stack-lg">
        <form className="panel panel-pad stack" onSubmit={invite}>
          <h2 style={{ fontSize: 17 }}>Invite someone</h2>
          {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
          {ok ? <div className="notice notice-success" role="status">{ok}</div> : null}
          <div className="row" style={{ alignItems: "end" }}>
            <div className="field" style={{ flex: 2, minWidth: 220 }}><label htmlFor="inv-email">Email</label><input id="inv-email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}><label htmlFor="inv-role">Role</label>
              <select id="inv-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>{invitable.map((r) => <option key={r} value={r}>{ROLE_COPY[r]}</option>)}</select>
            </div>
            <button className="btn btn-primary" disabled={sending}><UserPlus aria-hidden="true" /> {sending ? "Sending…" : "Send invitation"}</button>
          </div>
          <p className="hint">Invitations are single-use, tied to that email address and expire after 7 days.</p>
        </form>

        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
          <>
            <section className="panel table-wrap">
              <table className="table">
                <thead><tr><th>Member</th><th>Roles</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {q.data!.members.map((m) => (
                    <tr key={m.userId}>
                      <td><strong style={{ fontWeight: 550 }}>{m.displayName}</strong><div className="subtle" style={{ fontSize: 12.5 }}>{m.email}</div></td>
                      <td className="muted">{m.roles.map((r) => ROLE_COPY[r]).join(", ")}</td>
                      <td>{m.status === "ACTIVE" ? <Status tone="success">Active</Status> : <Status tone="neutral">Removed</Status>}</td>
                      <td style={{ textAlign: "right" }}>{isOwner && m.status === "ACTIVE" && m.userId !== me.data?.id ? <button className="btn btn-danger" onClick={() => setRemoving({ userId: m.userId, name: m.displayName })}>Remove</button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            {q.data!.invitations.length ? (
              <section className="panel table-wrap">
                <div className="panel-head"><h2 style={{ fontSize: 17 }}>Pending invitations</h2></div>
                <table className="table">
                  <thead><tr><th>Email</th><th>Role</th><th>Delivery</th><th>Expires</th><th /></tr></thead>
                  <tbody>
                    {q.data!.invitations.map((i) => (
                      <tr key={i.id}>
                        <td>{i.email}</td>
                        <td className="muted">{i.roles.map((r) => ROLE_COPY[r]).join(", ")}</td>
                        <td>{i.deliveryStatus === "FAILED" ? <Status tone="error">Not delivered</Status> : <Status tone="neutral">{i.deliveryStatus === "SENT" ? "Sent" : "Queued"}</Status>}</td>
                        <td className="muted">{i.expired ? "Expired" : formatDate(i.expiresAt)}</td>
                        <td style={{ textAlign: "right" }} className="row">
                          <button className="btn btn-ghost" onClick={() => act(() => api("POST", `/v1/organizations/${org}/invitations`, { email: i.email, roles: i.roles }))}>Resend</button>
                          <button className="btn btn-danger" onClick={() => act(() => api("DELETE", `/v1/organizations/${org}/invitations/${i.id}`))}>Revoke</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </>
        )}
      </div>
      <Dialog open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? ""}?`}>
        <p className="muted">They lose access on their next request, their device keys are revoked, and any pending invitations to them are cancelled. Their past signed submissions stay verifiable.</p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => setRemoving(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => { const r = removing; setRemoving(null); if (r) void act(() => api("DELETE", `/v1/organizations/${org}/members/${r.userId}`)); }}>Remove member</button>
        </div>
      </Dialog>
    </>
  );
}
