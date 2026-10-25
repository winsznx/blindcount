import { describe, expect, it } from "vitest";
import {
  canonicalize,
  CanonicalizationError,
  exportPublicJwk,
  generateDeviceKey,
  observationCommitment,
  parseStrictJson,
  sha256Hex,
  signFinalization,
  targetCommitment,
  verifyFinalization,
  type FinalizationMessage,
} from "../src/index";

const registryAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const k1 = `0x${"11".repeat(32)}` as const;
const k2 = `0x${"22".repeat(32)}` as const;
const salt = `0x${"33".repeat(32)}` as const;

describe("canonicalize (RFC 8785 subset)", () => {
  it("sorts keys by UTF-16 code unit and emits no whitespace", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"], "€": 0, "😀": 1, A: -0 })).toBe(
      '{"A":0,"a":[true,null,"x"],"b":1,"€":0,"😀":1}',
    );
  });
  it("matches RFC 8785 string escaping", () => {
    expect(canonicalize({ s: '"\\\b\f\n\r\t\u0001\u007f' })).toBe('{"s":"\\"\\\\\\b\\f\\n\\r\\t\\u0001\u007f"}');
  });
  it("rejects floats, non-finite numbers and lone surrogates", () => {
    expect(() => canonicalize({ n: 1.5 })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ n: Infinity })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ s: "\ud800" })).toThrow(CanonicalizationError);
  });
  it("parseStrictJson rejects duplicate keys", () => {
    expect(() => parseStrictJson('{"count":12,"count":18}')).toThrow(/duplicate key/);
    expect(parseStrictJson('{"a":{"b":[1,2]},"c":"d"}')).toEqual({ a: { b: [1, 2] }, c: "d" });
  });
});

describe("digests and commitments (fixed vectors)", () => {
  it("sha256 of canonical JSON is stable", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(canonicalize({ count: 12, schema: "x" }))).toBe(await sha256Hex('{"count":12,"schema":"x"}'));
  });

  it("observation commitment matches Solidity abi.encode vector", () => {
    // Vector also asserted in packages/contracts/test/CommitmentVectors.t.sol
    const c = observationCommitment({
      chainId: 84532,
      registryAddress,
      cohortKey: k1,
      assignmentKey: k2,
      version: 1,
      payloadSha256: "44".repeat(32),
      submissionSalt: salt,
    });
    expect(c).toBe(OBS_VECTOR);
  });

  it("commitment is chain and registry domain-separated", () => {
    const base = { chainId: 84532, registryAddress, cohortKey: k1, assignmentKey: k2, version: 1, payloadSha256: "44".repeat(32), submissionSalt: salt };
    expect(observationCommitment({ ...base, chainId: 1 })).not.toBe(observationCommitment(base));
    expect(observationCommitment({ ...base, registryAddress: "0x0000000000000000000000000000000000000001" })).not.toBe(observationCommitment(base));
  });

  it("target commitment cannot be brute-forced without the salt", () => {
    const real = targetCommitment({ chainId: 84532, registryAddress, cohortKey: k1, criterionHash: "55".repeat(32), criterionSalt: salt });
    expect(real).toBe(TARGET_VECTOR);
    const guesses = Array.from({ length: 200 }, (_, n) =>
      targetCommitment({ chainId: 84532, registryAddress, cohortKey: k1, criterionHash: n.toString(16).padStart(64, "0"), criterionSalt: `0x${"00".repeat(32)}` }),
    );
    expect(guesses).not.toContain(real);
  });
});

describe("P-256 finalization signatures", () => {
  const msg: FinalizationMessage = {
    schema: "blindcount.client.finalization.v1",
    chainId: 84532,
    registryAddress,
    assignmentKey: k2,
    version: 1,
    payloadSha256: "44".repeat(32),
    submissionSalt: salt,
    clientNonce: "nonce",
    clientClaimedAt: "2026-10-24T11:31:22.000Z",
  };

  it("signs and verifies; tampering fails", async () => {
    const kp = await generateDeviceKey();
    const jwk = await exportPublicJwk(kp.publicKey);
    const sig = await signFinalization(kp.privateKey, msg);
    expect(await verifyFinalization(jwk, msg, sig)).toBe(true);
    expect(await verifyFinalization(jwk, { ...msg, payloadSha256: "45".repeat(32) }, sig)).toBe(false);
    const other = await exportPublicJwk((await generateDeviceKey()).publicKey);
    expect(await verifyFinalization(other, msg, sig)).toBe(false);
    expect(await verifyFinalization(jwk, msg, "garbage")).toBe(false);
  });
});

const OBS_VECTOR = "0x50e7e327ab29d29ab3095754f2f30578fc9889d30533193792be72dabb7113b1";
const TARGET_VECTOR = "0xc01b8e69bda55b4882c03ae2929df0cdae665ffca83ccc747018a16594ee2c13";
