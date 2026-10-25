"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";

/** Only same-origin paths survive; "/\\evil.com" and "//evil.com" both resolve off-site and are dropped. */
function safeRedirect(next: string | null): string {
  if (!next || typeof window === "undefined") return "/app";
  try {
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin && next.startsWith("/") && !next.includes("\\") ? `${url.pathname}${url.search}` : "/app";
  } catch {
    return "/app";
  }
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const safeNext = safeRedirect(params.get("next"));
  const [now, setNow] = useState(() => Date.now());
  // A one-second tick so the resend button re-enables when its cooldown ends.
  useEffect(() => {
    if (cooldownUntil <= now) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [cooldownUntil, now]);
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  async function start(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ cooldownSeconds: number }>("POST", "/v1/auth/email/start", { email });
      setCooldownUntil(Date.now() + r.cooldownSeconds * 1000);
      setNow(Date.now());
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/v1/auth/email/verify", { email, code: code.trim(), displayName: name.trim() || undefined });
      await qc.refetchQueries({ queryKey: ["me"], type: "all" });
      router.replace(safeNext);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title={step === "email" ? "Sign in to BlindCount" : "Check your email"}
      description={step === "email" ? "We'll email you a six-digit code. No password to remember." : <>We sent a code to <strong>{email}</strong>. It expires in 10 minutes.</>}
    >
      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}
      {step === "email" ? (
        <form className="stack" onSubmit={start}>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || !email}>
            {busy ? "Sending code…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify}>
          <div className="field">
            <label htmlFor="code">Six-digit code</label>
            <input
              id="code"
              className="input num"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              style={{ fontSize: 22, letterSpacing: "0.3em", textAlign: "center" }}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            <span className="hint">Shown to your team. Only needed the first time.</span>
          </div>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length !== 6}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="spread">
            <button type="button" className="btn btn-ghost" onClick={() => setStep("email")}>
              Use a different email
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => start()} disabled={busy || cooldownLeft > 0}>
              {cooldownLeft > 0 ? `Resend in ${cooldownLeft}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}
    </AuthFrame>
  );
}
