import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { exitCodeFor, EXIT } from "../src/exit";
import type { VerificationResult } from "@blindcount/domain";

const base: VerificationResult = { integrity: "VERIFIED_INTEGRITY", reviewState: "REVIEWED", checks: [], summary: {}, disclaimer: "" };

describe("exit codes (PRD 13.4)", () => {
  it("maps verdicts to documented codes", () => {
    expect(exitCodeFor(base)).toBe(EXIT.VERIFIED);
    expect(exitCodeFor({ ...base, integrity: "INVALID" })).toBe(EXIT.INVALID);
    expect(exitCodeFor({ ...base, integrity: "VALID_LOCAL_ONLY" })).toBe(EXIT.UNAVAILABLE);
    expect(exitCodeFor({ ...base, integrity: "UNABLE_TO_VERIFY", checks: [{ name: "manifest", status: "UNKNOWN", detail: "" }] })).toBe(EXIT.MISUSE);
  });

  it("returns 3 on misuse", () => {
    let code = 0;
    try {
      execFileSync("npx", ["tsx", "src/cli.ts"], { stdio: "ignore" });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(EXIT.MISUSE);
  });

  // Packets are produced by the API integration test (apps/api/test/e2e-flow.test.ts).
  it.skipIf(!existsSync("../../storage-test/tampered-packet.zip"))("rejects a tampered packet offline with exit 1", () => {
    let code = 0;
    try {
      execFileSync("npx", ["tsx", "src/cli.ts", "--packet", "../../storage-test/tampered-packet.zip"], { stdio: "ignore" });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(EXIT.INVALID);
  });
});
