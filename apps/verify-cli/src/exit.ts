import type { VerificationResult } from "@blindcount/domain";

/** Exit codes (PRD 13.4): 0 verified, 1 invalid, 2 dependency unavailable or issuer not pinned, 3 unsupported or misuse. */
export const EXIT = { VERIFIED: 0, INVALID: 1, UNAVAILABLE: 2, MISUSE: 3 } as const;

export function exitCodeFor(r: VerificationResult): number {
  if (r.integrity === "VERIFIED_INTEGRITY") return EXIT.VERIFIED;
  if (r.integrity === "INVALID") return EXIT.INVALID;
  if (r.checks.some((c) => c.name === "manifest" && c.status === "UNKNOWN")) return EXIT.MISUSE;
  return EXIT.UNAVAILABLE;
}
