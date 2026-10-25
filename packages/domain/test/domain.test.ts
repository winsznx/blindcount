import { describe, expect, it } from "vitest";
import { can, canTransitionCohort, evaluate, isClosureTerminal, observationPayloadSchema, unzipPacket, PacketFormatError } from "../src/index";
import { zipSync } from "fflate";

const base = {
  schema: "blindcount.observation.v1",
  assignmentId: "4d5462d4-04c5-4f07-aae3-44dbb744a501",
  cohortId: "4d5462d4-04c5-4f07-aae3-44dbb744a502",
  farmPseudonym: "FARM-014",
  auditorUserId: "4d5462d4-04c5-4f07-aae3-44dbb744a503",
  deviceKeyId: "4d5462d4-04c5-4f07-aae3-44dbb744a504",
  version: 1,
  previousSubmissionId: null,
  visitDate: "2026-10-24",
  count: 12,
  unit: "shade_trees",
  captureMethod: "walkthrough_count",
  notes: "",
  evidence: [],
  evidenceException: "camera unavailable",
  evidenceConsent: true,
  location: null,
  amendmentReason: null,
  clientClaimedAt: "2026-10-24T11:31:22.000Z",
};

describe("evaluation", () => {
  it("is exact integer gte", () => {
    expect(evaluate({ operator: "gte", observedCount: 15, targetCount: 15 })).toBe("MEETS_CRITERION");
    expect(evaluate({ operator: "gte", observedCount: 14, targetCount: 15 })).toBe("BELOW_CRITERION");
    expect(() => evaluate({ operator: "gte", observedCount: 14.5, targetCount: 15 })).toThrow();
  });
});

describe("observation schema", () => {
  it("accepts valid payload and rejects bad counts/unknown keys", () => {
    expect(observationPayloadSchema.safeParse(base).success).toBe(true);
    expect(observationPayloadSchema.safeParse({ ...base, count: -1 }).success).toBe(false);
    expect(observationPayloadSchema.safeParse({ ...base, count: 1.5 }).success).toBe(false);
    expect(observationPayloadSchema.safeParse({ ...base, count: 100001 }).success).toBe(false);
    expect(observationPayloadSchema.safeParse({ ...base, threshold: 15 }).success).toBe(false);
  });
  it("requires evidence or an exception", () => {
    expect(observationPayloadSchema.safeParse({ ...base, evidenceException: null }).success).toBe(false);
  });
  it("amendments require link and reason", () => {
    expect(observationPayloadSchema.safeParse({ ...base, version: 2 }).success).toBe(false);
  });
});

describe("permissions and state", () => {
  it("auditor can never disclose or decide", () => {
    expect(can(["AUDITOR"], "cohort.disclose")).toBe(false);
    expect(can(["AUDITOR"], "review.decide")).toBe(false);
    expect(can(["OWNER"], "cohort.disclose")).toBe(false);
    expect(can(["CUSTODIAN"], "cohort.disclose")).toBe(true);
  });
  it("no DISCLOSED -> ACTIVE", () => {
    expect(canTransitionCohort("DISCLOSED", "ACTIVE")).toBe(false);
    expect(canTransitionCohort("DRAFT", "PUBLISH_PENDING")).toBe(true);
    expect(isClosureTerminal("ANCHOR_PENDING")).toBe(false);
    expect(isClosureTerminal("SEALED")).toBe(true);
  });
});

describe("zip safety", () => {
  it("rejects zip-slip paths", () => {
    const z = zipSync({ "../evil.txt": new Uint8Array([1]) });
    expect(() => unzipPacket(z)).toThrow(PacketFormatError);
  });
  it("rejects non-zip", () => {
    expect(() => unzipPacket(new Uint8Array([1, 2, 3]))).toThrow(PacketFormatError);
  });
  it("rejects decompression bombs", () => {
    const z = zipSync({ "big.bin": new Uint8Array(30 * 1024 * 1024) });
    expect(() => unzipPacket(z)).toThrow(/limits/);
  });
});
