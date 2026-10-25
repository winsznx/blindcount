import type { AppContext } from "../lib/context";

export const BLIND_NOTICE = "Count what you observe. The programme target is intentionally hidden.";

/**
 * The only shape of assignment data an auditor ever receives (INV-01). It is built from an
 * explicit allowlist; nothing from criteria_versions, evaluations or cohort target fields is read.
 */
export async function auditorProjection(ctx: AppContext, assignmentId: string) {
  const correction = await ctx.prisma.reviewAction.findFirst({
    where: { actionType: "REQUEST_CORRECTION", reviewCase: { observation: { assignmentId }, state: "CORRECTION_REQUESTED" } },
    orderBy: { createdAt: "desc" },
    select: { notes: true, createdAt: true },
  });
  const a = await ctx.prisma.assignment.findUniqueOrThrow({
    where: { id: assignmentId },
    select: {
      id: true,
      code: true,
      status: true,
      dueAt: true,
      assignmentKey: true,
      auditorUserId: true,
      cohortId: true,
      farm: { select: { displayPseudonym: true, coarseRegion: true } },
      cohort: { select: { id: true, code: true, name: true, state: true, chainCampaignKey: true, programme: { select: { name: true, crop: true, regionLabel: true, dataSource: true } } } },
      observation: {
        select: {
          id: true,
          versions: {
            select: { id: true, versionNumber: true, receivedAt: true, anchorStatus: true, anchorTxHash: true, anchorBlockNumber: true, anchorConfirmedAt: true, payloadSha256: true, commitment: true, receiptSignature: true, observedCount: true },
            orderBy: { versionNumber: "asc" },
          },
        },
      },
    },
  });
  return {
    assignmentId: a.id,
    code: a.code,
    status: a.status,
    dueAt: a.dueAt,
    late: a.dueAt < new Date(),
    farm: { pseudonym: a.farm.displayPseudonym, coarseRegion: a.farm.coarseRegion },
    cohort: { id: a.cohort.id, code: a.cohort.code, name: a.cohort.name, acceptingSubmissions: a.cohort.state === "ACTIVE" },
    programme: a.cohort.programme,
    notice: BLIND_NOTICE,
    form: {
      schema: "blindcount.observation.v1",
      unit: "shade_trees",
      fields: [
        { name: "visitDate", type: "date", required: true },
        { name: "count", type: "integer", required: true, min: 0, max: 100000 },
        { name: "captureMethod", type: "enum", required: true, options: ["walkthrough_count", "plot_sample_count", "transect_count"] },
        { name: "notes", type: "text", required: false, maxLength: 2000 },
        { name: "evidence", type: "photos", required: true, max: 3, mime: ["image/jpeg", "image/png"], maxBytes: 20971520 },
        { name: "evidenceConsent", type: "boolean", required: true },
      ],
    },
    signing: {
      chainId: ctx.cfg.CHAIN_ID,
      registryAddress: ctx.registry.address,
      cohortKey: a.cohort.chainCampaignKey,
      assignmentKey: a.assignmentKey,
      auditorUserId: a.auditorUserId,
    },
    submissions: (a.observation?.versions ?? []).map((v) => ({
      submissionId: v.id,
      version: v.versionNumber,
      count: v.observedCount,
      receivedAt: v.receivedAt,
      anchorStatus: v.anchorStatus,
      anchorTxHash: v.anchorStatus === "CONFIRMED" ? v.anchorTxHash : null,
      anchorBlockNumber: v.anchorStatus === "CONFIRMED" ? v.anchorBlockNumber?.toString() ?? null : null,
      anchorConfirmedAt: v.anchorConfirmedAt,
      payloadSha256: v.payloadSha256,
      commitment: v.commitment,
      receiptSignature: v.receiptSignature,
    })),
    explorerTxUrl: ctx.cfg.CHAIN_EXPLORER_URL ? `${ctx.cfg.CHAIN_EXPLORER_URL.replace(/\/$/, "")}/tx/` : null,
    // Only the reviewer's request text (they are warned the auditor reads it); never outcomes or targets.
    correction:
      a.status === "AMENDMENT_REQUESTED" && correction
        ? { requestedAt: correction.createdAt, reason: correction.notes, nextVersion: (a.observation?.versions.length ?? 0) + 1, previousSubmissionId: a.observation?.versions[a.observation.versions.length - 1]?.id ?? null }
        : null,
  };
}
