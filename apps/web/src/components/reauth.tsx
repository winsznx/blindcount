"use client";

import { useState, type FormEvent } from "react";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { Dialog } from "./dialog";
import { useMe } from "./use-me";

interface Pending {
  run: () => Promise<void>;
  resolve: (completed: boolean) => void;
  reject: (e: unknown) => void;
}

/**
 * Wraps a sensitive action. If the server answers REAUTH_REQUIRED, the person confirms a fresh
 * email code and the action is retried once (FR-006). guard() resolves only after the action has
 * really run (true) or was cancelled (false), so callers refresh and report errors at the right time.
 */
export function useReauth() {
  const me = useMe();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function guard(run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (e) {
      if (!(e instanceof ApiFailure && e.code === "REAUTH_REQUIRED")) throw e;
      setSent(false);
      setCode("");
      setError(null);
      return new Promise<boolean>((resolve, reject) => setPending({ run, resolve, reject }));
    }
  }

  function cancel() {
    pending?.resolve(false);
    setPending(null);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/v1/auth/email/start", { email: me.data?.email });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/v1/auth/email/verify", { email: me.data?.email, code });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    const p = pending;
    setPending(null);
    setBusy(false);
    if (!p) return;
    try {
      await p.run();
      p.resolve(true);
    } catch (err) {
      p.reject(err);
    }
  }

  const dialog = (
    <Dialog open={!!pending} onClose={cancel} title="Confirm it's you">
      <p className="muted">This action discloses or decides on confidential results, so it needs a sign-in from the last 15 minutes.</p>
      {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
      {!sent ? (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={cancel}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={busy}>Email me a code</button>
        </div>
      ) : (
        <form className="stack" onSubmit={confirm}>
          <div className="field">
            <label htmlFor="reauth-code">Code sent to {me.data?.email}</label>
            <input id="reauth-code" className="input num" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || code.length !== 6}>Confirm and continue</button>
          </div>
        </form>
      )}
    </Dialog>
  );
  return { guard, dialog };
}
