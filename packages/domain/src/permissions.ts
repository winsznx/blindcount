export type Role = "OWNER" | "MANAGER" | "AUDITOR" | "REVIEWER" | "CUSTODIAN";

export type Action =
  | "org.invite"
  | "org.invite.privileged"
  | "org.members.read"
  | "org.members.revoke"
  | "programme.write"
  | "programme.read"
  | "cohort.write"
  | "cohort.read"
  | "cohort.criterion.set"
  | "cohort.close"
  | "cohort.disclose"
  | "assignment.void.request"
  | "assignment.void.approve"
  | "review.read"
  | "review.decide"
  | "report.generate"
  | "report.read"
  | "report.share"
  | "visit.own"
  | "ops.jobs";

const MATRIX: Record<Action, readonly Role[]> = {
  "org.invite": ["OWNER", "MANAGER"],
  "org.invite.privileged": ["OWNER"],
  "org.members.read": ["OWNER", "MANAGER"],
  "org.members.revoke": ["OWNER"],
  "programme.write": ["MANAGER"],
  "programme.read": ["OWNER", "MANAGER", "REVIEWER", "CUSTODIAN"],
  "cohort.write": ["MANAGER"],
  "cohort.read": ["OWNER", "MANAGER", "REVIEWER", "CUSTODIAN"],
  "cohort.criterion.set": ["MANAGER"],
  "cohort.close": ["MANAGER"],
  "cohort.disclose": ["CUSTODIAN"],
  "assignment.void.request": ["MANAGER"],
  "assignment.void.approve": ["REVIEWER", "OWNER"],
  "review.read": ["REVIEWER", "MANAGER"],
  "review.decide": ["REVIEWER"],
  "report.generate": ["REVIEWER", "MANAGER"],
  "report.read": ["OWNER", "MANAGER", "REVIEWER"],
  "report.share": ["MANAGER"],
  "visit.own": ["AUDITOR"],
  "ops.jobs": ["OWNER", "MANAGER"],
};

/** Roles a manager (non-owner) may grant through invitations. */
export const MANAGER_INVITABLE: readonly Role[] = ["AUDITOR", "REVIEWER"];

export function can(roles: readonly Role[], action: Action): boolean {
  return MATRIX[action].some((r) => roles.includes(r));
}
