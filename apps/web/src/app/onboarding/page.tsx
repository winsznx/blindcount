"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";

export default function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("CI");
  const [tz, setTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await api<{ id: string }>("POST", "/v1/organizations", { name, countryCode: country.toUpperCase(), timeZone: tz, privacyAcknowledged: ack });
      await qc.refetchQueries({ queryKey: ["me"], type: "all" });
      router.replace(`/app/${org.id}/overview`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Create your organization" description="You'll be its owner, manager and criterion custodian. Invite auditors and reviewers next. If you were invited to an existing organization, open the link in your invitation email instead.">
      {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="org">Organization name</label>
          <input id="org" className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: "0 0 110px" }}>
            <label htmlFor="cc">Country</label>
            <input id="cc" className="input" required pattern="[A-Za-z]{2}" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="tz">Time zone</label>
            <input id="tz" className="input" required value={tz} onChange={(e) => setTz(e.target.value)} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} required />
          <span>
            I&apos;ll only enter fictional data or field data collected with the farmer&apos;s documented consent. <a href="/privacy">Data handling</a>
          </span>
        </label>
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !ack}>
          {busy ? "Creating…" : "Create organization"}
        </button>
      </form>
    </AuthFrame>
  );
}
