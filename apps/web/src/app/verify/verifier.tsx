"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { CheckCircle2, CircleHelp, FileArchive, ShieldAlert, ShieldCheck, ShieldQuestion, XCircle } from "lucide-react";
import { rpcChainReader, unzipPacket, verifyPacket, type VerificationResult } from "@blindcount/domain";
import { get, type ChainConfig } from "@/lib/api";
import styles from "./verify.module.css";

const CHECK_LABEL: Record<string, string> = {
  manifest: "Manifest signature",
  issuer: "Issuer (registry and signing key)",
  fileHashes: "File digests",
  payloadCanonicalization: "Observation payload (RFC 8785)",
  auditorDeviceSignature: "Auditor device signature",
  deviceEnrollmentProvenance: "Device enrollment attestation",
  targetCommitment: "Criterion commitment",
  observationCommitment: "Observation commitment onchain",
  chainCanonicality: "Anchor transaction",
  reviewChain: "Review and evidence chain",
};

const VERDICT = {
  VERIFIED_INTEGRITY: { cls: "ok", icon: ShieldCheck, title: "Verified integrity", body: "Every file, signature and commitment matches, and the registry on the chain you queried agrees." },
  INVALID: { cls: "bad", icon: ShieldAlert, title: "Integrity failed", body: "At least one digest, signature or onchain commitment doesn't match. See the failed checks below." },
  VALID_LOCAL_ONLY: { cls: "unk", icon: ShieldQuestion, title: "Valid locally, chain not checked", body: "The packet is internally consistent, but the blockchain was not reachable. This is not a final verification." },
  UNABLE_TO_VERIFY: { cls: "unk", icon: ShieldQuestion, title: "Unable to verify", body: "Something required for verification is missing or unsupported." },
} as const;

export function Verifier() {
  const chain = useQuery({ queryKey: ["chain-config"], queryFn: () => get<ChainConfig>("/v1/system/chain-config"), retry: false });
  const [rpc, setRpc] = useState("");
  const [trustedKey, setTrustedKey] = useState<string | null>(null);
  const [trustedRegistry, setTrustedRegistry] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const rpcUrl = rpc || chain.data?.rpcHint || "";
  // Default trust anchors are what this deployment publishes; the verifier can change or clear them.
  const keyPin = trustedKey ?? chain.data?.reportSigningKeyFingerprint ?? "";
  const registryPin = trustedRegistry ?? chain.data?.registryAddress ?? "";

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const files = unzipPacket(new Uint8Array(await file.arrayBuffer()));
      setResult(await verifyPacket(files, { chain: rpcUrl ? rpcChainReader(rpcUrl) : null, trustedReportKeyFingerprint: keyPin.trim() || undefined, trustedRegistryAddress: registryPin.trim() || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this file.");
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void handle(e.dataTransfer.files[0]);
  };
  const v = result ? VERDICT[result.integrity] : null;

  return (
    <div className="stack-lg">
      <div className="panel panel-pad stack">
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: 2, minWidth: 240 }}>
            <label htmlFor="rpc">RPC endpoint you trust</label>
            <input id="rpc" className="input mono" placeholder={chain.data?.rpcHint ?? "https://sepolia.base.org"} value={rpc} onChange={(e) => setRpc(e.target.value)} />
            <span className="hint">Leave empty to use the packet issuer&apos;s hint{chain.data?.rpcHint ? "" : " (none configured; chain checks will be skipped)"}.</span>
          </div>
        </div>
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="registry">Issuer registry address</label>
            <input id="registry" className="input mono" placeholder="0x…" value={registryPin} onChange={(e) => setTrustedRegistry(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="key">Issuer signing key fingerprint</label>
            <input id="key" className="input mono" placeholder="sha256…" value={keyPin} onChange={(e) => setTrustedKey(e.target.value)} />
          </div>
        </div>
        <p className="hint" style={{ marginTop: -6 }}>Prefilled with what this site publishes. For a packet from another organization, use the registry and fingerprint they give you directly; clear both to check the packet without pinning an issuer.</p>
        <label className={`${styles.drop} ${drag ? styles.dragging : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
          <FileArchive aria-hidden="true" />
          <strong>{busy ? "Verifying…" : fileName ?? "Drop a proof packet here"}</strong>
          <span className="muted">or choose a .zip file</span>
          <input type="file" accept=".zip,application/zip" className="sr-only" onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>

      {error ? <div className="notice notice-error" role="alert"><XCircle aria-hidden="true" />{error}</div> : null}

      {result && v ? (
        <div className="stack" aria-live="polite">
          <div className={styles.verdicts}>
            <div className={`${styles.verdict} ${styles[v.cls]}`}>
              <v.icon aria-hidden="true" />
              <div><span className={styles.vLabel}>Integrity</span><h2>{v.title}</h2><p>{v.body}</p></div>
            </div>
            <div className={`${styles.verdict} ${styles.neutral}`}>
              <CircleHelp aria-hidden="true" />
              <div><span className={styles.vLabel}>Factual review</span><h2>{result.reviewState === "REVIEWED" ? "Reviewed" : result.reviewState === "DISPUTED" ? "Disputed" : "Under review"}</h2><p>{result.disclaimer}</p></div>
            </div>
          </div>

          <section className="panel">
            <div className="panel-head"><h3>Checks</h3><span className="subtle" style={{ fontSize: 13 }}>{result.summary.sourceType === "SIMULATED_DEMO" ? "Simulated demo data" : "Field data"}</span></div>
            <ul className={styles.checks}>
              {result.checks.map((c) => (
                <li key={c.name} className={styles[c.status]}>
                  {c.status === "PASS" ? <CheckCircle2 aria-hidden="true" /> : c.status === "FAIL" ? <XCircle aria-hidden="true" /> : <CircleHelp aria-hidden="true" />}
                  <div><strong>{CHECK_LABEL[c.name] ?? c.name}</strong><span className="sr-only"> {c.status}</span><p className="muted">{c.detail}</p></div>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel panel-pad">
            <dl className="kv">
              <dt>Report</dt><dd className="mono">{result.summary.reportId}</dd>
              <dt>Original count</dt><dd className="num">{result.summary.originalCount ?? "—"}</dd>
              <dt>Versions</dt><dd className="num">{result.summary.versions ?? "—"}</dd>
              <dt>Chain and registry</dt><dd className="mono">{result.summary.chainId} · {result.summary.registryAddress}</dd>
              <dt>Anchor transactions</dt><dd className="mono">{result.summary.anchorTxHashes?.join(", ") || "—"}</dd>
              <dt>Signing key</dt><dd className="mono">{result.summary.reportSigningKeyFingerprint}</dd>
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}
