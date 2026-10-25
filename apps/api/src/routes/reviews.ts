import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Hex } from "viem";
import type { CriterionObject } from "@blindcount/crypto";
import type { ObservationPayload } from "@blindcount/domain";
import { Prisma } from "@blindcount/db";
import { audit, sha256, type AppContext } from "../lib/context";
import { ApiError, forbidden, notFound } from "../lib/errors";
import { idempotencyKey, newToken, ok, parse, requireFreshAuth, requireMember } from "../lib/http";
import { buildReportArtifacts } from "../lib/report";
import { runAiReview, type EvidenceFlag } from "../review-checks";

export function reviewRoutes(app: FastifyInstance, ctx: AppContext) {
  async function loadCase(req: Parameters<typeof requireMember>[1], id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
    const rc = await ctx.prisma.reviewCase.findUnique({
      where: { id },
      include: {
        actions: { orderBy: { createdAt: "asc" } },
        observation: {
          include: {
            versions: { orderBy: { versionNumber: "asc" }, include: { evidence: true } },
            evaluations: true,
            assignment: { include: { farm: true, cohort: { include: { programme: true, criterion: true } } } },
            reports: { orderBy: { version: "desc" } },
          },
        },
      },
    });
    if (!rc) throw notFound();
    const scope = await requireMember(ctx, req, rc.organizationId, "review.read");
    // An auditor can never review their own submission, even if they also hold REVIEWER.
    if (rc.observation.assignment.auditorUserId === scope.user.id) throw notFound();
    return { rc, scope };
  }

  app.get<{ Params: { id: string } }>("/v1/cohorts/:id/reviews", async (req) => {
    const cohort = await ctx.prisma.cohort.findUnique({ where: { id: req.params.id } });
    if (!cohort) throw notFound();
    const scope = await requireMember(ctx, req, cohort.organizationId, "review.read");
    const cases = await ctx.prisma.reviewCase.findMany({
      where: { observation: { assignment: { cohortId: cohort.id } } },
      include: { observation: { include: { assignment: { include: { farm: true } }, evaluations: true, versions: { where: { versionNumber: 1 } } } } },
      orderBy: { createdAt: "asc" },
    });
    const flags = await ctx.prisma.aiAssessment.findMany({ where: { submissionVersionId: { in: cases.flatMap((c) => c.observation.versions.map((v) => v.id)) } } });
    return ok(
      req,
      cases.map((c) => ({
        id: c.id,
        state: c.state,
        decision: c.decision,
        assignmentCode: c.observation.assignment.code,
        farmPseudonym: c.observation.assignment.farm.displayPseudonym,
        originalCount: c.observation.versions[0]?.observedCount ?? null,
        outcome: c.observation.assignment.auditorUserId === scope.user.id ? null : (c.observation.evaluations[0]?.result ?? null),
        flagCount: flags.filter((f) => f.submissionVersionId === c.observation.versions[0]?.id).reduce((n, f) => n + (Array.isArray(f.flagsJson) ? f.flagsJson.length : 0), 0),
        ownSubmission: c.observation.assignment.auditorUserId === scope.user.id,
      })),
    );
  });

  app.get<{ Params: { id: string } }>("/v1/reviews/:id", async (req) => {
    const { rc, scope } = await loadCase(req, req.params.id);
    const obs = rc.observation;
    const a = obs.assignment;
    const first = obs.versions[0]!;
    const assessments = await ctx.prisma.aiAssessment.findMany({ where: { submissionVersionId: { in: obs.versions.map((v) => v.id) } }, orderBy: { createdAt: "asc" } });
    const labels = new Map(rc.actions.filter((x) => x.actionType === "FLAG_LABEL" && x.flagId).map((x) => [x.flagId!, x.newState]));
    const target = a.cohort.criterion && a.cohort.state === "DISCLOSED" ? (JSON.parse(ctx.criterionVault.decrypt(a.cohort.criterion.targetCiphertext, `criterion:${a.cohortId}`)) as CriterionObject).targetCount : null;
    const auditor = await ctx.prisma.user.findUnique({ where: { id: a.auditorUserId }, select: { displayName: true, email: true } });
    return ok(req, {
      id: rc.id,
      state: rc.state,
      decision: rc.decision,
      decisionReason: rc.decisionReason,
      decidedAt: rc.decidedAt,
      canDecide: scope.roles.includes("REVIEWER") && rc.state === "OPEN",
      assignment: { id: a.id, code: a.code, farmPseudonym: a.farm.displayPseudonym, status: a.status },
      cohort: { id: a.cohortId, code: a.cohort.code, name: a.cohort.name, state: a.cohort.state, dataSource: a.cohort.programme.dataSource },
      auditor,
      criterion: target === null ? null : { operator: "gte", targetCount: target },
      evaluation: (() => {
        const e = obs.evaluations.find((x) => x.submissionVersionId === first.id);
        return e ? { result: e.result, observedCount: e.observedCount, targetCount: e.targetCount, ruleVersion: e.ruleVersion, resultDigest: e.resultDigest } : null;
      })(),
      evaluations: obs.evaluations.map((e) => ({ submissionVersionId: e.submissionVersionId, result: e.result, observedCount: e.observedCount })),
      acceptedVersionId: obs.currentApprovedVersionId,
      versions: obs.versions.map((v) => {
        // Notes are rendered as inert text in the UI; they are never passed to an AI or executed.
        const payload = JSON.parse(ctx.vault.decrypt(v.payloadJsonEncrypted, `submission:${v.id}`)) as ObservationPayload;
        return {
          id: v.id,
          version: v.versionNumber,
          count: v.observedCount,
          amendmentReason: payload.amendmentReason,
          amendmentStatus: v.amendmentStatus,
          visitDate: payload.visitDate,
          captureMethod: payload.captureMethod,
          notes: payload.notes,
          evidenceException: payload.evidenceException,
          receivedAt: v.receivedAt,
          deviceClaimedAt: v.deviceClaimedAt,
          anchorStatus: v.anchorStatus,
          anchorTxHash: v.anchorTxHash,
          payloadSha256: v.payloadSha256,
          commitment: v.commitment,
          evidence: v.evidence.map((e) => ({ id: e.id, sha256: e.sha256, mime: e.mime, bytes: e.byteSize, width: e.width, height: e.height, captureClaimedAt: e.captureClaimedAt })),
        };
      }),
      assessments: assessments.map((x) => ({
        id: x.id,
        provider: x.modelProvider,
        model: x.modelName,
        promptVersion: x.promptVersion,
        status: x.status,
        error: x.errorCode,
        createdAt: x.createdAt,
        flags: ((x.flagsJson as EvidenceFlag[] | null) ?? []).map((f) => ({ ...f, humanLabel: labels.get(f.id) ?? null })),
      })),
      actions: rc.actions.map((x) => ({ type: x.actionType, notes: x.notes, newState: x.newState, createdAt: x.createdAt })),
      reports: obs.reports.map((r) => ({ id: r.id, version: r.version, status: r.status, generatedAt: r.generatedAt })),
      firstSubmissionId: first.id,
      observationId: obs.id,
    });
  });

  app.get<{ Params: { id: string } }>("/v1/evidence/:id/content", async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw notFound();
    const ev = await ctx.prisma.evidenceFile.findUnique({ where: { id: req.params.id } });
    if (!ev) throw notFound();
    const scope = await requireMember(ctx, req, ev.organizationId);
    const isUploader = ev.uploadedBy === scope.user.id;
    if (!isUploader && !scope.roles.some((r) => r === "REVIEWER" || r === "MANAGER")) throw notFound();
    await audit(ctx.prisma, { organizationId: ev.organizationId, actorId: scope.user.id, action: "evidence.viewed", objectType: "evidence_file", objectId: ev.id, traceId: req.id });
    return reply.header("content-type", ev.mime).header("content-disposition", "inline").header("content-security-policy", "default-src 'none'").send(await ctx.store.get(ev.storageKey));
  });

  app.post<{ Params: { id: string; flagId: string } }>("/v1/reviews/:id/flags/:flagId/label", async (req) => {
    const { rc, scope } = await loadCase(req, req.params.id);
    if (!scope.roles.includes("REVIEWER")) throw forbidden();
    const { label, notes } = parse(z.object({ label: z.enum(["USEFUL", "FALSE_POSITIVE", "NEEDS_FOLLOW_UP"]), notes: z.string().max(1000).optional() }), req.body);
    const flagId = req.params.flagId;
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(flagId)) throw notFound();
    await ctx.prisma.reviewAction.create({ data: { organizationId: rc.organizationId, reviewCaseId: rc.id, actorId: scope.user.id, actionType: "FLAG_LABEL", flagId, newState: label, notes: notes ?? null } });
    return ok(req, { flagId, label });
  });

  app.post<{ Params: { id: string } }>("/v1/reviews/:id/ai-review", async (req) => {
    const { rc, scope } = await loadCase(req, req.params.id);
    if (!scope.roles.includes("REVIEWER")) throw forbidden();
    const r = await runAiReview(ctx, rc.observation.versions[0]!.id);
    await audit(ctx.prisma, { organizationId: rc.organizationId, actorId: scope.user.id, action: "ai.assessment_requested", objectType: "review_case", objectId: rc.id, traceId: req.id, metadata: { status: r.status } });
    return ok(req, r);
  });

  app.post<{ Params: { id: string } }>("/v1/reviews/:id/decision", async (req) => {
    const { rc, scope } = await loadCase(req, req.params.id);
    if (!scope.roles.includes("REVIEWER")) throw forbidden();
    requireFreshAuth(scope.user);
    const body = parse(z.object({ decision: z.enum(["APPROVE", "APPROVE_ORIGINAL", "DISPUTE", "REQUEST_CORRECTION"]), reason: z.string().trim().min(5).max(2000) }), req.body);
    const versions = [...rc.observation.versions].sort((x, y) => x.versionNumber - y.versionNumber);
    const original = versions[0]!;
    const latest = versions[versions.length - 1]!;
    if (body.decision === "APPROVE_ORIGINAL" && versions.length < 2) throw new ApiError("INVALID_REQUEST", "There is no correction to set aside");
    if (versions.some((v) => v.anchorStatus !== "CONFIRMED")) throw new ApiError("STATE_CONFLICT", "Wait until every version is anchored before deciding");
    if (rc.state !== "OPEN") throw new ApiError("STATE_CONFLICT", "This review already has a decision");
    // SoD: the criterion author cannot be sole authority over a disputed outcome (PRD 3.2).
    // SoD (PRD 3.2): whoever set the hidden criterion knew it during collection, so they never decide outcomes.
    if (rc.observation.assignment.cohort.criterion?.createdBy === scope.user.id) {
      throw forbidden("The person who set the criterion can't decide review outcomes for this cohort");
    }
    const approved = body.decision === "APPROVE" || body.decision === "APPROVE_ORIGINAL";
    const newState = approved ? "APPROVED" : body.decision === "DISPUTE" ? "DISPUTED" : "CORRECTION_REQUESTED";
    // The accepted version is explicit: the latest (accepting any correction) or the original.
    const acceptedVersion = body.decision === "APPROVE" ? latest : body.decision === "APPROVE_ORIGINAL" ? original : null;
    await ctx.prisma.$transaction(async (tx) => {
      const r = await tx.reviewCase.updateMany({ where: { id: rc.id, state: "OPEN" }, data: { state: newState, decision: body.decision, decisionReason: body.reason, decidedBy: scope.user.id, decidedAt: new Date(), assignedReviewerId: scope.user.id } });
      if (r.count !== 1) throw new ApiError("STATE_CONFLICT", "This review already has a decision");
      await tx.reviewAction.create({ data: { organizationId: rc.organizationId, reviewCaseId: rc.id, actorId: scope.user.id, actionType: body.decision, notes: body.reason, priorState: rc.state, newState } });
      await tx.observation.update({ where: { id: rc.observationId }, data: { reviewStatus: newState, currentApprovedVersionId: acceptedVersion?.id ?? null } });
      if (latest.versionNumber > 1) {
        const amendmentStatus = body.decision === "APPROVE" ? "ACCEPTED" : body.decision === "APPROVE_ORIGINAL" ? "SET_ASIDE" : body.decision === "DISPUTE" ? "DISPUTED" : "SUPERSEDED";
        await tx.submissionVersion.update({ where: { id: latest.id }, data: { amendmentStatus } });
      }
      await tx.assignment.update({ where: { id: rc.observation.assignmentId }, data: { status: approved ? "APPROVED" : body.decision === "DISPUTE" ? "DISPUTED" : "AMENDMENT_REQUESTED" } });
      await audit(tx, {
        organizationId: rc.organizationId,
        actorId: scope.user.id,
        action: approved ? "review.approved" : body.decision === "DISPUTE" ? "review.disputed" : "review.correction_requested",
        objectType: "review_case",
        objectId: rc.id,
        traceId: req.id,
        metadata: { acceptedVersion: acceptedVersion?.versionNumber ?? null },
      });
    });
    return ok(req, { state: newState });
  });

  // ---- reports ----
  app.post<{ Params: { id: string } }>("/v1/observations/:id/reports", async (req, reply) => {
    const idemKey = idempotencyKey(req);
    const obs = await ctx.prisma.observation.findUnique({
      where: { id: req.params.id },
      include: {
        versions: { orderBy: { versionNumber: "asc" }, include: { evidence: true } },
        evaluations: true,
        reviewCases: { orderBy: { createdAt: "desc" }, include: { actions: true } },
        reports: true,
        assignment: { include: { farm: true, cohort: { include: { programme: true, criterion: true } } } },
      },
    });
    if (!obs) throw notFound();
    const scope = await requireMember(ctx, req, obs.organizationId, "report.generate");
    const a = obs.assignment;
    if (a.auditorUserId === scope.user.id) throw notFound();
    // FR-047: confidential target only after disclosure; reports are generated from reviewed records.
    if (a.cohort.state !== "DISCLOSED") throw new ApiError("STATE_CONFLICT", "Reports are available after the cohort criterion has been disclosed");
    const rc = obs.reviewCases[0];
    if (!rc) throw new ApiError("STATE_CONFLICT", "No review case exists for this observation");
    if (obs.versions.some((v) => v.anchorStatus !== "CONFIRMED")) throw new ApiError("STATE_CONFLICT", "Every version must be anchored before a report is issued");

    const status = rc.state === "APPROVED" ? "APPROVED" : rc.state === "DISPUTED" ? "DISPUTED" : "PROVISIONAL";
    const acceptedVersionNumber = obs.versions.find((v) => v.id === obs.currentApprovedVersionId)?.versionNumber ?? null;
    const crit = a.cohort.criterion!;
    const aad = `criterion:${a.cohortId}`;
    const criterionObject = JSON.parse(ctx.criterionVault.decrypt(crit.targetCiphertext, aad)) as CriterionObject;
    const criterionSalt = ctx.criterionVault.decrypt(crit.targetSaltCiphertext, aad) as Hex;
    const devices = await ctx.prisma.deviceKey.findMany({ where: { id: { in: obs.versions.map((v) => v.deviceKeyId) } } });
    const auditor = await ctx.prisma.user.findUniqueOrThrow({ where: { id: a.auditorUserId } });
    const reviewer = rc.decidedBy ? await ctx.prisma.user.findUnique({ where: { id: rc.decidedBy } }) : null;
    const assessments = await ctx.prisma.aiAssessment.findMany({ where: { submissionVersionId: { in: obs.versions.map((v) => v.id) } } });
    const labels = new Map(rc.actions.filter((x) => x.actionType === "FLAG_LABEL" && x.flagId).map((x) => [x.flagId!, x.newState]));
    const evalFor = (versionId: string | undefined) => {
      const e = obs.evaluations.find((x) => x.submissionVersionId === versionId);
      return e ? { result: e.result, targetCount: e.targetCount, observedCount: e.observedCount, ruleVersion: e.ruleVersion } : null;
    };
    const originalEvaluation = evalFor(obs.versions[0]?.id);
    const acceptedEvaluation = evalFor(obs.currentApprovedVersionId ?? undefined);

    const replay = await ctx.prisma.report.findUnique({ where: { organizationId_idempotencyKey: { organizationId: obs.organizationId, idempotencyKey: idemKey } } });
    if (replay) return reply.status(200).send(ok(req, { id: replay.id, version: replay.version, status: replay.status, manifestSha256: replay.manifestSha256 }));
    const reportId = crypto.randomUUID();
    const version = obs.reports.length + 1;
    const generatedAt = new Date();
    const artifacts = await buildReportArtifacts(ctx, {
      reportId,
      version,
      generatedAt,
      status,
      programme: a.cohort.programme,
      cohort: { code: a.cohort.code, name: a.cohort.name, cohortKey: a.cohort.chainCampaignKey as Hex, targetCommitment: a.cohort.targetCommitment as Hex, closeTxHash: a.cohort.closeTxHash },
      assignment: { code: a.code, assignmentKey: a.assignmentKey as Hex, farmPseudonym: a.farm.displayPseudonym },
      auditor: { id: auditor.id, displayName: auditor.displayName },
      reviewer: reviewer ? { displayName: reviewer.displayName } : null,
      review: {
        decision: rc.decision,
        reason: rc.decisionReason,
        decidedAt: rc.decidedAt,
        flagNotes: assessments.flatMap((x) => ((x.flagsJson as EvidenceFlag[] | null) ?? []).map((f) => ({ code: f.code, reason: f.reason, label: labels.get(f.id) ?? null }))),
      },
      versions: obs.versions.map((v) => ({
        submissionId: v.id,
        payload: JSON.parse(ctx.vault.decrypt(v.payloadJsonEncrypted, `submission:${v.id}`)) as ObservationPayload,
        payloadSha256: v.payloadSha256,
        submissionSalt: ctx.vault.decrypt(v.commitmentSaltEncrypted, `salt:${v.id}`) as Hex,
        commitment: v.commitment as Hex,
        anchorTxHash: v.anchorTxHash as Hex | null,
        anchorBlockNumber: v.anchorBlockNumber,
        receivedAt: v.receivedAt,
        deviceKeyId: v.deviceKeyId,
        signature: v.deviceSignature,
        signatureFormat: v.signatureFormat,
        clientNonce: v.clientNonce,
      })),
      criterion: { object: criterionObject, salt: criterionSalt },
      evaluation: originalEvaluation,
      acceptedEvaluation,
      acceptedVersionNumber,
      deviceKeys: devices.map((d) => ({ deviceKeyId: d.id, userId: d.userId, publicJwk: d.publicJwk as JsonWebKey, enrolledAt: d.enrolledAt.toISOString(), revokedAt: d.revokedAt?.toISOString() ?? null, attestationLevel: d.attestationLevel })),
      evidence: await Promise.all(obs.versions.flatMap((v) => v.evidence).map(async (e) => ({ fileId: e.id, mime: e.mime, sha256: e.sha256, bytes: await ctx.store.get(e.storageKey) }))),
    });
    const [pdfKey, csvKey, zipKey] = await Promise.all([ctx.store.put("reports", artifacts.pdf), ctx.store.put("reports", artifacts.csv), ctx.store.put("packets", artifacts.zip)]);
    const report = await ctx.prisma.report
      .create({
        data: { id: reportId, idempotencyKey: idemKey, organizationId: obs.organizationId, observationId: obs.id, status, version, manifestSha256: artifacts.manifestSha256, pdfStorageKey: pdfKey, csvStorageKey: csvKey, packetStorageKey: zipKey, generatedBy: scope.user.id, generatedAt, releasedAt: status === "APPROVED" ? generatedAt : null },
      })
      .catch(async (e: unknown) => {
        await Promise.all([pdfKey, csvKey, zipKey].map((k) => ctx.store.delete(k)));
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new ApiError("STATE_CONFLICT", "Another report for this observation was generated at the same moment. Refresh to see it.");
        }
        throw e;
      });
    await audit(ctx.prisma, { organizationId: obs.organizationId, actorId: scope.user.id, action: "report.generated", objectType: "report", objectId: report.id, traceId: req.id, metadata: { status, version } });
    return reply.status(201).send(ok(req, { id: report.id, version, status, manifestSha256: report.manifestSha256 }));
  });

  app.get<{ Params: { orgId: string } }>("/v1/organizations/:orgId/reports", async (req) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "report.read");
    const reports = await ctx.prisma.report.findMany({ where: { organizationId: scope.organizationId }, include: { observation: { include: { assignment: { include: { farm: true, cohort: true } } } } }, orderBy: { generatedAt: "desc" }, take: 100 });
    return ok(req, reports.map((r) => ({ id: r.id, version: r.version, status: r.status, generatedAt: r.generatedAt, assignmentCode: r.observation.assignment.code, farmPseudonym: r.observation.assignment.farm.displayPseudonym, cohortCode: r.observation.assignment.cohort.code })));
  });

  app.get<{ Params: { id: string } }>("/v1/reports/:id", async (req) => {
    const r = await ctx.prisma.report.findUnique({ where: { id: req.params.id }, include: { shareGrants: { where: { revokedAt: null } }, observation: { include: { assignment: { include: { farm: true, cohort: true } } } } } });
    if (!r) throw notFound();
    await requireMember(ctx, req, r.organizationId, "report.read");
    return ok(req, {
      id: r.id,
      version: r.version,
      status: r.status,
      manifestSha256: r.manifestSha256,
      generatedAt: r.generatedAt,
      assignmentCode: r.observation.assignment.code,
      farmPseudonym: r.observation.assignment.farm.displayPseudonym,
      cohortCode: r.observation.assignment.cohort.code,
      shareGrants: r.shareGrants.map((g) => ({ id: g.id, recipientHint: g.recipientHint, expiresAt: g.expiresAt, downloadLimit: g.downloadLimit, downloadsUsed: g.downloadsUsed })),
    });
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string; grant?: string } }>("/v1/reports/:id/download", async (req, reply) => {
    const format = req.query.format ?? "zip";
    if (!["pdf", "csv", "zip"].includes(format)) throw new ApiError("INVALID_REQUEST", "format must be pdf, csv or zip");
    const r = await ctx.prisma.report.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound();
    let actorId: string | null = null;
    if (req.query.grant) {
      const g = await ctx.prisma.shareGrant.findUnique({ where: { tokenHash: sha256(req.query.grant) } });
      if (!g || g.reportId !== r.id || g.revokedAt || g.expiresAt < new Date()) throw notFound();
      const claimed = await ctx.prisma.shareGrant.updateMany({ where: { id: g.id, downloadsUsed: { lt: g.downloadLimit } }, data: { downloadsUsed: { increment: 1 } } });
      if (!claimed.count) throw new ApiError("NOT_AUTHORIZED", "This share link has reached its download limit");
    } else {
      actorId = (await requireMember(ctx, req, r.organizationId, "report.read")).user.id;
    }
    await audit(ctx.prisma, { organizationId: r.organizationId, actorId, actorType: actorId ? "user" : "system", action: "report.downloaded", objectType: "report", objectId: r.id, traceId: req.id, metadata: { format, viaGrant: !!req.query.grant } });
    const key = format === "pdf" ? r.pdfStorageKey : format === "csv" ? r.csvStorageKey : r.packetStorageKey;
    const type = format === "pdf" ? "application/pdf" : format === "csv" ? "text/csv; charset=utf-8" : "application/zip";
    const name = format === "zip" ? `blindcount-proof-${r.id}.zip` : `blindcount-report-${r.id}.${format}`;
    return reply.header("content-type", type).header("content-disposition", `attachment; filename="${name}"`).send(await ctx.store.get(key));
  });

  app.post<{ Params: { id: string } }>("/v1/reports/:id/share-grants", async (req, reply) => {
    const r = await ctx.prisma.report.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound();
    const scope = await requireMember(ctx, req, r.organizationId, "report.share");
    const body = parse(z.object({ recipientHint: z.string().trim().min(2).max(120), expiresInHours: z.number().int().min(1).max(24 * 14).default(72), downloadLimit: z.number().int().min(1).max(20).default(3) }), req.body);
    const token = newToken();
    const g = await ctx.prisma.shareGrant.create({
      data: { organizationId: r.organizationId, reportId: r.id, recipientHint: body.recipientHint, tokenHash: sha256(token), expiresAt: new Date(Date.now() + body.expiresInHours * 3600_000), downloadLimit: body.downloadLimit, grantedBy: scope.user.id },
    });
    await audit(ctx.prisma, { organizationId: r.organizationId, actorId: scope.user.id, action: "report.shared", objectType: "share_grant", objectId: g.id, traceId: req.id });
    return reply.status(201).send(ok(req, { id: g.id, expiresAt: g.expiresAt, downloadLimit: g.downloadLimit, url: `${ctx.cfg.WEB_URL}/v1/reports/${r.id}/download?format=zip&grant=${token}` }));
  });

  app.delete<{ Params: { id: string } }>("/v1/share-grants/:id", async (req, reply) => {
    const g = await ctx.prisma.shareGrant.findUnique({ where: { id: req.params.id } });
    if (!g) throw notFound();
    const scope = await requireMember(ctx, req, g.organizationId);
    if (g.grantedBy !== scope.user.id && !scope.roles.includes("OWNER")) throw forbidden();
    await ctx.prisma.shareGrant.update({ where: { id: g.id }, data: { revokedAt: g.revokedAt ?? new Date() } });
    await audit(ctx.prisma, { organizationId: g.organizationId, actorId: scope.user.id, action: "report.share_revoked", objectType: "share_grant", objectId: g.id, traceId: req.id });
    return reply.status(204).send();
  });
}
