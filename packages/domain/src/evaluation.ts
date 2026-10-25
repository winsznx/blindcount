import { hashCanonical } from "@blindcount/crypto";

export const RULE_VERSION = "blindcount.rule.gte.v1";

export type EvaluationResult = "MEETS_CRITERION" | "BELOW_CRITERION";

export interface EvaluationInput {
  operator: "gte";
  observedCount: number;
  targetCount: number;
}

/** Deterministic, integer-only comparison. No AI or reviewer input can reach this function. */
export function evaluate(input: EvaluationInput): EvaluationResult {
  if (input.operator !== "gte") throw new Error(`unsupported operator ${String(input.operator)}`);
  if (!Number.isSafeInteger(input.observedCount) || !Number.isSafeInteger(input.targetCount)) throw new Error("integers required");
  return input.observedCount >= input.targetCount ? "MEETS_CRITERION" : "BELOW_CRITERION";
}

export async function evaluationDigest(p: EvaluationInput & { result: EvaluationResult; submissionPayloadSha256: string }): Promise<string> {
  return hashCanonical({
    schema: "blindcount.evaluation.v1",
    ruleVersion: RULE_VERSION,
    operator: p.operator,
    observedCount: p.observedCount,
    targetCount: p.targetCount,
    result: p.result,
    submissionPayloadSha256: p.submissionPayloadSha256,
  });
}
