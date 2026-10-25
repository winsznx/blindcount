"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiFailure, errorMessage, get } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";
import { useMe } from "@/components/use-me";
import { Loading } from "@/components/states";

export default function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => get<{ organizationName: string; roles: string[]; expired: boolean; emailHint: string }>(`/v1/invitations/${token}`), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedOut = me.error instanceof ApiFailure && me.error.status === 401;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ organizationId: string; roles: string[] }>("POST", `/v1/invitations/${token}/accept`);
      await qc.refetchQueries({ queryKey: ["me"], type: "all" });
      router.replace(`/app/${r.organizationId}/${r.roles.every((x) => x === "AUDITOR") ? "visits" : "overview"}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (invite.isLoading) return <AuthFrame title="Invitation"><Loading rows={2} /></AuthFrame>;
  if (invite.error || !invite.data)
    return (
      <AuthFrame title="This invitation is no longer valid" description="It may have been used, replaced or revoked. Ask the person who invited you to send a new one.">
        <Link href="/" className="btn btn-secondary">Go to BlindCount</Link>
      </AuthFrame>
    );
  const inv = invite.data;
  return (
    <AuthFrame title={`Join ${inv.organizationName}`} description={<>You&apos;ve been invited as {inv.roles.map((r) => r.toLowerCase()).join(" and ")}. The invitation was sent to {inv.emailHint}.</>}>
      {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
      {inv.expired ? (
        <div className="notice notice-error">This invitation expired. Ask for a new one.</div>
      ) : signedOut ? (
        <Link className="btn btn-primary btn-lg btn-block" href={`/sign-in?next=/invite/${token}`}>
          Sign in to accept
        </Link>
      ) : (
        <button className="btn btn-primary btn-lg btn-block" onClick={accept} disabled={busy || me.isLoading}>
          {busy ? "Joining…" : `Accept as ${me.data?.email ?? ""}`}
        </button>
      )}
    </AuthFrame>
  );
}
