import type { FastifyInstance } from "fastify";
import { audit, type AppContext } from "../lib/context";
import { ApiError, notFound } from "../lib/errors";
import { ok, requireMember } from "../lib/http";

/** Operator view of the chain queue: what is waiting, failing or dead, and a retry for dead jobs (PRD 10.5). */
export function opsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Params: { orgId: string } }>("/v1/organizations/:orgId/jobs", async (req) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "ops.jobs");
    const jobs = await ctx.prisma.anchorJob.findMany({
      where: { organizationId: scope.organizationId, state: { in: ["QUEUED", "RUNNING", "FAILED", "DEAD"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok(req, jobs.map((j) => ({ id: j.id, kind: j.kind, state: j.state, attempts: j.attempts, txHash: j.txHash, lastError: j.lastErrorCode, nextRetryAt: j.nextRetryAt, createdAt: j.createdAt })));
  });

  app.post<{ Params: { id: string } }>("/v1/jobs/:id/requeue", async (req) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw notFound();
    const job = await ctx.prisma.anchorJob.findUnique({ where: { id: req.params.id } });
    if (!job) throw notFound();
    const scope = await requireMember(ctx, req, job.organizationId, "ops.jobs");
    if (job.state !== "DEAD" && job.state !== "FAILED") throw new ApiError("STATE_CONFLICT", "Only failed or dead-lettered jobs can be retried");
    await ctx.prisma.$transaction(async (tx) => {
      await tx.anchorJob.update({ where: { id: job.id }, data: { state: "QUEUED", attempts: 0, nextRetryAt: new Date(), lastErrorCode: null, lockedUntil: null } });
      // Put the business entity back into its in-flight state; the worker re-reads chain state before acting.
      if (job.kind === "anchor_submission") {
        const sv = await tx.submissionVersion.findUnique({ where: { id: job.entityId }, include: { observation: true } });
        if (sv && sv.anchorStatus === "FAILED") {
          await tx.submissionVersion.update({ where: { id: sv.id }, data: { anchorStatus: "PENDING" } });
          await tx.assignment.updateMany({ where: { id: sv.observation.assignmentId, status: "ANCHOR_FAILED" }, data: { status: "ANCHOR_PENDING" } });
        }
      }
      if (job.kind === "publish_cohort") await tx.cohort.updateMany({ where: { id: job.entityId, state: "PUBLISH_FAILED" }, data: { state: "PUBLISH_PENDING", lastError: null } });
      await audit(tx, { organizationId: job.organizationId, actorId: scope.user.id, action: "job.requeued", objectType: "anchor_job", objectId: job.id, traceId: req.id, metadata: { kind: job.kind } });
    });
    return ok(req, { requeued: true });
  });
}
