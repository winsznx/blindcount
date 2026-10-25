import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Hex } from "viem";
import { hashCanonical, observationCommitment, signCanonical, verifyFinalization, type FinalizationMessage } from "@blindcount/crypto";
import { EVIDENCE_MIME, MAX_EVIDENCE_BYTES, observationPayloadSchema, submissionEnvelopeSchema, type SubmissionEnvelope } from "@blindcount/domain";
import { Prisma } from "@blindcount/db";
import { audit, type AppContext } from "../lib/context";
import { ApiError, forbidden, notFound } from "../lib/errors";
import { idempotencyKey, ok, parse, requireMember, requireUser } from "../lib/http";
import { enqueue } from "../worker";
import { auditorProjection } from "./projections";

function sniffMime(buf: Buffer): (typeof EVIDENCE_MIME)[number] | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

/** Reads pixel dimensions from the header; rejects decompression-bomb sized images. */
function imageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === "image/png") {
    if (buf.length < 24 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
    const size = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    return size.width > 0 && size.height > 0 ? size : null;
  }
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const size = { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      return size.width > 0 && size.height > 0 ? size : null;
    }
    i += 2 + len;
  }
  return null;
}

const MAX_PIXELS = 80_000_000;

export function assignmentRoutes(app: FastifyInstance, ctx: AppContext) {
  // No parser-level limit: every route keeps the 1 MB app default, and only the evidence route raises its own.
  app.addContentTypeParser(["image/jpeg", "image/png", "application/octet-stream"], { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  async function ownAssignment(req: FastifyRequest, id: string) {
    const user = requireUser(req);
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
    const a = await ctx.prisma.assignment.findUnique({ where: { id }, include: { cohort: true, farm: true, observation: { include: { versions: true } } } });
    if (!a) throw notFound();
    const scope = await requireMember(ctx, req, a.organizationId);
    if (a.auditorUserId !== user.id || !scope.roles.includes("AUDITOR")) throw notFound();
    return { a, scope };
  }

  app.get<{ Querystring: { orgId?: string } }>("/v1/assignments", async (req) => {
    const user = requireUser(req);
    const orgId = req.query.orgId;
    if (!orgId) throw new ApiError("INVALID_REQUEST", "orgId is required");
    const scope = await requireMember(ctx, req, orgId, "visit.own");
    const list = await ctx.prisma.assignment.findMany({
      where: { organizationId: scope.organizationId, auditorUserId: user.id, cohort: { state: { notIn: ["DRAFT", "PUBLISH_PENDING", "PUBLISH_FAILED", "CANCELLED"] } } },
      select: { id: true },
      orderBy: { dueAt: "asc" },
    });
    return ok(req, await Promise.all(list.map((a) => auditorProjection(ctx, a.id))));
  });

  app.get<{ Params: { id: string } }>("/v1/assignments/:id/form", async (req) => {
    const { a } = await ownAssignment(req, req.params.id);
    if (["DRAFT", "PUBLISH_PENDING", "PUBLISH_FAILED"].includes(a.cohort.state)) throw notFound();
    const evidence = await ctx.prisma.evidenceFile.findMany({ where: { assignmentId: a.id, uploadedBy: a.auditorUserId }, select: { id: true, sha256: true, mime: true, byteSize: true, submissionVersionId: true, receivedAt: true } });
    return ok(req, { ...(await auditorProjection(ctx, a.id)), uploadedEvidence: evidence.map((e) => ({ fileId: e.id, sha256: e.sha256, mime: e.mime, bytes: e.byteSize, attached: !!e.submissionVersionId })) });
  });

  app.get<{ Params: { id: string } }>("/v1/assignments/:id/submission-status", async (req) => {
    const user = requireUser(req);
    const a = await ctx.prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!a) throw notFound();
    const scope = await requireMember(ctx, req, a.organizationId);
    if (a.auditorUserId !== user.id && !scope.roles.includes("MANAGER")) throw notFound();
    const p = await auditorProjection(ctx, a.id);
    return ok(req, { status: p.status, submissions: p.submissions });
  });

  // Evidence upload: raw body, client-declared SHA-256 must match server digest (FR-025).
  app.post<{ Params: { id: string } }>("/v1/assignments/:id/evidence", { bodyLimit: MAX_EVIDENCE_BYTES, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { a, scope } = await ownAssignment(req, req.params.id);
    const correcting = a.status === "AMENDMENT_REQUESTED";
    if (a.cohort.state !== "ACTIVE" && !correcting) throw new ApiError("COHORT_LOCKED", "This cohort is not accepting evidence");
    if (a.observation && !correcting) throw new ApiError("SEALED_RECORD_IMMUTABLE", "This assignment already has a finalized submission");
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new ApiError("INVALID_REQUEST", "Image body required");
    const declared = req.headers["x-content-sha256"];
    if (typeof declared !== "string" || !/^[0-9a-f]{64}$/.test(declared)) throw new ApiError("INVALID_REQUEST", "X-Content-SHA256 header required");
    if (req.headers["x-evidence-consent"] !== "true") throw new ApiError("INVALID_REQUEST", "Evidence consent acknowledgement required");
    const mime = sniffMime(body);
    if (!mime) throw new ApiError("INVALID_MEDIA_HASH", "Only JPEG or PNG images are accepted");
    const digest = createHash("sha256").update(body).digest("hex");
    if (digest !== declared) throw new ApiError("INVALID_MEDIA_HASH", "Uploaded bytes do not match the declared SHA-256");
    const size = imageSize(body, mime);
    if (!size || size.width * size.height > MAX_PIXELS) throw new ApiError("INVALID_MEDIA_HASH", "Image dimensions are unreadable or too large");
    const pending = await ctx.prisma.evidenceFile.count({ where: { assignmentId: a.id, submissionVersionId: null } });
    if (pending >= 3) throw new ApiError("STATE_CONFLICT", "At most 3 photos per submission");

    // Offline clients pick the evidence id before upload so it can be signed into the payload.
    const proposedId = req.headers["x-evidence-id"];
    if (proposedId !== undefined && (typeof proposedId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(proposedId))) {
      throw new ApiError("INVALID_REQUEST", "X-Evidence-Id must be a v4 UUID");
    }
    const dup = await ctx.prisma.evidenceFile.findFirst({ where: { assignmentId: a.id, sha256: digest, submissionVersionId: null } });
    if (dup) {
      if (proposedId && dup.id !== proposedId) throw new ApiError("STATE_CONFLICT", "This photo was already uploaded under a different id", { fileId: dup.id });
      return ok(req, { fileId: dup.id, sha256: dup.sha256, mime: dup.mime, bytes: dup.byteSize });
    }
    if (proposedId) {
      const taken = await ctx.prisma.evidenceFile.findUnique({ where: { id: proposedId } });
      if (taken) throw new ApiError("STATE_CONFLICT", "Evidence id already in use");
    }

    const claimed = req.headers["x-capture-claimed-at"];
    const storageKey = await ctx.store.put("evidence", body);
    const ev = await ctx.prisma.evidenceFile.create({
      data: {
        ...(proposedId ? { id: proposedId } : {}),
        organizationId: a.organizationId,
        assignmentId: a.id,
        uploadedBy: scope.user.id,
        storageKey,
        sha256: digest,
        mime,
        byteSize: body.length,
        width: size.width,
        height: size.height,
        captureClaimedAt: typeof claimed === "string" && !Number.isNaN(Date.parse(claimed)) ? new Date(claimed) : null,
        consentFlag: true,
      },
    });
    await audit(ctx.prisma, { organizationId: a.organizationId, actorId: scope.user.id, action: "evidence.uploaded", objectType: "evidence_file", objectId: ev.id, traceId: req.id, metadata: { bytes: body.length, mime } });
    return reply.status(201).send(ok(req, { fileId: ev.id, sha256: digest, mime, bytes: body.length }));
  });

  app.delete<{ Params: { id: string; fileId: string } }>("/v1/assignments/:id/evidence/:fileId", async (req, reply) => {
    const { a, scope } = await ownAssignment(req, req.params.id);
    const deleted = await ctx.prisma.$transaction(async (tx) => {
      // Same row lock as submission, so a photo can't vanish between validation and attachment.
      await tx.$queryRaw`SELECT id FROM assignments WHERE id = ${a.id}::uuid FOR UPDATE`;
      const ev = await tx.evidenceFile.findFirst({ where: { id: req.params.fileId, assignmentId: a.id, submissionVersionId: null } });
      if (!ev) throw notFound();
      await tx.evidenceFile.delete({ where: { id: ev.id } });
      return ev;
    });
    await ctx.store.delete(deleted.storageKey);
    await audit(ctx.prisma, { organizationId: a.organizationId, actorId: scope.user.id, action: "evidence.deleted_unfinalized", objectType: "evidence_file", objectId: req.params.fileId, traceId: req.id });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/v1/assignments/:id/submissions", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const idemKey = idempotencyKey(req);
    const { a, scope } = await ownAssignment(req, req.params.id);
    const env = parse(submissionEnvelopeSchema, req.body);
    const prior = await replayOf(a.organizationId, idemKey, env.payloadSha256);
    if (prior) return reply.status(200).send(ok(req, receiptView(prior)));
    if (a.observation?.versions.some((v) => v.versionNumber === 1)) {
      throw new ApiError("SEALED_RECORD_IMMUTABLE", "A first submission already exists. Corrections must be submitted as amendments.");
    }
    if (a.cohort.state !== "ACTIVE") throw new ApiError("COHORT_LOCKED", "This cohort is not accepting submissions", { cohortState: a.cohort.state });
    if (!["PENDING", "IN_PROGRESS", "EXPIRED"].includes(a.status)) throw new ApiError("STATE_CONFLICT", `Assignment is ${a.status}`);
    return acceptSignedVersion(req, reply, a, scope.user.id, env, idemKey, { version: 1, previous: null });
  });

  // Sealed records cannot be edited through any API (FR-024).
  app.patch<{ Params: { id: string } }>("/v1/assignments/:id/submissions/:submissionId", async (req) => {
    await ownAssignment(req, req.params.id);
    throw new ApiError("SEALED_RECORD_IMMUTABLE", "Submitted observations are immutable. Corrections are recorded as amendments.");
  });

  /**
   * Workflow F: after a reviewer requests a correction, the auditor signs a new version that links
   * to the previous one. It is anchored as appended history; version 1 is never touched.
   */
  app.post<{ Params: { id: string } }>("/v1/assignments/:id/amendments", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const idemKey = idempotencyKey(req);
    const { a, scope } = await ownAssignment(req, req.params.id);
    const env = parse(submissionEnvelopeSchema, req.body);
    const prior = await replayOf(a.organizationId, idemKey, env.payloadSha256);
    if (prior) return reply.status(200).send(ok(req, receiptView(prior)));
    const versions = (a.observation?.versions ?? []).sort((x, y) => x.versionNumber - y.versionNumber);
    const latest = versions[versions.length - 1];
    if (!a.observation || !latest) throw new ApiError("STATE_CONFLICT", "There is no submission to amend");
    if (a.status !== "AMENDMENT_REQUESTED") throw new ApiError("STATE_CONFLICT", "A reviewer has not requested a correction for this visit");
    if (latest.anchorStatus !== "CONFIRMED") throw new ApiError("STATE_CONFLICT", "The previous version is still being anchored");
    const openRequest = await ctx.prisma.reviewCase.findFirst({ where: { observationId: a.observation.id, state: "CORRECTION_REQUESTED" } });
    if (!openRequest) throw new ApiError("STATE_CONFLICT", "A reviewer has not requested a correction for this visit");
    return acceptSignedVersion(req, reply, a, scope.user.id, env, idemKey, { version: latest.versionNumber + 1, previous: latest.id });
  });

  async function replayOf(organizationId: string, idemKey: string, payloadSha256: string) {
    // Idempotent replay: same key + same digest returns the original receipt (FR-026).
    const prior = await ctx.prisma.submissionVersion.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: idemKey } } });
    if (prior && prior.payloadSha256 !== payloadSha256) throw new ApiError("IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different payload");
    return prior;
  }

  type OwnAssignment = Awaited<ReturnType<typeof ownAssignment>>["a"];

  /** One validation, signing and storage path for every version, so first submissions and amendments can't drift. */
  async function acceptSignedVersion(
    req: FastifyRequest,
    reply: FastifyReply,
    a: OwnAssignment,
    userId: string,
    env: SubmissionEnvelope,
    idemKey: string,
    expected: { version: number; previous: string | null },
  ) {
    const payloadParse = observationPayloadSchema.safeParse(env.canonicalPayload);
    if (!payloadParse.success) {
      throw new ApiError("INVALID_OBSERVATION", "Observation payload is invalid", { fields: payloadParse.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    const payload = payloadParse.data;
    const mismatch: string[] = [];
    if (payload.assignmentId !== a.id) mismatch.push("assignmentId");
    if (payload.cohortId !== a.cohortId) mismatch.push("cohortId");
    if (payload.auditorUserId !== userId) mismatch.push("auditorUserId");
    if (payload.farmPseudonym !== a.farm.displayPseudonym) mismatch.push("farmPseudonym");
    if (payload.deviceKeyId !== env.deviceKeyId) mismatch.push("deviceKeyId");
    if (payload.version !== expected.version) mismatch.push("version");
    if (payload.previousSubmissionId !== expected.previous) mismatch.push("previousSubmissionId");
    if (payload.clientClaimedAt !== env.clientClaimedAt) mismatch.push("clientClaimedAt");
    if (mismatch.length) throw new ApiError("INVALID_OBSERVATION", "Payload does not match this assignment", { fields: mismatch.map((path) => ({ path, message: "mismatch" })) });

    const digest = await hashCanonical(payload);
    if (digest !== env.payloadSha256) throw new ApiError("INVALID_SIGNATURE", "Payload SHA-256 does not match the canonical payload");

    const device = await ctx.prisma.deviceKey.findUnique({ where: { id: env.deviceKeyId } });
    if (!device || device.userId !== userId || device.organizationId !== a.organizationId) throw new ApiError("INVALID_SIGNATURE", "Unknown device key");
    if (device.revokedAt) throw new ApiError("INVALID_SIGNATURE", "This device key has been revoked");

    const finalization: FinalizationMessage = {
      schema: "blindcount.client.finalization.v1",
      chainId: ctx.cfg.CHAIN_ID,
      registryAddress: ctx.registry.address,
      assignmentKey: a.assignmentKey,
      version: expected.version,
      payloadSha256: env.payloadSha256,
      submissionSalt: env.submissionSalt,
      clientNonce: env.clientNonce,
      clientClaimedAt: env.clientClaimedAt,
    };
    if (!(await verifyFinalization(device.publicJwk as JsonWebKey, finalization, env.signatureBase64url))) {
      throw new ApiError("INVALID_SIGNATURE", "Device signature verification failed");
    }

    // Evidence: this auditor's uploads for this assignment, digests matching (INV-12). An amendment
    // may also re-cite photos already attached to an earlier version of the same visit.
    const evidenceIds = payload.evidence.map((e) => e.fileId);
    const priorVersionIds = (a.observation?.versions ?? []).map((v) => v.id);
    const files = await ctx.prisma.evidenceFile.findMany({
      where: { id: { in: evidenceIds }, assignmentId: a.id, uploadedBy: userId, OR: [{ submissionVersionId: null }, { submissionVersionId: { in: priorVersionIds } }] },
    });
    for (const ref of payload.evidence) {
      const f = files.find((x) => x.id === ref.fileId);
      if (!f || f.sha256 !== ref.sha256 || f.mime !== ref.mime || f.byteSize !== ref.bytes) {
        throw new ApiError("INVALID_MEDIA_HASH", "Evidence reference does not match an uploaded file", { fileId: ref.fileId });
      }
    }
    const newEvidenceIds = files.filter((f) => f.submissionVersionId === null).map((f) => f.id);

    const commitment = observationCommitment({
      chainId: ctx.cfg.CHAIN_ID,
      registryAddress: ctx.registry.address,
      cohortKey: a.cohort.chainCampaignKey as Hex,
      assignmentKey: a.assignmentKey as Hex,
      version: expected.version,
      payloadSha256: env.payloadSha256,
      submissionSalt: env.submissionSalt as Hex,
    });
    const receivedAt = new Date();
    const submissionId = crypto.randomUUID();
    const receiptSignature = await signCanonical(ctx.reportKey.privateKey, {
      schema: "blindcount.receipt.v1",
      submissionId,
      assignmentKey: a.assignmentKey,
      payloadSha256: env.payloadSha256,
      commitment,
      receivedAt: receivedAt.toISOString(),
    });

    try {
      const created = await ctx.prisma.$transaction(
        async (tx) => {
          // Row lock serializes concurrent submissions for the same assignment (INV-04).
          await tx.$queryRaw`SELECT id FROM assignments WHERE id = ${a.id}::uuid FOR UPDATE`;
          const existingObs = await tx.observation.findUnique({ where: { assignmentId: a.id }, include: { versions: true } });
          const clash = existingObs?.versions.find((v) => v.versionNumber === expected.version);
          if (clash) {
            if (clash.idempotencyKey === idemKey && clash.payloadSha256 === env.payloadSha256) return { replay: clash, created: null };
            throw new ApiError(clash.idempotencyKey === idemKey ? "IDEMPOTENCY_CONFLICT" : "SEALED_RECORD_IMMUTABLE", `Version ${expected.version} already exists`);
          }
          if ((existingObs?.versions.length ?? 0) !== expected.version - 1) throw new ApiError("STATE_CONFLICT", "The visit changed while this version was being saved. Refresh and try again.");
          const obs = existingObs ?? (await tx.observation.create({ data: { organizationId: a.organizationId, assignmentId: a.id, createdBy: userId } }));
          const sv = await tx.submissionVersion.create({
            data: {
              id: submissionId,
              organizationId: a.organizationId,
              observationId: obs.id,
              versionNumber: expected.version,
              previousVersionId: expected.previous,
              idempotencyKey: idemKey,
              payloadJsonEncrypted: ctx.vault.encrypt(JSON.stringify(payload), `submission:${submissionId}`),
              payloadSha256: env.payloadSha256,
              observedCount: payload.count,
              commitment,
              commitmentSaltEncrypted: ctx.vault.encrypt(env.submissionSalt, `salt:${submissionId}`),
              clientNonce: env.clientNonce,
              deviceSignature: env.signatureBase64url,
              signatureFormat: env.signatureFormat,
              deviceKeyId: device.id,
              deviceClaimedAt: new Date(env.clientClaimedAt),
              receivedAt,
              receiptSignature,
              reason: payload.amendmentReason,
              amendmentStatus: expected.version > 1 ? "PENDING_REVIEW" : null,
            },
          });
          const attached = await tx.evidenceFile.updateMany({ where: { id: { in: newEvidenceIds }, assignmentId: a.id, submissionVersionId: null }, data: { submissionVersionId: sv.id } });
          if (attached.count !== newEvidenceIds.length) throw new ApiError("INVALID_MEDIA_HASH", "An evidence file changed while the submission was being saved. Try again.");
          if (expected.version === 1) await tx.assignment.update({ where: { id: a.id }, data: { status: "ANCHOR_PENDING", lastSyncedAt: receivedAt } });
          else await tx.assignment.update({ where: { id: a.id }, data: { lastSyncedAt: receivedAt } });
          await audit(tx, {
            organizationId: a.organizationId,
            actorId: userId,
            action: expected.version === 1 ? "submission.received" : "amendment.created",
            objectType: "submission_version",
            objectId: sv.id,
            traceId: req.id,
            metadata: { version: expected.version, late: a.dueAt < receivedAt, evidence: evidenceIds.length },
          });
          await enqueue(tx, { organizationId: a.organizationId, kind: "anchor_submission", entityId: sv.id, eventKey: `anchor:${sv.id}` });
          return { replay: null, created: sv };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      if (created.replay) return reply.status(200).send(ok(req, receiptView(created.replay)));
      return reply.status(202).send(ok(req, receiptView(created.created)));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const winner = await ctx.prisma.submissionVersion.findUnique({ where: { organizationId_idempotencyKey: { organizationId: a.organizationId, idempotencyKey: idemKey } } });
        if (winner && winner.payloadSha256 === env.payloadSha256) return reply.status(200).send(ok(req, receiptView(winner)));
        throw new ApiError("SEALED_RECORD_IMMUTABLE", `Version ${expected.version} already exists`);
      }
      throw e;
    }
  }
}

function receiptView(sv: { id: string; receivedAt: Date; anchorStatus: string; anchorTxHash: string | null; payloadSha256: string; commitment: string; receiptSignature: string }) {
  return {
    submissionId: sv.id,
    state: sv.anchorStatus === "CONFIRMED" ? "SEALED" : "ANCHOR_PENDING",
    serverReceivedAt: sv.receivedAt.toISOString(),
    receiptId: `RCP-${sv.id.slice(0, 8).toUpperCase()}`,
    receiptSignature: sv.receiptSignature,
    payloadSha256: sv.payloadSha256,
    commitment: sv.commitment,
    anchor: sv.anchorStatus === "CONFIRMED" ? { txHash: sv.anchorTxHash } : null,
  };
}
