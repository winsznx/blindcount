import { hashCanonical, randomBytes32, randomNonce, sha256Hex, signFinalization, type FinalizationMessage } from "@blindcount/crypto";
import { observationPayloadSchema } from "@blindcount/domain";
import { api, ApiFailure } from "./api";
import { idbDelete, idbKeys, loadBinary, loadEncrypted, saveBinary, saveEncrypted, type DeviceRecord } from "./device";
import type { Submission, VisitForm } from "./types";

export interface PhotoMeta {
  fileId: string;
  sha256: string;
  mime: "image/jpeg" | "image/png";
  bytes: number;
  capturedAt: string;
  uploaded: boolean;
}

/** A photo in memory. On disk the bytes live in their own encrypted record, keyed by fileId. */
export interface DraftPhoto extends PhotoMeta {
  data: ArrayBuffer | null;
}

export interface Draft {
  version: 1;
  form: VisitForm;
  visitDate: string;
  count: string;
  captureMethod: "walkthrough_count" | "plot_sample_count" | "transect_count";
  notes: string;
  photos: DraftPhoto[];
  evidenceException: string;
  consent: boolean;
  savedAt: string;
}

export interface SignedFinalization {
  assignmentId: string;
  /** 1 for the original observation, 2+ for a correction requested by a reviewer. */
  version: number;
  idempotencyKey: string;
  envelope: Record<string, unknown>;
  photos: PhotoMeta[];
  finalizedAt: string;
  receipt: { submissionId: string; serverReceivedAt: string; receiptId: string; state: string } | null;
  /** Set when the server permanently refused this envelope; the auditor may then discard and redo. */
  rejected: string | null;
}

const draftKey = (assignmentId: string) => `draft:${assignmentId}`;
const finalKey = (assignmentId: string, version = 1) => (version === 1 ? `final:${assignmentId}` : `final:${assignmentId}:v${version}`);
const parseFinalKey = (key: string) => {
  const m = /^final:([0-9a-f-]{36})(?::v(\d+))?$/.exec(key);
  return m ? { assignmentId: m[1]!, version: m[2] ? Number(m[2]) : 1 } : null;
};

export interface Amendment {
  version: number;
  previousSubmissionId: string;
  reason: string;
}
const photoKey = (fileId: string) => `photo:${fileId}`;

export const MAX_EXCEPTION = 500;

/** The auditor's calendar day, not UTC: an early-morning visit in Abidjan or Lagos is still today. */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function emptyDraft(form: VisitForm): Draft {
  return { version: 1, form, visitDate: localDate(), count: "", captureMethod: "walkthrough_count", notes: "", photos: [], evidenceException: "", consent: false, savedAt: new Date().toISOString() };
}

const meta = ({ data: _data, ...m }: DraftPhoto): PhotoMeta => m;

export async function saveDraft(dev: DeviceRecord, d: Draft) {
  for (const p of d.photos) if (p.data) await saveBinary(dev, photoKey(p.fileId), p.data);
  await saveEncrypted("draftsEncrypted", dev, draftKey(d.form.assignmentId), { ...d, photos: d.photos.map(meta), savedAt: new Date().toISOString() });
}

/** Loads photo bytes and re-checks each against the SHA-256 recorded when it was taken. */
async function hydrate(dev: DeviceRecord, photos: PhotoMeta[]): Promise<DraftPhoto[]> {
  return Promise.all(
    photos.map(async (p) => {
      const data = await loadBinary(dev, photoKey(p.fileId));
      const intact = data && (await sha256Hex(new Uint8Array(data))) === p.sha256;
      return { ...p, data: intact ? data : null };
    }),
  );
}

export async function loadDraft(dev: DeviceRecord, assignmentId: string): Promise<Draft | null> {
  const d = await loadEncrypted<Omit<Draft, "photos"> & { photos: PhotoMeta[] }>("draftsEncrypted", dev, draftKey(assignmentId));
  return d ? { ...d, photos: await hydrate(dev, d.photos) } : null;
}

export const loadFinal = (dev: DeviceRecord, assignmentId: string) => loadEncrypted<SignedFinalization>("signedFinalizations", dev, finalKey(assignmentId));

export async function photoFromFile(file: File): Promise<DraftPhoto> {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("Use a JPEG or PNG photo.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Photos must be 20 MB or smaller.");
  const data = await file.arrayBuffer();
  return { fileId: crypto.randomUUID(), sha256: await sha256Hex(new Uint8Array(data)), mime: file.type as DraftPhoto["mime"], bytes: file.size, data, capturedAt: new Date(file.lastModified || Date.now()).toISOString(), uploaded: false };
}

function buildPayload(dev: DeviceRecord, d: Draft, clientClaimedAt: string, amendment?: Amendment) {
  const f = d.form;
  return {
    schema: "blindcount.observation.v1",
    assignmentId: f.assignmentId,
    cohortId: f.cohort.id,
    farmPseudonym: f.farm.pseudonym,
    auditorUserId: f.signing.auditorUserId,
    deviceKeyId: dev.deviceKeyId,
    version: amendment?.version ?? 1,
    previousSubmissionId: amendment?.previousSubmissionId ?? null,
    visitDate: d.visitDate,
    count: Number(d.count),
    unit: "shade_trees",
    captureMethod: d.captureMethod,
    notes: d.notes,
    evidence: d.photos.map((p) => ({ fileId: p.fileId, sha256: p.sha256, mime: p.mime, bytes: p.bytes })),
    evidenceException: d.photos.length ? null : d.evidenceException.trim(),
    evidenceConsent: d.consent,
    location: null,
    amendmentReason: amendment ? amendment.reason.trim() : null,
    clientClaimedAt,
  };
}

const FIELD_COPY: Record<string, string> = {
  count: "Enter the observed count as a whole number from 0 to 100,000.",
  visitDate: "Enter the visit date.",
  notes: "Notes must be 2,000 characters or fewer.",
  evidence: "Add at least one photo, or explain why no photo could be taken.",
  evidenceException: `Keep the no-photo explanation under ${MAX_EXCEPTION} characters.`,
  evidenceConsent: "Confirm the evidence consent statement.",
  amendmentReason: "Explain what changed in this correction.",
};

/** Validates with the exact schema the server enforces, so the phone never signs something it will refuse. */
export function validateDraft(dev: DeviceRecord | null, d: Draft, amendment?: Amendment): string[] {
  const issues = new Set<string>();
  if (!/^\d{1,6}$/.test(d.count)) issues.add(FIELD_COPY.count!);
  if (d.photos.some((p) => !p.data)) issues.add("A photo is missing from this device. Remove it and take it again.");
  if (!dev?.deviceKeyId) issues.add("Set up this device's signing key first.");
  if (amendment && amendment.reason.trim().length < 5) issues.add(FIELD_COPY.amendmentReason!);
  const parsed = observationPayloadSchema.safeParse(buildPayload(dev ?? ({ deviceKeyId: crypto.randomUUID() } as DeviceRecord), d, new Date().toISOString(), amendment));
  if (!parsed.success) for (const i of parsed.error.issues) issues.add(FIELD_COPY[String(i.path[0])] ?? i.message);
  return [...issues];
}

/** Builds, hashes and signs the first-submission envelope entirely on this device (R-SIGN-4). */
export async function finalizeLocally(dev: DeviceRecord, d: Draft, amendment?: Amendment): Promise<SignedFinalization> {
  if (!dev.deviceKeyId) throw new Error("This device is not enrolled yet.");
  const clientClaimedAt = new Date().toISOString();
  const payload = observationPayloadSchema.parse(buildPayload(dev, d, clientClaimedAt, amendment));
  const version = payload.version;
  const payloadSha256 = await hashCanonical(payload);
  const submissionSalt = randomBytes32();
  const clientNonce = randomNonce();
  const msg: FinalizationMessage = {
    schema: "blindcount.client.finalization.v1",
    chainId: d.form.signing.chainId,
    registryAddress: d.form.signing.registryAddress,
    assignmentKey: d.form.signing.assignmentKey,
    version,
    payloadSha256,
    submissionSalt,
    clientNonce,
    clientClaimedAt,
  };
  const final: SignedFinalization = {
    assignmentId: d.form.assignmentId,
    version,
    idempotencyKey: crypto.randomUUID().replace(/-/g, ""),
    envelope: { schemaVersion: "blindcount.observation.v1", deviceKeyId: dev.deviceKeyId, canonicalPayload: payload, payloadSha256, submissionSalt, clientNonce, signatureFormat: "P256_SHA256_P1363", signatureBase64url: await signFinalization(dev.signingKey.privateKey, msg), clientClaimedAt },
    photos: d.photos.map(meta),
    finalizedAt: clientClaimedAt,
    receipt: null,
    rejected: null,
  };
  for (const p of d.photos) if (p.data) await saveBinary(dev, photoKey(p.fileId), p.data);
  await saveEncrypted("signedFinalizations", dev, finalKey(d.form.assignmentId, version), final);
  return final;
}

/**
 * Uploads pending photos, then posts the signed envelope with its persistent idempotency key.
 * A permanent server refusal is recorded on the finalization so the UI can offer discard and redo.
 */
export async function syncFinalization(dev: DeviceRecord, assignmentId: string, final: SignedFinalization): Promise<SignedFinalization> {
  const version = final.version ?? 1;
  const save = (f: SignedFinalization) => saveEncrypted("signedFinalizations", dev, finalKey(assignmentId, version), f);
  try {
    for (const p of final.photos) {
      if (p.uploaded) continue;
      const data = await loadBinary(dev, photoKey(p.fileId));
      if (!data || (await sha256Hex(new Uint8Array(data))) !== p.sha256) throw new ApiFailure(422, "INVALID_MEDIA_HASH", "A signed photo is missing or damaged on this device.");
      try {
        await api("POST", `/v1/assignments/${assignmentId}/evidence`, new Blob([data], { type: p.mime }), {
          "content-type": p.mime,
          "x-content-sha256": p.sha256,
          "x-evidence-consent": "true",
          "x-evidence-id": p.fileId,
          "x-capture-claimed-at": p.capturedAt,
        });
      } catch (e) {
        // Uploaded under this id on an earlier attempt.
        if (!(e instanceof ApiFailure && e.code === "STATE_CONFLICT" && (e.details.fileId === p.fileId || e.message.includes("already in use")))) throw e;
      }
      p.uploaded = true;
      await save(final);
    }
    const route = version === 1 ? "submissions" : "amendments";
    const receipt = await api<NonNullable<SignedFinalization["receipt"]>>("POST", `/v1/assignments/${assignmentId}/${route}`, final.envelope, { "idempotency-key": final.idempotencyKey });
    const done = { ...final, receipt, rejected: null };
    await save(done);
    for (const p of final.photos) await idbDelete("draftsEncrypted", photoKey(p.fileId));
    if (version === 1) await idbDelete("draftsEncrypted", draftKey(assignmentId));
    return done;
  } catch (e) {
    if (e instanceof ApiFailure && !e.retryable && e.status >= 400 && e.status < 500 && e.status !== 401) {
      await save({ ...final, rejected: e.message });
    }
    throw e;
  }
}

/** Discards a finalization the server never accepted, keeping its photos so the auditor can redo the visit. */
export async function discardRejected(dev: DeviceRecord, assignmentId: string, version = 1) {
  await idbDelete("signedFinalizations", finalKey(assignmentId, version));
}

export const loadAmendment = (dev: DeviceRecord, assignmentId: string, version: number) => loadEncrypted<SignedFinalization>("signedFinalizations", dev, finalKey(assignmentId, version));

/** Syncs every finalization still waiting on this device. Runs on reconnect and on app start. */
export async function syncAllPending(dev: DeviceRecord): Promise<{ synced: string[]; failed: string[] }> {
  const synced: string[] = [];
  const failed: string[] = [];
  for (const key of await idbKeys("signedFinalizations")) {
    const parsedKey = parseFinalKey(String(key));
    if (!parsedKey) continue;
    const { assignmentId } = parsedKey;
    const final = await loadEncrypted<SignedFinalization>("signedFinalizations", dev, String(key));
    if (!final || final.receipt || final.rejected) continue;
    try {
      await syncFinalization(dev, assignmentId, final);
      synced.push(assignmentId);
    } catch {
      failed.push(assignmentId);
    }
  }
  return { synced, failed };
}

/** Assignment ids with a signed finalization on this device that the server hasn't received yet. */
export async function pendingOnDevice(dev: DeviceRecord): Promise<string[]> {
  const out: string[] = [];
  for (const key of await idbKeys("signedFinalizations")) {
    const parsedKey = parseFinalKey(String(key));
    if (!parsedKey || parsedKey.version !== 1) continue;
    const f = await loadFinal(dev, parsedKey.assignmentId);
    if (f && !f.receipt) out.push(parsedKey.assignmentId);
  }
  return out;
}

export type Stage = "draft" | "local" | "rejected" | "received" | "anchoring" | "sealed" | "failed";

export function stageOf(final: SignedFinalization | null, server: Submission | undefined): Stage {
  if (server?.anchorStatus === "CONFIRMED") return "sealed";
  if (server?.anchorStatus === "FAILED") return "failed";
  if (server) return "anchoring";
  if (final?.receipt) return "received";
  if (final?.rejected) return "rejected";
  if (final) return "local";
  return "draft";
}
