export interface CohortSummary {
  id: string;
  code: string;
  name: string;
  state: string;
  expectedCount: number;
  dueAt: string;
}

export interface Programme {
  id: string;
  code: string;
  name: string;
  crop: string;
  regionLabel: string;
  purpose: string;
  startAt: string;
  endAt: string;
  dataSource: string;
  cohorts: CohortSummary[];
}

export interface CohortAssignment {
  id: string;
  code: string;
  farmPseudonym: string;
  farmCode: string;
  auditor: { id: string; email: string; displayName: string } | null;
  status: string;
  dueAt: string;
  observationId: string | null;
  anchorTxHash: string | null;
  receivedAt: string | null;
  outcome: string | null;
  voidReason: string | null;
}

export interface CohortView {
  id: string;
  code: string;
  name: string;
  state: string;
  dueAt: string;
  closingAfter: string | null;
  programme: { id: string; code: string; name: string; dataSource: string };
  chain: { chainId: number; registryAddress: string; cohortKey: string; targetCommitment: string | null; publishTxHashes: string[]; closeTxHash: string | null; disclosureTxHash: string | null; explorerUrl: string | null };
  criterion: { set: boolean; operator?: string; unit?: string; lockedAt?: string | null; revealedAt?: string | null; targetCount?: number | null };
  expectedCount: number;
  publishedAt: string | null;
  closedAt: string | null;
  disclosedAt: string | null;
  lastError: string | null;
  assignments: CohortAssignment[];
}

export interface Progress {
  total: number;
  counts: Record<string, number>;
  blockers: Array<{ assignmentId: string; code: string; farmPseudonym: string; status: string; late: boolean }>;
  closable: boolean;
}

export interface Submission {
  submissionId: string;
  version: number;
  count: number;
  receivedAt: string;
  anchorStatus: string;
  anchorTxHash: string | null;
  anchorBlockNumber: string | null;
  anchorConfirmedAt: string | null;
  payloadSha256: string;
  commitment: string;
  receiptSignature: string;
}

export interface VisitForm {
  assignmentId: string;
  code: string;
  status: string;
  dueAt: string;
  late: boolean;
  farm: { pseudonym: string; coarseRegion: string | null };
  cohort: { id: string; code: string; name: string; acceptingSubmissions: boolean };
  programme: { name: string; crop: string; regionLabel: string; dataSource: string };
  notice: string;
  signing: { chainId: number; registryAddress: string; cohortKey: string; assignmentKey: string; auditorUserId: string };
  submissions: Submission[];
  explorerTxUrl: string | null;
  uploadedEvidence?: Array<{ fileId: string; sha256: string; mime: string; bytes: number; attached: boolean }>;
  correction: { requestedAt: string; reason: string | null; nextVersion: number; previousSubmissionId: string | null } | null;
}

export interface EvidenceFlag {
  id: string;
  code: string;
  severity: string;
  evidenceId: string | null;
  reason: string;
  source: string;
  humanLabel: string | null;
}

export interface ReviewDetail {
  id: string;
  observationId: string;
  acceptedVersionId: string | null;
  evaluations: Array<{ submissionVersionId: string; result: string; observedCount: number }>;
  state: string;
  decision: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  canDecide: boolean;
  assignment: { id: string; code: string; farmPseudonym: string; status: string };
  cohort: { id: string; code: string; name: string; state: string; dataSource: string };
  auditor: { displayName: string; email: string } | null;
  criterion: { operator: string; targetCount: number } | null;
  evaluation: { result: string; observedCount: number; targetCount: number; ruleVersion: string; resultDigest: string } | null;
  versions: Array<{
    id: string;
    version: number;
    count: number;
    amendmentReason: string | null;
    amendmentStatus: string | null;
    visitDate: string;
    captureMethod: string;
    notes: string;
    evidenceException: string | null;
    receivedAt: string;
    deviceClaimedAt: string;
    anchorStatus: string;
    anchorTxHash: string | null;
    payloadSha256: string;
    commitment: string;
    evidence: Array<{ id: string; sha256: string; mime: string; bytes: number; width: number | null; height: number | null; captureClaimedAt: string | null }>;
  }>;
  assessments: Array<{ id: string; provider: string; model: string; promptVersion: string; status: string; error: string | null; createdAt: string; flags: EvidenceFlag[] }>;
  actions: Array<{ type: string; notes: string | null; newState: string | null; createdAt: string }>;
  reports: Array<{ id: string; version: number; status: string; generatedAt: string }>;
}
