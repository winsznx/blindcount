import { z } from "zod";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "lowercase hex sha256");

export const CAPTURE_METHODS = ["walkthrough_count", "plot_sample_count", "transect_count"] as const;
export const MAX_COUNT = 100_000;
export const MAX_NOTES = 2_000;
export const MAX_EVIDENCE = 3;
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_MIME = ["image/jpeg", "image/png"] as const;

export const evidenceRefSchema = z
  .object({
    fileId: uuid,
    sha256,
    mime: z.enum(EVIDENCE_MIME),
    bytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
  })
  .strict();

export const observationPayloadSchema = z
  .object({
    schema: z.literal("blindcount.observation.v1"),
    assignmentId: uuid,
    cohortId: uuid,
    farmPseudonym: z.string().min(1).max(64),
    auditorUserId: uuid,
    deviceKeyId: uuid,
    version: z.number().int().min(1).max(1000),
    previousSubmissionId: uuid.nullable(),
    visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    count: z.number().int().min(0).max(MAX_COUNT),
    unit: z.literal("shade_trees"),
    captureMethod: z.enum(CAPTURE_METHODS),
    notes: z.string().max(MAX_NOTES),
    evidence: z.array(evidenceRefSchema).max(MAX_EVIDENCE),
    evidenceException: z.string().max(500).nullable(),
    evidenceConsent: z.literal(true),
    // Microdegrees and metres, bounded so every value is a safe integer for canonicalization.
    location: z
      .object({ lat: z.number().int().min(-90_000_000).max(90_000_000), lon: z.number().int().min(-180_000_000).max(180_000_000), accuracyM: z.number().int().min(0).max(100_000) })
      .strict()
      .nullable(),
    amendmentReason: z.string().max(MAX_NOTES).nullable(),
    clientClaimedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.evidence.map((e) => e.fileId)).size !== p.evidence.length) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "Each photo can be listed once" });
    }
    if (p.evidence.length === 0 && !p.evidenceException) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "At least one photo or a documented exception is required" });
    }
    if (p.version === 1 && (p.previousSubmissionId !== null || p.amendmentReason !== null)) {
      ctx.addIssue({ code: "custom", path: ["version"], message: "First version cannot reference a previous submission" });
    }
    if (p.version > 1 && (!p.previousSubmissionId || !p.amendmentReason)) {
      ctx.addIssue({ code: "custom", path: ["amendmentReason"], message: "Amendments need a previous submission and reason" });
    }
  });

export type ObservationPayload = z.infer<typeof observationPayloadSchema>;

export const submissionEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("blindcount.observation.v1"),
    deviceKeyId: uuid,
    canonicalPayload: z.unknown(),
    payloadSha256: sha256,
    submissionSalt: z.string().regex(/^0x[0-9a-f]{64}$/),
    clientNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    signatureFormat: z.literal("P256_SHA256_P1363"),
    signatureBase64url: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
    clientClaimedAt: z.string().datetime(),
  })
  .strict();

export type SubmissionEnvelope = z.infer<typeof submissionEnvelopeSchema>;
