export type CohortState =
  | "DRAFT"
  | "PUBLISH_PENDING"
  | "PUBLISH_FAILED"
  | "ACTIVE"
  | "CLOSING_PENDING"
  | "CLOSED"
  | "DISCLOSED"
  | "ARCHIVED"
  | "CANCELLED"
  | "SUSPENDED";

const COHORT_TRANSITIONS: Record<CohortState, readonly CohortState[]> = {
  DRAFT: ["PUBLISH_PENDING", "CANCELLED"],
  PUBLISH_PENDING: ["ACTIVE", "PUBLISH_FAILED"],
  PUBLISH_FAILED: ["PUBLISH_PENDING"],
  ACTIVE: ["CLOSING_PENDING", "SUSPENDED"],
  SUSPENDED: ["ACTIVE"],
  CLOSING_PENDING: ["CLOSED", "ACTIVE"],
  CLOSED: ["DISCLOSED"],
  DISCLOSED: ["ARCHIVED"],
  ARCHIVED: [],
  CANCELLED: [],
};

export function canTransitionCohort(from: CohortState, to: CohortState): boolean {
  return COHORT_TRANSITIONS[from].includes(to);
}

export type AssignmentStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "RECEIVED"
  | "ANCHOR_PENDING"
  | "ANCHOR_FAILED"
  | "SEALED"
  | "REVIEW_PENDING"
  | "APPROVED"
  | "DISPUTED"
  | "AMENDMENT_REQUESTED"
  | "VOID_PENDING"
  | "VOIDED"
  | "EXPIRED";

const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  PENDING: ["IN_PROGRESS", "ANCHOR_PENDING", "VOID_PENDING", "EXPIRED"],
  IN_PROGRESS: ["ANCHOR_PENDING", "EXPIRED"],
  RECEIVED: ["ANCHOR_PENDING"],
  ANCHOR_PENDING: ["SEALED", "ANCHOR_FAILED"],
  ANCHOR_FAILED: ["ANCHOR_PENDING", "SEALED"],
  SEALED: ["REVIEW_PENDING"],
  REVIEW_PENDING: ["APPROVED", "DISPUTED", "AMENDMENT_REQUESTED"],
  AMENDMENT_REQUESTED: ["REVIEW_PENDING"],
  APPROVED: [],
  DISPUTED: ["REVIEW_PENDING"],
  VOID_PENDING: ["VOIDED", "PENDING"],
  VOIDED: [],
  EXPIRED: ["ANCHOR_PENDING", "VOID_PENDING"],
};

export function canTransitionAssignment(from: AssignmentStatus, to: AssignmentStatus): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

/** Terminal for closure purposes: first observation sealed on chain, or voided. */
export const CLOSURE_TERMINAL: readonly AssignmentStatus[] = ["SEALED", "REVIEW_PENDING", "APPROVED", "DISPUTED", "AMENDMENT_REQUESTED", "VOIDED"];

export function isClosureTerminal(s: AssignmentStatus): boolean {
  return CLOSURE_TERMINAL.includes(s);
}
