import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Hex } from "viem";
import { criterionHash, deriveAssignmentKey, deriveCohortKey, hashCanonical, randomBytes32, targetCommitment, type CriterionObject } from "@blindcount/crypto";
import { can, evaluate, evaluationDigest, isClosureTerminal, RULE_VERSION, type AssignmentStatus, type Role } from "@blindcount/domain";
import type { Prisma } from "@blindcount/db";
import { audit, type AppContext } from "../lib/context";
import { ApiError, forbidden, notFound } from "../lib/errors";
import { idempotencyKey, ok, parse, requireFreshAuth, requireMember } from "../lib/http";
import { enqueue } from "../worker";
import { auditorProjection } from "./projections";

export function cohortRoutes(app: FastifyInstance, ctx: AppContext) {
  const chainDomain = { chainId: ctx.cfg.CHAIN_ID, registryAddress: ctx.registry.address };

  async function loadCohort(req: Parameters<typeof requireMember>[1], id: string, action?: Parameters<typeof requireMember>[3]) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
    const cohort = await ctx.prisma.cohort.findUnique({ where: { id }, include: { programme: true } });
    if (!cohort) throw notFound();
    const scope = await requireMember(ctx, req, cohort.organizationId, action);
    return { cohort, scope };
  }

  // ---- programmes ----
  app.get<{ Params: { orgId: string } }>("/v1/organizations/:orgId/programmes", async (req) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "programme.read");
    const programmes = await ctx.prisma.programme.findMany({
      where: { organizationId: scope.organizationId },
      include: { cohorts: { select: { id: true, code: true, name: true, state: true, expectedCount: true, dueAt: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok(req, programmes);
  });

  app.post<{ Params: { orgId: string } }>("/v1/organizations/:orgId/programmes", async (req, reply) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "programme.write");
    const body = parse(
      z
        .object({
          code: z.string().trim().regex(/^[A-Z0-9-]{2,32}$/, "2-32 uppercase letters, digits or hyphens"),
          name: z.string().trim().min(2).max(120),
          crop: z.string().trim().min(2).max(40),
          regionLabel: z.string().trim().min(2).max(80),
          purpose: z.string().trim().min(2).max(500),
          startAt: z.coerce.date(),
          endAt: z.coerce.date(),
          retentionDays: z.number().int().min(30).max(3650).default(365),
          dataSource: z.enum(["SIMULATED_DEMO", "FIELD_DATA"]).default("SIMULATED_DEMO"),
        })
        .refine((b) => b.endAt > b.startAt, { path: ["endAt"], message: "End must be after start" }),
      req.body,
    );
    const exists = await ctx.prisma.programme.findUnique({ where: { organizationId_code: { organizationId: scope.organizationId, code: body.code } } });
    if (exists) throw new ApiError("STATE_CONFLICT", "A programme with this code already exists", { field: "code" });
    const p = await ctx.prisma.programme.create({ data: { ...body, organizationId: scope.organizationId } });
    await audit(ctx.prisma, { organizationId: scope.organizationId, actorId: scope.user.id, action: "programme.created", objectType: "programme", objectId: p.id, traceId: req.id });
    return reply.status(201).send(ok(req, p));
  });

  app.get<{ Params: { id: string } }>("/v1/programmes/:id", async (req) => {
    const p = await ctx.prisma.programme.findUnique({ where: { id: req.params.id }, include: { cohorts: { orderBy: { createdAt: "desc" } } } });
    if (!p) throw notFound();
    await requireMember(ctx, req, p.organizationId, "programme.read");
    return ok(req, { ...p, cohorts: p.cohorts.map((c) => ({ id: c.id, code: c.code, name: c.name, state: c.state, expectedCount: c.expectedCount, dueAt: c.dueAt })) });
  });

  app.delete<{ Params: { id: string } }>("/v1/programmes/:id", async (req, reply) => {
    const p = await ctx.prisma.programme.findUnique({ where: { id: req.params.id }, include: { _count: { select: { cohorts: true } } } });
    if (!p) throw notFound();
    const scope = await requireMember(ctx, req, p.organizationId, "programme.write");
    if (p._count.cohorts > 0) throw new ApiError("STATE_CONFLICT", "Programmes with cohorts cannot be deleted");
    await ctx.prisma.$transaction([ctx.prisma.farm.deleteMany({ where: { programmeId: p.id } }), ctx.prisma.programme.delete({ where: { id: p.id } })]);
    await audit(ctx.prisma, { organizationId: p.organizationId, actorId: scope.user.id, action: "programme.deleted", objectType: "programme", objectId: p.id, traceId: req.id });
    return reply.status(204).send();
  });

  // ---- cohort lifecycle ----
  app.post<{ Params: { id: string } }>("/v1/programmes/:id/cohorts", async (req, reply) => {
    const p = await ctx.prisma.programme.findUnique({ where: { id: req.params.id } });
    if (!p) throw notFound();
    const scope = await requireMember(ctx, req, p.organizationId, "cohort.write");
    const body = parse(
      z.object({
        code: z.string().trim().regex(/^[A-Z0-9-]{2,32}$/),
        name: z.string().trim().min(2).max(120),
        dueAt: z.coerce.date().refine((d) => d > new Date(), "Due date must be in the future"),
        closingAfter: z.coerce.date().nullable().default(null),
      }),
      req.body,
    );
    if (await ctx.prisma.cohort.findUnique({ where: { programmeId_code: { programmeId: p.id, code: body.code } } }))
      throw new ApiError("STATE_CONFLICT", "A cohort with this code already exists in the programme", { field: "code" });
    const id = crypto.randomUUID();
    const nonce = randomBytes32();
    const cohort = await ctx.prisma.cohort.create({
      data: {
        id,
        organizationId: p.organizationId,
        programmeId: p.id,
        code: body.code,
        name: body.name,
        dueAt: body.dueAt,
        closingAfter: body.closingAfter,
        cohortNonce: nonce,
        chainCampaignKey: deriveCohortKey({ organizationId: p.organizationId, cohortId: id, nonce }),
        createdBy: scope.user.id,
      },
    });
    await audit(ctx.prisma, { organizationId: p.organizationId, actorId: scope.user.id, action: "cohort.created", objectType: "cohort", objectId: cohort.id, traceId: req.id });
    return reply.status(201).send(ok(req, await cohortView(cohort.id, scope.roles, scope.user.id)));
  });

  app.put<{ Params: { id: string } }>("/v1/cohorts/:id/criterion", async (req) => {
    const { cohort, scope } = await loadCohort(req, req.params.id, "cohort.criterion.set");
    if (cohort.state !== "DRAFT") throw new ApiError("COHORT_LOCKED", "Criterion cannot change after publishing. Clone a new cohort instead.");
    const body = parse(z.object({ operator: z.literal("gte"), targetCount: z.number().int().min(0).max(100_000) }), req.body);
    const criterion: CriterionObject = {
      schema: "blindcount.criterion.v1",
      operator: "gte",
      unit: "shade_trees",
      targetCount: body.targetCount,
      cohortKey: cohort.chainCampaignKey as Hex,
      version: 1,
    };
    const salt = randomBytes32();
    const chash = await criterionHash(criterion);
    const commitment = targetCommitment({ ...chainDomain, cohortKey: cohort.chainCampaignKey as Hex, criterionHash: chash, criterionSalt: salt });
    const aad = `criterion:${cohort.id}`;
    const v = ctx.criterionVault;
    const data = {
      targetCiphertext: v.encrypt(JSON.stringify(criterion), aad),
      targetSaltCiphertext: v.encrypt(salt, aad),
      canonicalTargetHashCt: v.encrypt(chash, aad),
      keyRef: v.ref,
      commitment,
    };
    await ctx.prisma.$transaction(async (tx) => {
      // Lock and recheck so a criterion edit can't race a publish that already committed the old value.
      const [locked] = await tx.$queryRaw<Array<{ state: string }>>`SELECT state FROM cohorts WHERE id = ${cohort.id}::uuid FOR UPDATE`;
      if (locked?.state !== "DRAFT") throw new ApiError("COHORT_LOCKED", "Criterion cannot change after publishing. Clone a new cohort instead.");
      await tx.criterionVersion.upsert({ where: { cohortId: cohort.id }, create: { ...data, organizationId: cohort.organizationId, cohortId: cohort.id, createdBy: scope.user.id }, update: { ...data, createdBy: scope.user.id } });
      await tx.cohort.update({ where: { id: cohort.id }, data: { targetCommitment: commitment } });
      await audit(tx, { organizationId: cohort.organizationId, actorId: scope.user.id, action: "criterion.committed", objectType: "cohort", objectId: cohort.id, traceId: req.id });
    });
    // The value itself is never echoed back (PRD 10.2).
    return ok(req, { targetCommitment: commitment, operator: "gte", unit: "shade_trees", criterionSet: true });
  });

  const rosterSchema = z.object({
    preview: z.boolean().default(false),
    assignments: z
      .array(
        z.object({
          farmCode: z.string().trim().regex(/^[A-Za-z0-9-]{2,32}$/),
          farmPseudonym: z.string().trim().min(2).max(64),
          coarseRegion: z.string().trim().max(80).optional(),
          auditorUserId: z.string().uuid(),
          dueAt: z.coerce.date().optional(),
        }),
      )
      .min(1)
      .max(500),
  });

  app.post<{ Params: { id: string } }>("/v1/cohorts/:id/assignments", async (req, reply) => {
    const { cohort, scope } = await loadCohort(req, req.params.id, "cohort.write");
    if (cohort.state !== "DRAFT") throw new ApiError("ROSTER_FROZEN", "The roster is frozen after publishing");
    const body = parse(rosterSchema, req.body);

    const auditors = await ctx.prisma.membership.findMany({ where: { organizationId: cohort.organizationId, status: "ACTIVE", roles: { has: "AUDITOR" } }, select: { userId: true, roles: true } });
    const auditorIds = new Set(auditors.map((a) => a.userId));
    // Anyone who can know the target or read counts before closure can't also collect them blind.
    const criterionAuthor = (await ctx.prisma.criterionVersion.findUnique({ where: { cohortId: cohort.id }, select: { createdBy: true } }))?.createdBy;
    const conflicted = new Set(auditors.filter((a) => a.roles.some((r) => r === "MANAGER" || r === "OWNER" || r === "CUSTODIAN") || a.userId === criterionAuthor).map((a) => a.userId));
    const existing = await ctx.prisma.assignment.findMany({ where: { cohortId: cohort.id }, include: { farm: true } });
    const seen = new Set(existing.map((a) => a.farm.externalCode));
    const issues: Array<{ row: number; field: string; message: string }> = [];
    body.assignments.forEach((a, row) => {
      if (seen.has(a.farmCode)) issues.push({ row, field: "farmCode", message: `Duplicate farm ${a.farmCode} in this cohort` });
      seen.add(a.farmCode);
      if (!auditorIds.has(a.auditorUserId)) issues.push({ row, field: "auditorUserId", message: "Not an active auditor in this organization" });
      if (a.auditorUserId === scope.user.id) issues.push({ row, field: "auditorUserId", message: "The cohort manager cannot audit their own cohort" });
      else if (conflicted.has(a.auditorUserId)) issues.push({ row, field: "auditorUserId", message: "This person can see the criterion or pre-closure counts, so they can't audit blind" });
      if (a.dueAt && a.dueAt > cohort.dueAt) issues.push({ row, field: "dueAt", message: "Assignment due date is after the cohort due date" });
    });
    if (body.preview || issues.length) {
      return reply.status(issues.length && !body.preview ? 422 : 200).send(ok(req, { preview: true, valid: issues.length === 0, issues, count: body.assignments.length }));
    }
    await ctx.prisma.$transaction(async (tx) => {
      for (const a of body.assignments) {
        const farm = await tx.farm.upsert({
          where: { programmeId_externalCode: { programmeId: cohort.programmeId, externalCode: a.farmCode } },
          create: { organizationId: cohort.organizationId, programmeId: cohort.programmeId, externalCode: a.farmCode, displayPseudonym: a.farmPseudonym, coarseRegion: a.coarseRegion ?? null },
          update: {},
        });
        const id = crypto.randomUUID();
        const nonce = randomBytes32();
        // Next number after the highest existing code, so deleting a draft row never causes a reuse.
        const codes = await tx.assignment.findMany({ where: { cohortId: cohort.id }, select: { code: true } });
        const n = codes.reduce((max, c) => Math.max(max, Number(c.code.split("-").pop()) || 0), 0) + 1;
        await tx.assignment.create({
          data: {
            id,
            organizationId: cohort.organizationId,
            cohortId: cohort.id,
            farmId: farm.id,
            auditorUserId: a.auditorUserId,
            code: `${cohort.code}-${String(n).padStart(3, "0")}`,
            keyNonce: nonce,
            assignmentKey: deriveAssignmentKey({ organizationId: cohort.organizationId, cohortId: cohort.id, assignmentId: id, nonce }),
            dueAt: a.dueAt ?? cohort.dueAt,
          },
        });
      }
      const count = await tx.assignment.count({ where: { cohortId: cohort.id } });
      await tx.cohort.update({ where: { id: cohort.id }, data: { expectedCount: count } });
      await audit(tx, { organizationId: cohort.organizationId, actorId: scope.user.id, action: "roster.imported", objectType: "cohort", objectId: cohort.id, traceId: req.id, metadata: { added: body.assignments.length } });
    }, { timeout: 60_000 });
    return reply.status(201).send(ok(req, await cohortView(cohort.id, scope.roles, scope.user.id)));
  });

  app.delete<{ Params: { id: string; assignmentId: string } }>("/v1/cohorts/:id/assignments/:assignmentId", async (req, reply) => {
    const { cohort, scope } = await loadCohort(req, req.params.id, "cohort.write");
    if (cohort.state !== "DRAFT") throw new ApiError("ROSTER_FROZEN", "Published assignments cannot be deleted; request a void instead");
    const r = await ctx.prisma.assignment.deleteMany({ where: { id: req.params.assignmentId, cohortId: cohort.id } });
    if (!r.count) throw notFound();
    await ctx.prisma.cohort.update({ where: { id: cohort.id }, data: { expectedCount: await ctx.prisma.assignment.count({ where: { cohortId: cohort.id } }) } });
    await audit(ctx.prisma, { organizationId: cohort.organizationId, actorId: scope.user.id, action: "roster.assignment_removed", objectType: "assignment", objectId: req.params.assignmentId, traceId: req.id });
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/v1/cohorts/:id/blind-preview", async (req) => {
    const { cohort } = await loadCohort(req, req.params.id, "cohort.write");
    const first = await ctx.prisma.assignment.findFirst({ where: { cohortId: cohort.id }, orderBy: { code: "asc" } });
    if (!first) throw new ApiError("STATE_CONFLICT", "Add at least one assignment to preview the auditor view");
    // Exactly the projection served to auditors by GET /assignments/:id/form.
    return ok(req, await auditorProjection(ctx, first.id));
  });

  app.post<{ Params: { id: string } }>("/v1/cohorts/:id/publish", async (req, reply) => {
    idempotencyKey(req);
    const { cohort, scope } = await loadCohort(req, req.params.id, "cohort.write");
    if (cohort.state === "PUBLISH_PENDING" || cohort.state === "ACTIVE") return reply.status(202).send(ok(req, await cohortView(cohort.id, scope.roles, scope.user.id)));
    if (cohort.state !== "DRAFT" && cohort.state !== "PUBLISH_FAILED") throw new ApiError("STATE_CONFLICT", `Cannot publish a ${cohort.state} cohort`);
    const criterion = await ctx.prisma.criterionVersion.findUnique({ where: { cohortId: cohort.id }, select: { id: true } });
    if (!criterion) throw new ApiError("STATE_CONFLICT", "Set the hidden criterion before publishing", { field: "criterion" });
    if (cohort.expectedCount === 0) throw new ApiError("STATE_CONFLICT", "Publishing requires at least one assignment", { field: "assignments" });

    await ctx.prisma.$transaction(async (tx) => {
      const r = await tx.cohort.updateMany({ where: { id: cohort.id, state: { in: ["DRAFT", "PUBLISH_FAILED"] } }, data: { state: "PUBLISH_PENDING", rosterFrozenAt: new Date(), lastError: null } });
      if (r.count !== 1) throw new ApiError("STATE_CONFLICT", "Cohort state changed concurrently");
      await tx.criterionVersion.updateMany({ where: { cohortId: cohort.id, lockedAt: null }, data: { lockedAt: new Date() } });
      await audit(tx, { organizationId: cohort.organizationId, actorId: scope.user.id, action: "roster.frozen", objectType: "cohort", objectId: cohort.id, traceId: req.id, metadata: { expected: cohort.expectedCount } });
      await enqueue(tx, { organizationId: cohort.organizationId, kind: "publish_cohort", entityId: cohort.id, eventKey: `publish:${cohort.id}:${Date.now()}` });
    });
    return reply.status(202).send(ok(req, await cohortView(cohort.id, scope.roles, scope.user.id)));
  });

  app.get<{ Params: { id: string } }>("/v1/cohorts/:id", async (req) => {
    const { cohort, scope } = await loadCohort(req, req.params.id);
    if (!can(scope.roles, "cohort.read")) throw notFound();
    return ok(req, await cohortView(cohort.id, scope.roles, scope.user.id));
  });

  app.get<{ Params: { id: string } }>("/v1/cohorts/:id/progress", async (req) => {
    const { cohort } = await loadCohort(req, req.params.id, "cohort.read");
    return ok(req, await progress(cohort.id));
  });

  app.post<{ Params: { id: string } }>("/v1/cohorts/:id/close", async (req, reply) => {
    idempotencyKey(req);
    const { cohort, scope } = await loadCohort(req, req.params.id, "cohort.close");
    if (cohort.state === "CLOSING_PENDING" || cohort.state === "CLOSED") return reply.status(202).send(ok(req, await cohortView(cohort.id, scope.roles, scope.user.id)));
    if (cohort.state !== "ACTIVE") throw new ApiError("STATE_CONFLICT", `Cannot close a ${cohort.state} cohort`);
    if (cohort.closingAfter && cohort.closingAfter > new Date()) {
      throw new ApiError("COHORT_NOT_CLOSABLE", `This cohort's published policy allows closure from ${cohort.closingAfter.toISOString()}.`, { closingAfter: cohort.closingAfter.toISOString() });
    }
    const p = await progress(cohort.id);
    if (p.blockers.length) {
      throw new ApiError("COHORT_NOT_CLOSABLE", `${p.blockers.length} assignment(s) have no sealed result or approved void.`, { outstandingCount: p.blockers.length, blockers: p.blockers });
    }
    const onchain = await ctx.registry.cohortStatus(cohort.chainCampaignKey as Hex).catch(() => {
      throw new ApiError("CHAIN_UNAVAILABLE", "Cannot reach the chain to confirm terminal counts; closure is blocked");
    });
    if (onchain.terminal !== onchain.expected || onchain.expected !== cohort.expectedCount) {
      throw new ApiError("COHORT_NOT_CLOSABLE", "Onchain roster does not yet show every assignment as terminal", { onchainTerminal: onchain.terminal, onchainExpected: onchain.expected });
    }
    await ctx.prisma.$transaction(async (tx) => {
      const r = await tx.cohort.updateMany({ where: { id: cohort.id, state: "ACTIVE" }, data: { state: "CLOSING_PENDING", lastError: null } });
      if (r.count !== 1) throw new ApiError("STATE_CONFLICT", "Cohort state changed concurrently");
      await audit(tx, { organizationId: cohort.organizationId, actorId: scope.user.id, action: "cohort.close_requested", objectType: "cohort", objectId: cohort.id, traceId: req.id });
      await enqueue(tx, { organizationId: cohort.organizationId, kind: "close_cohort", entityId: cohort.id, eventKey: `close:${cohort.id}:${Date.now()}` });
    });
    return reply.status(202).send(ok(req, await cohortView(cohort.id, scope.roles, scope.user.id)));
  });

  app.post<{ Params: { id: string } }>("/v1/cohorts/:id/disclose", async (req) => {
    const { cohort, scope } = await loadCohort(req, req.params.id, "cohort.disclose");
    requireFreshAuth(scope.user);
    if (cohort.state !== "CLOSED") throw new ApiError("STATE_CONFLICT", cohort.state === "DISCLOSED" ? "Criterion already disclosed" : "The criterion can only be disclosed after confirmed onchain closure");
    const crit = await ctx.prisma.criterionVersion.findUniqueOrThrow({ where: { cohortId: cohort.id } });
    const criterion = JSON.parse(ctx.criterionVault.decrypt(crit.targetCiphertext, `criterion:${cohort.id}`)) as CriterionObject;

    const assignments = await ctx.prisma.assignment.findMany({ where: { cohortId: cohort.id, status: { not: "VOIDED" } }, include: { observation: { include: { versions: { where: { versionNumber: 1 } } } } } });
    const now = new Date();
    const receiptHash = `0x${await hashCanonical({ schema: "blindcount.disclosure.v1", cohortKey: cohort.chainCampaignKey, disclosedAt: now.toISOString(), disclosedBy: scope.user.id, nonce: randomBytes32() })}` as Hex;

    await ctx.prisma.$transaction(async (tx) => {
      const r = await tx.cohort.updateMany({ where: { id: cohort.id, state: "CLOSED" }, data: { state: "DISCLOSED", disclosedAt: now } });
      if (r.count !== 1) throw new ApiError("STATE_CONFLICT", "Cohort state changed concurrently");
      await tx.criterionVersion.update({ where: { id: crit.id }, data: { revealedAt: now } });
      for (const a of assignments) {
        const v1 = a.observation?.versions[0];
        if (!a.observation || !v1) continue;
        const input = { operator: "gte" as const, observedCount: v1.observedCount, targetCount: criterion.targetCount };
        const result = evaluate(input);
        await tx.evaluation.create({
          data: {
            organizationId: cohort.organizationId,
            observationId: a.observation.id,
            criterionVersionId: crit.id,
            submissionVersionId: v1.id,
            comparisonOperator: "gte",
            observedCount: v1.observedCount,
            targetCount: criterion.targetCount,
            result,
            ruleVersion: RULE_VERSION,
            resultDigest: await evaluationDigest({ ...input, result, submissionPayloadSha256: v1.payloadSha256 }),
          },
        });
        await tx.reviewCase.create({ data: { organizationId: cohort.organizationId, observationId: a.observation.id, state: "OPEN" } });
        await tx.observation.update({ where: { id: a.observation.id }, data: { reviewStatus: "REVIEW_PENDING" } });
        await tx.assignment.update({ where: { id: a.id }, data: { status: "REVIEW_PENDING" } });
      }
      await audit(tx, { organizationId: cohort.organizationId, actorId: scope.user.id, action: "criterion.disclosed", objectType: "cohort", objectId: cohort.id, traceId: req.id, metadata: { evaluated: assignments.length } });
      await enqueue(tx, { organizationId: cohort.organizationId, kind: "record_disclosure", entityId: cohort.id, eventKey: `disclosure:${cohort.id}`, payload: receiptHash });
    }, { timeout: 60_000 });
    return ok(req, await cohortView(cohort.id, scope.roles, scope.user.id));
  });

  // ---- void with two distinct approvals (P0: unstarted assignments only) ----
  app.post<{ Params: { id: string } }>("/v1/assignments/:id/void-request", async (req, reply) => {
    const a = await ctx.prisma.assignment.findUnique({ where: { id: req.params.id }, include: { cohort: true, observation: true } });
    if (!a) throw notFound();
    const scope = await requireMember(ctx, req, a.organizationId, "assignment.void.request");
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(1000) }), req.body);
    if (a.cohort.state !== "ACTIVE") throw new ApiError("STATE_CONFLICT", "Voids are only possible on an active cohort");
    if (a.observation || !["PENDING", "IN_PROGRESS", "EXPIRED"].includes(a.status)) throw new ApiError("STATE_CONFLICT", "Only assignments without a submission can be voided");
    await ctx.prisma.$transaction(async (tx) => {
      await tx.assignment.update({ where: { id: a.id }, data: { status: "VOID_PENDING", voidReason: reason } });
      await tx.assignmentApproval.create({ data: { organizationId: a.organizationId, assignmentId: a.id, action: "VOID", approverId: scope.user.id, reason, decision: "REQUESTED" } });
      await audit(tx, { organizationId: a.organizationId, actorId: scope.user.id, action: "exception.void_requested", objectType: "assignment", objectId: a.id, traceId: req.id });
    });
    return reply.status(202).send(ok(req, { status: "VOID_PENDING" }));
  });

  app.post<{ Params: { id: string } }>("/v1/assignments/:id/void-approve", async (req) => {
    const a = await ctx.prisma.assignment.findUnique({ where: { id: req.params.id }, include: { approvals: true } });
    if (!a) throw notFound();
    const scope = await requireMember(ctx, req, a.organizationId, "assignment.void.approve");
    requireFreshAuth(scope.user);
    const { decision, reason } = parse(z.object({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().min(5).max(1000) }), req.body);
    if (a.status !== "VOID_PENDING") throw new ApiError("STATE_CONFLICT", "No pending void request");
    const request = a.approvals.filter((p) => p.action === "VOID" && p.decision === "REQUESTED").sort((x, y) => y.decidedAt.getTime() - x.decidedAt.getTime())[0];
    if (!request) throw new ApiError("STATE_CONFLICT", "No pending void request");
    if (request.approverId === scope.user.id) throw forbidden("The requester cannot approve their own void request");
    if (a.auditorUserId === scope.user.id) throw forbidden("The assigned auditor cannot approve a void of their own assignment");
    await ctx.prisma.$transaction(async (tx) => {
      // Claim the pending request atomically so an approval and a rejection can't both land.
      const claimed = await tx.assignment.updateMany({ where: { id: a.id, status: "VOID_PENDING" }, data: decision === "REJECT" ? { status: "PENDING", voidReason: null } : { status: "VOID_PENDING" } });
      if (claimed.count !== 1) throw new ApiError("STATE_CONFLICT", "No pending void request");
      // Read after the row lock above, so a concurrent decision on this request is always visible here.
      if (await tx.assignmentApproval.findFirst({ where: { assignmentId: a.id, action: "VOID", decision: { in: ["APPROVE", "REJECT"] }, decidedAt: { gte: request.decidedAt } } })) {
        throw new ApiError("STATE_CONFLICT", "This void request was already decided");
      }
      await tx.assignmentApproval.create({ data: { organizationId: a.organizationId, assignmentId: a.id, action: "VOID", approverId: scope.user.id, reason, decision } });
      if (decision === "APPROVE") {
        await enqueue(tx, { organizationId: a.organizationId, kind: "void_assignment", entityId: a.id, eventKey: `void:${a.id}:${request.id}` });
      }
      await audit(tx, { organizationId: a.organizationId, actorId: scope.user.id, action: decision === "APPROVE" ? "exception.void_approved" : "exception.void_rejected", objectType: "assignment", objectId: a.id, traceId: req.id });
    });
    return ok(req, { status: decision === "APPROVE" ? "VOID_PENDING_CHAIN" : "PENDING" });
  });

  async function progress(cohortId: string) {
    const assignments = await ctx.prisma.assignment.findMany({ where: { cohortId }, include: { farm: { select: { displayPseudonym: true } } }, orderBy: { code: "asc" } });
    const counts: Record<string, number> = {};
    for (const a of assignments) counts[a.status] = (counts[a.status] ?? 0) + 1;
    const blockers = assignments
      .filter((a) => !isClosureTerminal(a.status as AssignmentStatus))
      .map((a) => ({ assignmentId: a.id, code: a.code, farmPseudonym: a.farm.displayPseudonym, status: a.status, late: a.dueAt < new Date() }));
    return { total: assignments.length, counts, blockers, closable: assignments.length > 0 && blockers.length === 0 };
  }

  /** Role-specific cohort projection. The criterion value only appears after DISCLOSED, and never for auditors. */
  async function cohortView(cohortId: string, roles: Role[], viewerId: string) {
    const c = await ctx.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
      include: {
        programme: { select: { id: true, code: true, name: true, dataSource: true } },
        criterion: { select: { id: true, operator: true, unit: true, commitment: true, lockedAt: true, revealedAt: true, targetCiphertext: true } },
        assignments: { include: { farm: { select: { displayPseudonym: true, externalCode: true } }, observation: { include: { versions: { select: { versionNumber: true, anchorTxHash: true, anchorStatus: true, receivedAt: true }, orderBy: { versionNumber: "asc" } } } } }, orderBy: { code: "asc" } },
      },
    });
    const auditorEmails = await ctx.prisma.user.findMany({ where: { id: { in: c.assignments.map((a) => a.auditorUserId) } }, select: { id: true, email: true, displayName: true } });
    const byId = new Map(auditorEmails.map((u) => [u.id, u]));
    const canSeeTarget = c.state === "DISCLOSED" || c.state === "ARCHIVED";
    const privileged = roles.some((r) => r === "MANAGER" || r === "REVIEWER" || r === "CUSTODIAN" || r === "OWNER");
    let disclosedTarget: number | null = null;
    if (canSeeTarget && privileged && c.criterion) {
      disclosedTarget = (JSON.parse(ctx.criterionVault.decrypt(c.criterion.targetCiphertext, `criterion:${c.id}`)) as CriterionObject).targetCount;
    }
    const evaluations = canSeeTarget ? await ctx.prisma.evaluation.findMany({ where: { observation: { assignment: { cohortId: c.id } } }, select: { observationId: true, result: true } }) : [];
    const evalByObs = new Map(evaluations.map((e) => [e.observationId, e.result]));
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      state: c.state,
      dueAt: c.dueAt,
      closingAfter: c.closingAfter,
      programme: c.programme,
      chain: { ...chainDomain, cohortKey: c.chainCampaignKey, targetCommitment: c.targetCommitment, publishTxHashes: c.publishTxHashes, closeTxHash: c.closeTxHash, disclosureTxHash: c.disclosureTxHash, explorerUrl: ctx.cfg.CHAIN_EXPLORER_URL ?? null },
      criterion: c.criterion
        ? { set: true, operator: c.criterion.operator, unit: c.criterion.unit, lockedAt: c.criterion.lockedAt, revealedAt: c.criterion.revealedAt, targetCount: disclosedTarget }
        : { set: false },
      expectedCount: c.expectedCount,
      publishedAt: c.publishedAt,
      closedAt: c.closedAt,
      disclosedAt: c.disclosedAt,
      lastError: c.lastError,
      assignments: c.assignments.map((a) => ({
        id: a.id,
        code: a.code,
        farmPseudonym: a.farm.displayPseudonym,
        farmCode: a.farm.externalCode,
        auditor: byId.get(a.auditorUserId) ?? null,
        status: a.status,
        dueAt: a.dueAt,
        observationId: a.observation?.id ?? null,
        anchorTxHash: a.observation?.versions[0]?.anchorTxHash ?? null,
        receivedAt: a.observation?.versions[0]?.receivedAt ?? null,
        // Someone holding both reviewer and auditor roles never sees the outcome of their own visit.
        outcome: a.observation && a.auditorUserId !== viewerId ? (evalByObs.get(a.observation.id) ?? null) : null,
        voidReason: a.voidReason,
      })),
    };
  }
}

export type CohortTx = Prisma.TransactionClient;
