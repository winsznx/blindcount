import PDFDocument from "pdfkit";
import { zipSync } from "fflate";
import type { Hex } from "viem";
import { canonicalize, sha256Hex, signCanonical, type CriterionObject, type FinalizationMessage } from "@blindcount/crypto";
import { jwkFingerprint, INTEGRITY_DISCLAIMER, PACKET_SCHEMA, type PacketDeviceKeys, type PacketManifest, type PacketProofs, type PacketSignatures } from "@blindcount/domain";
import type { ObservationPayload } from "@blindcount/domain";
import type { AppContext } from "./context";
import { csvRow } from "./csv";

export const CSV_HEADER =
  "report_id,programme_code,cohort_code,assignment_code,farm_pseudonym,visit_date,original_count,accepted_count,criterion_operator,criterion_value,outcome,review_state,amendment_count,anchor_tx,anchor_chain_id,integrity_status,report_created_at";

export interface ReportInputs {
  reportId: string;
  version: number;
  generatedAt: Date;
  status: "APPROVED" | "DISPUTED" | "PROVISIONAL";
  programme: { code: string; name: string; crop: string; regionLabel: string; dataSource: string };
  cohort: { code: string; name: string; cohortKey: Hex; targetCommitment: Hex; closeTxHash: string | null };
  assignment: { code: string; assignmentKey: Hex; farmPseudonym: string };
  auditor: { id: string; displayName: string };
  reviewer: { displayName: string } | null;
  review: { decision: string | null; reason: string | null; decidedAt: Date | null; flagNotes: Array<{ code: string; reason: string; label: string | null }> };
  versions: Array<{
    submissionId: string;
    payload: ObservationPayload;
    payloadSha256: string;
    submissionSalt: Hex;
    commitment: Hex;
    anchorTxHash: Hex | null;
    anchorBlockNumber: bigint | null;
    receivedAt: Date;
    deviceKeyId: string;
    signature: string;
    signatureFormat: string;
    clientNonce: string;
  }>;
  criterion: { object: CriterionObject; salt: Hex } | null;
  /** Deterministic comparison of the original (version 1) count. */
  evaluation: { result: string; targetCount: number; observedCount: number; ruleVersion: string } | null;
  /** Comparison of the version the reviewer accepted; equals `evaluation` when the original was accepted. */
  acceptedEvaluation: { result: string; targetCount: number; observedCount: number; ruleVersion: string } | null;
  acceptedVersionNumber: number | null;
  deviceKeys: PacketDeviceKeys["keys"];
  evidence: Array<{ fileId: string; mime: string; sha256: string; bytes: Buffer }>;
}

/**
 * The built-in PDF fonts only cover Windows-1252, and pdfkit corrupts the rest of a run when it meets
 * a wider character. Non-covered characters are shown as "?" here; the CSV and packet keep exact text.
 */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ≥");
export function pdfSafe(text: string): string {
  return Array.from(text, (ch) => {
    const code = ch.codePointAt(0)!;
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch) || ch === "\n" ? ch : "?";
  }).join("");
}

function pdf(inputs: ReportInputs, ctx: AppContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Fixed CreationDate keeps output deterministic for a given input.
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `BlindCount field verification report ${inputs.reportId}`, Author: "BlindCount", CreationDate: inputs.generatedAt } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const green = "#173B31";
    const muted = "#586A62";
    const first = inputs.versions[0]!;
    const accepted = inputs.versions.find((v) => v.payload.version === inputs.acceptedVersionNumber) ?? null;

    if (inputs.status !== "APPROVED") {
      doc.save().rotate(-30, { origin: [300, 420] }).fontSize(64).fillColor("#A53633").opacity(0.15).text(inputs.status === "DISPUTED" ? "DISPUTED" : "NOT APPROVED", 60, 380, { width: 500, align: "center" }).restore().opacity(1);
    }
    doc.fillColor(green).fontSize(18).text("Field verification report", { continued: false });
    doc.fillColor(muted).fontSize(9).text(`CONFIDENTIAL · ${inputs.programme.dataSource === "SIMULATED_DEMO" ? "SIMULATED DEMO DATA, NOT A REAL FIELD MEASUREMENT" : "FIELD DATA"}`);
    doc.moveDown();

    const row = (k: string, v: string) => {
      doc.fillColor(muted).fontSize(9).text(pdfSafe(k), { continued: true, width: 160 }).fillColor("#142620").text(`  ${pdfSafe(v)}`);
    };
    row("Programme", `${inputs.programme.name} (${inputs.programme.code}), ${inputs.programme.crop}, ${inputs.programme.regionLabel}`);
    row("Cohort", `${inputs.cohort.name} (${inputs.cohort.code})`);
    row("Farm (pseudonym)", inputs.assignment.farmPseudonym);
    row("Assignment", inputs.assignment.code);
    row("Inspection date", first.payload.visitDate);
    row("Auditor", `${inputs.auditor.displayName} (${inputs.auditor.id.slice(0, 8)})`);
    row("Reviewer", inputs.reviewer?.displayName ?? "Not yet reviewed");
    row("Review date", inputs.review.decidedAt?.toISOString() ?? "n/a");
    row("Report", `${inputs.reportId} v${inputs.version} · status ${inputs.status}`);
    doc.moveDown();

    doc.fillColor(green).fontSize(12).text("Methodology");
    doc.fillColor("#142620").fontSize(9).text(
      `The auditor recorded an observed shade-tree count without access to the programme criterion, which stayed hidden until every assignment in the cohort was sealed or voided and the cohort was closed onchain. Capture method: ${first.payload.captureMethod.replace(/_/g, " ")}.`,
    );
    doc.moveDown();
    doc.fillColor(green).fontSize(12).text("Observation");
    row("Original submitted count", `${first.payload.count} ${first.payload.unit.replace("_", " ")}`);
    row("Accepted count", accepted ? `${accepted.payload.count} (version ${accepted.payload.version}${accepted.payload.version === 1 ? ", the original" : ", an accepted correction"})` : "Not accepted (see review)");
    row("Corrections", `${inputs.versions.length - 1}`);
    for (const v of inputs.versions.slice(1)) row(`Correction v${v.payload.version}`, `${v.payload.count} trees. Reason: ${v.payload.amendmentReason ?? ""}`);
    row("Evidence files", first.payload.evidence.length ? first.payload.evidence.map((e) => `${e.fileId.slice(0, 8)} sha256:${e.sha256.slice(0, 16)}…`).join("; ") : `None. Exception: ${first.payload.evidenceException ?? ""}`);
    if (first.payload.notes) row("Field notes", first.payload.notes.slice(0, 600));
    doc.moveDown();

    doc.fillColor(green).fontSize(12).text("Criterion and deterministic comparison");
    if (inputs.criterion && inputs.evaluation) {
      row("Criterion", `shade_tree_count ${inputs.criterion.object.operator === "gte" ? ">=" : "?"} ${inputs.criterion.object.targetCount}`);
      row("Original comparison", `${inputs.evaluation.observedCount} vs ${inputs.evaluation.targetCount}: ${inputs.evaluation.result.replace(/_/g, " ").toLowerCase()} (${inputs.evaluation.ruleVersion})`);
      if (inputs.acceptedEvaluation && accepted && accepted.payload.version !== 1) {
        row("Accepted comparison", `${inputs.acceptedEvaluation.observedCount} vs ${inputs.acceptedEvaluation.targetCount}: ${inputs.acceptedEvaluation.result.replace(/_/g, " ").toLowerCase()}`);
        if (inputs.acceptedEvaluation.result !== inputs.evaluation.result) row("Outcome changed", "Yes, by the accepted correction. Both versions are anchored and in the proof packet.");
      }
    } else {
      row("Criterion", "Not disclosed in this report");
    }
    doc.moveDown();

    doc.fillColor(green).fontSize(12).text("Human review");
    row("Decision", inputs.review.decision ?? "Pending");
    if (inputs.review.reason) row("Reason", inputs.review.reason.slice(0, 600));
    for (const f of inputs.review.flagNotes) row(`Flag ${f.code}`, `${f.reason} → reviewer: ${f.label ?? "not labelled"}`);
    doc.moveDown();

    doc.fillColor(green).fontSize(12).text("Limitations");
    doc.fillColor("#142620").fontSize(9).text(
      `${INTEGRITY_DISCLAIMER} A sealed record proves what was submitted and when it was received and anchored; it does not prove the count was true, that photos depict this farm, or that participants did not collude. Evidence-quality flags are indicators for human review, not findings of intent. No certification is implied.`,
    );
    doc.moveDown();

    doc.fillColor(green).fontSize(12).text("Integrity references");
    doc.font("Courier").fontSize(7.5).fillColor("#142620");
    doc.text(`chain id ${ctx.cfg.CHAIN_ID} · registry ${ctx.registry.address}`);
    doc.text(`cohort key ${inputs.cohort.cohortKey}`);
    doc.text(`assignment key ${inputs.assignment.assignmentKey}`);
    doc.text(`target commitment ${inputs.cohort.targetCommitment}`);
    for (const v of inputs.versions) {
      doc.text(`v${v.payload.version} payload sha256 ${v.payloadSha256}`);
      doc.text(`v${v.payload.version} commitment ${v.commitment}`);
      doc.text(`v${v.payload.version} anchor tx ${v.anchorTxHash ?? "pending"} block ${v.anchorBlockNumber?.toString() ?? "-"}`);
    }
    if (inputs.cohort.closeTxHash) doc.text(`cohort close tx ${inputs.cohort.closeTxHash}`);
    doc.font("Helvetica").fontSize(8).fillColor(muted).moveDown();
    doc.text(`Generated ${inputs.generatedAt.toISOString()} (UTC). Verify the accompanying proof packet at ${ctx.cfg.WEB_URL}/verify or with the open-source blindcount-verify CLI. Verification runs locally and does not upload the packet.`);
    doc.end();
  });
}

function csv(inputs: ReportInputs, chainId: number): string {
  const first = inputs.versions[0]!;
  const accepted = inputs.versions.find((v) => v.payload.version === inputs.acceptedVersionNumber) ?? null;
  const row = csvRow([
    inputs.reportId,
    inputs.programme.code,
    inputs.cohort.code,
    inputs.assignment.code,
    inputs.assignment.farmPseudonym,
    first.payload.visitDate,
    first.payload.count,
    accepted ? accepted.payload.count : null,
    inputs.criterion?.object.operator ?? null,
    inputs.criterion?.object.targetCount ?? null,
    (inputs.acceptedEvaluation ?? inputs.evaluation)?.result ?? null,
    inputs.status,
    inputs.versions.length - 1,
    first.anchorTxHash,
    chainId,
    "SEE_PACKET_VERIFIER",
    inputs.generatedAt.toISOString(),
  ]);
  return `${CSV_HEADER}\r\n${row}\r\n`;
}

const README = `BlindCount verification packet (blindcount.packet.v1)

What this proves: the files in this packet match digests signed by the issuing
organization's report key, the auditor's device signed the original observation,
and the salted commitment of that observation was anchored on the stated EVM chain
before the programme criterion was disclosed.

What this does NOT prove: ${INTEGRITY_DISCLAIMER}

Verify without any BlindCount account:
  1. Browser: open https://<blindcount-host>/verify and drop this ZIP. Parsing happens locally.
  2. CLI:     blindcount-verify --packet ./this.zip --rpc <trusted RPC URL> --output json

Use an RPC endpoint you trust; the verifier reads the registry contract directly.
Compare manifest.json signing key fingerprint with the one the organization publishes.
`;

export async function buildReportArtifacts(ctx: AppContext, inputs: ReportInputs) {
  const enc = new TextEncoder();
  const pdfBytes = await pdf(inputs, ctx);
  const csvText = csv(inputs, ctx.cfg.CHAIN_ID);

  const proofs: PacketProofs = {
    targetCommitment: inputs.cohort.targetCommitment,
    criterionSalt: inputs.criterion?.salt ?? null,
    versions: inputs.versions.map((v) => {
      const finalization: FinalizationMessage = {
        schema: "blindcount.client.finalization.v1",
        chainId: ctx.cfg.CHAIN_ID,
        registryAddress: ctx.registry.address,
        assignmentKey: inputs.assignment.assignmentKey,
        version: v.payload.version,
        payloadSha256: v.payloadSha256,
        submissionSalt: v.submissionSalt,
        clientNonce: v.clientNonce,
        clientClaimedAt: v.payload.clientClaimedAt,
      };
      return {
        version: v.payload.version,
        submissionId: v.submissionId,
        payloadSha256: v.payloadSha256,
        submissionSalt: v.submissionSalt,
        commitment: v.commitment,
        anchorTxHash: v.anchorTxHash,
        anchorBlockNumber: v.anchorBlockNumber?.toString() ?? null,
        finalization,
        deviceKeyId: v.deviceKeyId,
        signature: v.signature,
        signatureFormat: v.signatureFormat,
      };
    }),
  };
  const deviceKeys: PacketDeviceKeys = { attestedBy: "organization-report-signing-key", keys: inputs.deviceKeys };

  const files: Record<string, Uint8Array> = {
    "README-VERIFY.txt": enc.encode(README),
    "report.pdf": pdfBytes,
    "report.csv": enc.encode(csvText),
    "observation-v1.json": enc.encode(canonicalize(inputs.versions[0]!.payload)),
    "observation-amendments.json": enc.encode(canonicalize(inputs.versions.slice(1).map((v) => v.payload))),
    "proofs.json": enc.encode(canonicalize(proofs)),
    "device-keys.json": enc.encode(canonicalize(deviceKeys)),
  };
  if (inputs.criterion) files["criterion.json"] = enc.encode(canonicalize(inputs.criterion.object));
  for (const e of inputs.evidence) files[`evidence/${e.fileId}.${e.mime === "image/png" ? "png" : "jpg"}`] = e.bytes;

  const manifest: PacketManifest = {
    schema: PACKET_SCHEMA,
    generatedAt: inputs.generatedAt.toISOString(),
    reportId: inputs.reportId,
    reportVersion: inputs.version,
    cohortKey: inputs.cohort.cohortKey,
    assignmentKey: inputs.assignment.assignmentKey,
    chainId: ctx.cfg.CHAIN_ID,
    registryAddress: ctx.registry.address,
    // Only the explicitly public hint: the relayer's RPC URL may carry a provider key.
    rpcHint: ctx.cfg.CHAIN_PUBLIC_RPC_HINT ?? "",
    hashAlgorithms: { files: "sha256", commitments: "keccak256(abi.encode)" },
    canonicalization: "RFC8785-JCS",
    recipientScope: "authorised-recipient",
    classification: "CONFIDENTIAL",
    sourceType: inputs.programme.dataSource === "FIELD_DATA" ? "FIELD_DATA" : "SIMULATED_DEMO",
    reviewState: inputs.status === "APPROVED" ? "REVIEWED" : inputs.status === "DISPUTED" ? "DISPUTED" : "PENDING",
    criterionIncluded: !!inputs.criterion,
    signaturesRef: "signatures.json",
    schemaVersions: { observation: "blindcount.observation.v1", criterion: "blindcount.criterion.v1" },
    verificationPolicy: "Recompute file digests, RFC8785 payload hashes, salted keccak commitments; verify P-256 device signatures; read registry via an independent RPC.",
    files: await Promise.all(Object.entries(files).map(async ([path, data]) => ({ path, sha256: await sha256Hex(data), byteLength: data.byteLength }))),
  };
  manifest.files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const signatures: PacketSignatures = {
    reportSigningKey: ctx.reportKey.publicJwk,
    reportSigningKeyFingerprint: await jwkFingerprint(ctx.reportKey.publicJwk),
    manifestSignature: await signCanonical(ctx.reportKey.privateKey, manifest),
    deviceKeysSignature: await signCanonical(ctx.reportKey.privateKey, deviceKeys),
  };
  const manifestBytes = enc.encode(JSON.stringify(manifest, null, 2));
  const zip = zipSync({ ...files, "manifest.json": manifestBytes, "signatures.json": enc.encode(JSON.stringify(signatures, null, 2)) }, { mtime: inputs.generatedAt });
  return { pdf: pdfBytes, csv: Buffer.from(csvText), zip: Buffer.from(zip), manifestSha256: await sha256Hex(manifestBytes) };
}
