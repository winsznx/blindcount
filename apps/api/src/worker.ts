import type { Hex } from "viem";
import { observationCommitment } from "@blindcount/crypto";
import { evaluate, evaluationDigest, RULE_VERSION } from "@blindcount/domain";
import type { Prisma } from "@blindcount/db";
import { audit, type AppContext } from "./lib/context";
import { ASSIGNMENT_STATE, COHORT_STATE, type ConfirmedTx } from "./lib/chain";
import { runDeterministicChecks } from "./review-checks";

export type JobKind = "publish_cohort" | "anchor_submission" | "close_cohort" | "record_disclosure" | "void_assignment" | "evidence_checks";

// Backoff 5 s doubling to a 5 min cap: about 25 minutes of retries before a job is dead-lettered,
// enough to ride out a public RPC rate limit or a briefly empty relayer wallet.
const MAX_ATTEMPTS = 10;
const RELAYER_LOCK_ID = 4_240_517;
const LEASE_MS = 15 * 60 * 1000;
const AWAIT_RETRY_MS = 10_000;

export async function enqueue(tx: Prisma.TransactionClient, j: { organizationId: string; kind: JobKind; entityId: string; eventKey: string; payload?: string }) {
  await tx.anchorJob.upsert({
    where: { eventKey: j.eventKey },
    create: { organizationId: j.organizationId, kind: j.kind, entityId: j.entityId, eventKey: j.eventKey, payload: j.payload ?? null },
    update: {},
  });
}

type Job = { id: string; kind: string; entity_id: string; attempts: number; tx_hash: string | null; payload: string | null; organization_id: string; event_key: string };

class PermanentJobError extends Error {}

/** A broadcast transaction is still pending or short of confirmations. Waiting never consumes a retry. */
class AwaitingChain extends Error {}

/**
 * Claims one due job with SKIP LOCKED. Run one worker per relayer key: two workers sending
 * from the same account would race on the account nonce.
 */
async function claim(ctx: AppContext): Promise<Job | null> {
  // Single flight across all workers: the advisory lock serializes claims, and no job is claimed
  // while another holds a live lease, so only one transaction is ever in flight from the relayer.
  return ctx.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RELAYER_LOCK_ID})`;
    const rows = await tx.$queryRaw<Job[]>`
      UPDATE anchor_jobs SET state = 'RUNNING', attempts = attempts + 1, locked_until = now() + (${LEASE_MS} || ' milliseconds')::interval, updated_at = now()
      WHERE id = (
        SELECT id FROM anchor_jobs
        WHERE ((state IN ('QUEUED', 'FAILED') AND next_retry_at <= now()) OR (state = 'RUNNING' AND locked_until < now()))
          AND NOT EXISTS (SELECT 1 FROM anchor_jobs live WHERE live.state = 'RUNNING' AND live.locked_until >= now())
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, kind, entity_id, attempts, tx_hash, payload, organization_id, event_key`;
    return rows[0] ?? null;
  });
}

export async function runOnce(ctx: AppContext): Promise<boolean> {
  const job = await claim(ctx);
  if (!job) return false;
  try {
    await handle(ctx, job);
    await ctx.prisma.anchorJob.update({ where: { id: job.id }, data: { state: "DONE", finalizedAt: new Date(), lastErrorCode: null, lockedUntil: null } });
  } catch (e) {
    const message = e instanceof Error ? e.message.split("\n")[0]!.slice(0, 300) : "unknown";
    if (e instanceof AwaitingChain) {
      await ctx.prisma.anchorJob.update({
        where: { id: job.id },
        data: { state: "QUEUED", attempts: { decrement: 1 }, lastErrorCode: message, nextRetryAt: new Date(Date.now() + AWAIT_RETRY_MS), lockedUntil: null },
      });
      return true;
    }
    const dead = e instanceof PermanentJobError || job.attempts >= MAX_ATTEMPTS;
    const backoff = Math.min(300_000, 5_000 * 2 ** (job.attempts - 1)) + Math.floor(Math.random() * 1_000);
    await ctx.prisma.anchorJob.update({
      where: { id: job.id },
      data: { state: dead ? "DEAD" : "FAILED", lastErrorCode: message, nextRetryAt: new Date(Date.now() + backoff), lockedUntil: null },
    });
    await onFailure(ctx, job, message, dead);
  }
  return true;
}

async function onFailure(ctx: AppContext, job: Job, message: string, dead: boolean) {
  if (job.kind === "anchor_submission") {
    const sv = await ctx.prisma.submissionVersion.findUnique({ where: { id: job.entity_id }, include: { observation: true } });
    if (sv && sv.anchorStatus !== "CONFIRMED") {
      await ctx.prisma.submissionVersion.update({ where: { id: sv.id }, data: { anchorStatus: dead ? "FAILED" : sv.anchorStatus } });
      if (dead) await ctx.prisma.assignment.update({ where: { id: sv.observation.assignmentId }, data: { status: "ANCHOR_FAILED" } });
    }
  }
  if (job.kind === "publish_cohort" && dead) {
    await ctx.prisma.cohort.update({ where: { id: job.entity_id }, data: { state: "PUBLISH_FAILED", lastError: message } });
  }
  if (job.kind === "close_cohort" && dead) {
    // CLOSING_PENDING -> ACTIVE only when the chain confirms the cohort is not closed (PRD 5.1).
    const cohort = await ctx.prisma.cohort.findUnique({ where: { id: job.entity_id } });
    const onchain = cohort ? await ctx.registry.cohortStatus(cohort.chainCampaignKey as Hex).catch(() => null) : null;
    if (onchain && onchain.state !== COHORT_STATE.CLOSED) {
      await ctx.prisma.cohort.updateMany({ where: { id: job.entity_id, state: "CLOSING_PENDING" }, data: { state: "ACTIVE", lastError: message } });
    }
  }
  if (dead) {
    await ctx.prisma.systemAlert.create({ data: { severity: "high", category: `job.${job.kind}.dead`, sourceId: job.id, contextRedacted: { eventKey: job.event_key, error: message } } });
  }
  await audit(ctx.prisma, { organizationId: job.organization_id, actorType: "worker", action: dead ? "job.dead_lettered" : "job.retry_scheduled", objectType: "anchor_job", objectId: job.id, metadata: { kind: job.kind, attempts: job.attempts } });
}

async function setTx(ctx: AppContext, jobId: string, hash: Hex) {
  // Persisting the hash also renews the lease, so long multi-transaction jobs are never reclaimed mid-send.
  await ctx.prisma.anchorJob.update({ where: { id: jobId }, data: { txHash: hash, lockedUntil: new Date(Date.now() + LEASE_MS) } });
}

/**
 * Settles a transaction this job already broadcast. Returns it when confirmed, waits while it is
 * pending, and returns null only when it was dropped or reverted, so chain state decides the next step.
 */
async function settleTracked(ctx: AppContext, hash: string | null): Promise<ConfirmedTx | null> {
  if (!hash) return null;
  const state = await ctx.registry.txState(hash as Hex);
  if (state === "confirmed") return ctx.registry.tryReceipt(hash as Hex);
  if (state === "pending" || state === "unconfirmed") throw new AwaitingChain(`transaction ${hash.slice(0, 10)}… ${state}`);
  return null;
}

async function handle(ctx: AppContext, job: Job) {
  switch (job.kind) {
    case "publish_cohort":
      return publishCohort(ctx, job);
    case "anchor_submission":
      return anchorSubmission(ctx, job);
    case "close_cohort":
      return closeCohort(ctx, job);
    case "record_disclosure":
      return recordDisclosure(ctx, job);
    case "void_assignment":
      return voidAssignment(ctx, job);
    case "evidence_checks":
      return evidenceChecks(ctx, job);
    default:
      throw new PermanentJobError(`unknown job kind ${job.kind}`);
  }
}

async function publishCohort(ctx: AppContext, job: Job) {
  const cohort = await ctx.prisma.cohort.findUniqueOrThrow({ where: { id: job.entity_id }, include: { assignments: { orderBy: { code: "asc" } } } });
  if (cohort.state !== "PUBLISH_PENDING") return;
  const key = cohort.chainCampaignKey as Hex;
  if (!cohort.targetCommitment) throw new PermanentJobError("missing target commitment");
  const txs = [...cohort.publishTxHashes];
  const record = async (h: Hex) => {
    txs.push(h);
    await ctx.prisma.cohort.update({ where: { id: cohort.id }, data: { publishTxHashes: txs } });
  };

  const lastTx = txs[txs.length - 1];
  if (lastTx) {
    const state = await ctx.registry.txState(lastTx as Hex);
    if (state === "pending" || state === "unconfirmed") throw new AwaitingChain(`publish transaction ${lastTx.slice(0, 10)}… ${state}`);
  }

  // Each step reads chain state first so a retry never double-submits (PRD 11.5).
  let status = await ctx.registry.cohortStatus(key);
  if (status.state === COHORT_STATE.NONE) {
    await ctx.registry.createCohort(key, cohort.targetCommitment as Hex, cohort.expectedCount, BigInt(cohort.closingAfter ? Math.floor(cohort.closingAfter.getTime() / 1000) : 0), record);
    status = await ctx.registry.cohortStatus(key);
  }
  // A lagging RPC node can still report NONE right after createCohort confirms.
  if (status.state === COHORT_STATE.NONE) throw new AwaitingChain("cohort not yet visible on the RPC node");
  if (status.target.toLowerCase() !== cohort.targetCommitment.toLowerCase() || status.expected !== cohort.expectedCount) {
    throw new PermanentJobError("onchain cohort does not match database commitment/roster");
  }
  if (status.state === COHORT_STATE.CREATED) {
    const unregistered: Hex[] = [];
    for (const a of cohort.assignments) {
      const s = await ctx.registry.assignmentStatus(key, a.assignmentKey as Hex);
      if (s.state === ASSIGNMENT_STATE.NONE) unregistered.push(a.assignmentKey as Hex);
    }
    for (let i = 0; i < unregistered.length; i += 50) await ctx.registry.registerAssignments(key, unregistered.slice(i, i + 50), record);
    await ctx.registry.freezeRoster(key, record);
    status = await ctx.registry.cohortStatus(key);
  }
  if (status.state !== COHORT_STATE.FROZEN || status.registered !== cohort.expectedCount) throw new Error("roster not frozen onchain yet");

  const now = new Date();
  await ctx.prisma.$transaction(async (tx) => {
    await tx.cohort.update({ where: { id: cohort.id }, data: { state: "ACTIVE", publishedAt: now, lastError: null } });
    await tx.assignment.updateMany({ where: { cohortId: cohort.id }, data: { publishedAt: now } });
    await audit(tx, { organizationId: cohort.organizationId, actorType: "worker", action: "cohort.published", objectType: "cohort", objectId: cohort.id, metadata: { txCount: txs.length } });
  });
  const auditors = await ctx.prisma.user.findMany({ where: { id: { in: cohort.assignments.map((a) => a.auditorUserId) } }, select: { email: true } });
  for (const u of auditors) {
    await ctx.outbox(u.email, "You have a new BlindCount field visit", `A visit in cohort ${cohort.code} is assigned to you. Open ${ctx.cfg.WEB_URL}/app to start.`).catch(() => undefined);
  }
}

async function anchorSubmission(ctx: AppContext, job: Job) {
  const sv = await ctx.prisma.submissionVersion.findUniqueOrThrow({ where: { id: job.entity_id }, include: { observation: { include: { assignment: { include: { cohort: true } } } } } });
  if (sv.anchorStatus === "CONFIRMED") return;
  const a = sv.observation.assignment;
  const cohortKey = a.cohort.chainCampaignKey as Hex;
  const assignmentKey = a.assignmentKey as Hex;

  // Recompute from stored artifacts before relaying (PRD 10.5).
  const salt = ctx.vault.decrypt(sv.commitmentSaltEncrypted, `salt:${sv.id}`) as Hex;
  const recomputed = observationCommitment({ chainId: ctx.cfg.CHAIN_ID, registryAddress: ctx.registry.address, cohortKey, assignmentKey, version: sv.versionNumber, payloadSha256: sv.payloadSha256, submissionSalt: salt });
  if (recomputed !== sv.commitment) throw new PermanentJobError("stored commitment does not recompute");

  let confirmed = await settleTracked(ctx, job.tx_hash);
  if (!confirmed) {
    const onchain = await ctx.registry.observationCommitment(cohortKey, assignmentKey, sv.versionNumber);
    if (onchain !== `0x${"0".repeat(64)}`) {
      if (onchain.toLowerCase() !== sv.commitment.toLowerCase()) {
        await ctx.prisma.systemAlert.create({ data: { severity: "critical", category: "chain.commitment_mismatch", sourceId: sv.id, contextRedacted: { assignmentKey } } });
        throw new PermanentJobError("onchain commitment differs from stored commitment (quarantined)");
      }
      // Anchored by a transaction whose hash we lost (crash, timeout): recover it from the event log.
      confirmed = await ctx.registry.findEvent("ObservationAnchored", { cohortKey, assignmentKey }, sv.versionNumber);
      if (!confirmed) throw new AwaitingChain("commitment is onchain; waiting for confirmations");
    } else {
      await ctx.prisma.submissionVersion.update({ where: { id: sv.id }, data: { anchorStatus: "SUBMITTED" } });
      confirmed = await ctx.registry.anchorObservation(cohortKey, assignmentKey, sv.versionNumber, sv.commitment as Hex, (h) => setTx(ctx, job.id, h));
    }
  }

  // Read back before recording: the registry, not a receipt, is the source of truth for SEALED.
  if ((await ctx.registry.observationCommitment(cohortKey, assignmentKey, sv.versionNumber)).toLowerCase() !== sv.commitment.toLowerCase()) {
    throw new AwaitingChain("anchor receipt seen but the registry does not show the commitment yet");
  }
  await ctx.prisma.$transaction(async (tx) => {
    await enqueue(tx, { organizationId: sv.organizationId, kind: "evidence_checks", entityId: sv.id, eventKey: `checks:${sv.id}` });
    await tx.submissionVersion.update({
      where: { id: sv.id },
      data: { anchorStatus: "CONFIRMED", anchorTxHash: confirmed.txHash, anchorBlockNumber: confirmed.blockNumber, anchorBlockHash: confirmed.blockHash, anchorConfirmedAt: new Date() },
    });
    await tx.anchorJob.update({ where: { id: job.id }, data: { txHash: confirmed.txHash } });
    if (sv.versionNumber === 1) await tx.assignment.update({ where: { id: a.id }, data: { status: "SEALED" } });
    else await onCorrectionAnchored(ctx, tx, sv, a);
    await audit(tx, { organizationId: sv.organizationId, actorType: "worker", action: "submission.anchored", objectType: "submission_version", objectId: sv.id, metadata: { block: confirmed.blockNumber.toString() } });
  });
}

/**
 * A confirmed correction is evaluated with the same deterministic rule as the original, and the
 * review case reopens so a reviewer accepts it or keeps the original. Version 1 is untouched.
 */
async function onCorrectionAnchored(
  ctx: AppContext,
  tx: Prisma.TransactionClient,
  sv: { id: string; organizationId: string; observationId: string; observedCount: number; payloadSha256: string; versionNumber: number },
  a: { id: string; auditorUserId: string; cohortId: string; cohort: { state: string } },
) {
  const crit = await tx.criterionVersion.findUnique({ where: { cohortId: a.cohortId } });
  if (crit && a.cohort.state === "DISCLOSED") {
    const criterion = JSON.parse(ctx.criterionVault.decrypt(crit.targetCiphertext, `criterion:${a.cohortId}`)) as { targetCount: number };
    const input = { operator: "gte" as const, observedCount: sv.observedCount, targetCount: criterion.targetCount };
    const result = evaluate(input);
    await tx.evaluation.upsert({
      where: { observationId_submissionVersionId: { observationId: sv.observationId, submissionVersionId: sv.id } },
      create: {
        organizationId: sv.organizationId,
        observationId: sv.observationId,
        criterionVersionId: crit.id,
        submissionVersionId: sv.id,
        comparisonOperator: "gte",
        observedCount: sv.observedCount,
        targetCount: criterion.targetCount,
        result,
        ruleVersion: RULE_VERSION,
        resultDigest: await evaluationDigest({ ...input, result, submissionPayloadSha256: sv.payloadSha256 }),
      },
      update: {},
    });
  }
  const rc = await tx.reviewCase.findFirst({ where: { observationId: sv.observationId, state: "CORRECTION_REQUESTED" }, orderBy: { createdAt: "desc" } });
  if (rc) {
    await tx.reviewCase.update({ where: { id: rc.id }, data: { state: "OPEN", discrepancyType: "AMENDMENT", decision: null, decisionReason: null, decidedBy: null, decidedAt: null } });
    await tx.reviewAction.create({ data: { organizationId: sv.organizationId, reviewCaseId: rc.id, actorId: a.auditorUserId, actionType: "AMENDMENT_ANCHORED", priorState: "CORRECTION_REQUESTED", newState: "OPEN", linkedSubmissionId: sv.id, notes: `Version ${sv.versionNumber} anchored` } });
  }
  await tx.observation.update({ where: { id: sv.observationId }, data: { reviewStatus: "REVIEW_PENDING" } });
  await tx.assignment.update({ where: { id: a.id }, data: { status: "REVIEW_PENDING" } });
}

async function evidenceChecks(ctx: AppContext, job: Job) {
  const done = await ctx.prisma.aiAssessment.findFirst({ where: { submissionVersionId: job.entity_id, modelProvider: "deterministic" } });
  if (!done) await runDeterministicChecks(ctx, job.entity_id);
}

async function closeCohort(ctx: AppContext, job: Job) {
  const cohort = await ctx.prisma.cohort.findUniqueOrThrow({ where: { id: job.entity_id }, include: { assignments: true } });
  if (cohort.state !== "CLOSING_PENDING") return;
  const key = cohort.chainCampaignKey as Hex;

  // Re-run DB and chain invariants immediately before signing (PRD 10.5).
  const terminal = ["SEALED", "REVIEW_PENDING", "APPROVED", "DISPUTED", "AMENDMENT_REQUESTED", "VOIDED"];
  if (cohort.assignments.some((a) => !terminal.includes(a.status))) throw new PermanentJobError("database roster has non-terminal assignments");
  const sealed = await ctx.prisma.submissionVersion.findMany({ where: { versionNumber: 1, observation: { assignment: { cohortId: cohort.id } } } });
  for (const sv of sealed) {
    if (sv.anchorStatus !== "CONFIRMED" || !sv.anchorBlockNumber || !sv.anchorBlockHash) throw new PermanentJobError("an anchor is not confirmed");
    if (!(await ctx.registry.blockStillCanonical(sv.anchorBlockNumber, sv.anchorBlockHash as Hex))) throw new Error("REORG_PENDING: anchor block no longer canonical");
  }

  let confirmed = await settleTracked(ctx, job.tx_hash);
  if (!confirmed) {
    const status = await ctx.registry.cohortStatus(key);
    if (status.state === COHORT_STATE.CLOSED) {
      confirmed = await ctx.registry.findEvent("CohortClosed", { cohortKey: key });
      if (!confirmed) throw new AwaitingChain("cohort is closed onchain; waiting for confirmations");
    } else {
      if (status.terminal !== status.expected) throw new PermanentJobError("onchain terminal count incomplete");
      confirmed = await ctx.registry.closeCohort(key, (h) => setTx(ctx, job.id, h));
    }
  }
  if ((await ctx.registry.cohortStatus(key)).state !== COHORT_STATE.CLOSED) throw new AwaitingChain("close receipt seen but the registry does not show the cohort closed yet");
  await ctx.prisma.$transaction(async (tx) => {
    await tx.cohort.update({ where: { id: cohort.id }, data: { state: "CLOSED", closedAt: new Date(), closeTxHash: confirmed.txHash, lastError: null } });
    await audit(tx, { organizationId: cohort.organizationId, actorType: "worker", action: "cohort.closed", objectType: "cohort", objectId: cohort.id });
  });
}

async function recordDisclosure(ctx: AppContext, job: Job) {
  const cohort = await ctx.prisma.cohort.findUniqueOrThrow({ where: { id: job.entity_id } });
  if (cohort.disclosureTxHash) return;
  const receiptHash = job.payload as Hex | null;
  if (!receiptHash || !/^0x[0-9a-f]{64}$/.test(receiptHash)) throw new PermanentJobError("missing disclosure receipt hash");
  const key = cohort.chainCampaignKey as Hex;
  let confirmed = await settleTracked(ctx, job.tx_hash);
  if (!confirmed) {
    if (await ctx.registry.isDisclosed(key)) {
      confirmed = await ctx.registry.findEvent("CriterionDisclosureRecorded", { cohortKey: key });
      if (!confirmed) throw new AwaitingChain("disclosure is onchain; waiting for confirmations");
    } else {
      confirmed = await ctx.registry.recordDisclosure(key, receiptHash, (h) => setTx(ctx, job.id, h));
    }
  }
  await ctx.prisma.cohort.update({ where: { id: cohort.id }, data: { disclosureTxHash: confirmed.txHash } });
  await audit(ctx.prisma, { organizationId: cohort.organizationId, actorType: "worker", action: "criterion.disclosure_recorded", objectType: "cohort", objectId: cohort.id });
}

async function voidAssignment(ctx: AppContext, job: Job) {
  const a = await ctx.prisma.assignment.findUniqueOrThrow({ where: { id: job.entity_id }, include: { cohort: true } });
  if (a.status === "VOIDED") return;
  if (a.status !== "VOID_PENDING" || !a.voidReason) throw new PermanentJobError("assignment is not pending void");
  const { hashCanonical } = await import("@blindcount/crypto");
  const reasonDigest = `0x${await hashCanonical({ schema: "blindcount.void.v1", assignmentId: a.id, reason: a.voidReason })}` as Hex;
  const cohortKey = a.cohort.chainCampaignKey as Hex;
  const assignmentKey = a.assignmentKey as Hex;
  let confirmed = await settleTracked(ctx, job.tx_hash);
  if (!confirmed) {
    const s = await ctx.registry.assignmentStatus(cohortKey, assignmentKey);
    if (s.state === ASSIGNMENT_STATE.REGISTERED) {
      confirmed = await ctx.registry.voidAssignment(cohortKey, assignmentKey, reasonDigest, (h) => setTx(ctx, job.id, h));
    } else if (s.state === ASSIGNMENT_STATE.VOIDED) {
      confirmed = await ctx.registry.findEvent("AssignmentVoided", { cohortKey, assignmentKey });
      if (!confirmed) throw new AwaitingChain("void is onchain; waiting for confirmations");
    } else {
      throw new PermanentJobError("assignment is not voidable onchain");
    }
  }
  await ctx.prisma.assignment.update({ where: { id: a.id }, data: { status: "VOIDED", voidTxHash: confirmed.txHash } });
  await audit(ctx.prisma, { organizationId: a.organizationId, actorType: "worker", action: "exception.voided", objectType: "assignment", objectId: a.id });
}

/** Starts the loop. The returned stop() resolves once the in-flight job has finished. */
export function startWorker(ctx: AppContext, log: (msg: string) => void): () => Promise<void> {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        const worked = await runOnce(ctx);
        if (!worked) await new Promise((r) => setTimeout(r, 750));
      } catch (e) {
        log(`worker loop error: ${e instanceof Error ? e.message : "unknown"}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  const running = loop();
  return async () => {
    stopped = true;
    await running;
  };
}
