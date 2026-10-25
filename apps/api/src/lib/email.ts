import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "./config";

export type Outbox = (to: string, subject: string, body: string) => Promise<void>;

/** Development: a private, append-only file. Never stdout, so codes don't end up in shared logs. */
export function fileOutbox(path: string): Outbox {
  return async (to, subject, body) => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), to, subject, body })}\n`, { mode: 0o600 });
  };
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Production: Resend's HTTP API. Throws on failure so callers record delivery status honestly. */
export function resendOutbox(cfg: Pick<Config, "RESEND_API_KEY" | "EMAIL_FROM">): Outbox {
  return async (to, subject, body) => {
    const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#142620"><p style="font-weight:600;font-size:16px">BlindCount</p>${body
      .split("\n")
      .map((line) => `<p style="font-size:15px;line-height:1.5">${escape(line).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#173B31">$1</a>')}</p>`)
      .join("")}<p style="font-size:12px;color:#586A62">You received this because someone used this address on BlindCount. If that wasn't you, ignore this email.</p></div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${cfg.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: cfg.EMAIL_FROM, to: [to], subject, text: body, html }),
    });
    if (!res.ok) throw new Error(`email provider responded ${res.status}`);
  };
}
