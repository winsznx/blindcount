import { unzipSync, type Unzipped } from "fflate";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { registryAbi } from "@blindcount/contracts";
import {
  canonicalize,
  hashCanonical,
  observationCommitment,
  parseStrictJson,
  sha256Hex,
  targetCommitment,
  verifyCanonical,
  verifyFinalization,
  type CriterionObject,
  type FinalizationMessage,
} from "@blindcount/crypto";
import { observationPayloadSchema } from "./observation";
import { evaluate } from "./evaluation";

export const PACKET_SCHEMA = "blindcount.packet.v1";
export const PACKET_LIMITS = { maxFiles: 64, maxTotalBytes: 120 * 1024 * 1024, maxFileBytes: 25 * 1024 * 1024 };

export interface PacketManifest {
  schema: typeof PACKET_SCHEMA;
  generatedAt: string;
  reportId: string;
  reportVersion: number;
  cohortKey: Hex;
  assignmentKey: Hex;
  chainId: number;
  registryAddress: Address;
  rpcHint: string;
  hashAlgorithms: { files: "sha256"; commitments: "keccak256(abi.encode)" };
  canonicalization: "RFC8785-JCS";
  recipientScope: string;
  classification: "CONFIDENTIAL";
  sourceType: "SIMULATED_DEMO" | "FIELD_DATA";
  reviewState: "REVIEWED" | "DISPUTED" | "PENDING";
  criterionIncluded: boolean;
  signaturesRef: "signatures.json";
  schemaVersions: { observation: "blindcount.observation.v1"; criterion: "blindcount.criterion.v1" };
  verificationPolicy: string;
  files: Array<{ path: string; sha256: string; byteLength: number }>;
}

export interface PacketProofVersion {
  version: number;
  submissionId: string;
  payloadSha256: string;
  submissionSalt: Hex;
  commitment: Hex;
  anchorTxHash: Hex | null;
  anchorBlockNumber: string | null;
  finalization: FinalizationMessage;
  deviceKeyId: string;
  signature: string;
  signatureFormat: string;
}

export interface PacketProofs {
  targetCommitment: Hex;
  criterionSalt: Hex | null;
  versions: PacketProofVersion[];
}

export interface PacketSignatures {
  reportSigningKey: JsonWebKey;
  reportSigningKeyFingerprint: string;
  manifestSignature: string;
  deviceKeysSignature: string;
}

export interface PacketDeviceKeys {
  attestedBy: "organization-report-signing-key";
  keys: Array<{ deviceKeyId: string; userId: string; publicJwk: JsonWebKey; enrolledAt: string; revokedAt: string | null; attestationLevel: string }>;
}

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN" | "SKIPPED";
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export type IntegrityStatus = "VERIFIED_INTEGRITY" | "INVALID" | "VALID_LOCAL_ONLY" | "UNABLE_TO_VERIFY";

export interface VerificationResult {
  integrity: IntegrityStatus;
  reviewState: string;
  checks: Check[];
  summary: {
    reportId?: string;
    chainId?: number;
    registryAddress?: string;
    originalCount?: number;
    latestCount?: number;
    versions?: number;
    sourceType?: string;
    criterionIncluded?: boolean;
    reportSigningKeyFingerprint?: string;
    anchorTxHashes?: string[];
    criterion?: { operator: string; targetCount: number };
    recomputedOutcome?: string;
    disclosedOnchain?: boolean;
  };
  disclaimer: string;
}

export const INTEGRITY_DISCLAIMER = "Cryptographic integrity does not establish whether the field count is factually correct.";


/** Registry reads the verifier needs. Every call goes to an RPC the verifier chooses, never to BlindCount. */
export interface ChainReader {
  chainId(): Promise<number>;
  codeExists(address: Address): Promise<boolean>;
  cohort(registry: Address, cohortKey: Hex): Promise<{ state: number; expected: number; terminal: number; targetCommitment: Hex; disclosed: boolean }>;
  assignment(registry: Address, cohortKey: Hex, assignmentKey: Hex): Promise<{ state: number; latestVersion: number }>;
  observationCommitment(registry: Address, cohortKey: Hex, assignmentKey: Hex, version: number): Promise<Hex>;
  /** null when the RPC has no receipt for the hash. */
  txEmitsObservation(registry: Address, txHash: Hex, cohortKey: Hex, assignmentKey: Hex, commitment: Hex): Promise<boolean | null>;
}

const COHORT_CLOSED = 3;
const ASSIGNMENT_ANCHORED = 2;
const ZERO32 = `0x${"0".repeat(64)}`;

export function rpcChainReader(rpcUrl: string, timeoutMs = 10_000): ChainReader {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: timeoutMs, retryCount: 1 }) });
  return {
    chainId: () => client.getChainId(),
    codeExists: async (address) => {
      const code = await client.getCode({ address });
      return !!code && code !== "0x";
    },
    cohort: async (registry, cohortKey) => {
      const [[state, expected, , terminal, targetCommitment], disclosed] = await Promise.all([
        client.readContract({ address: registry, abi: registryAbi, functionName: "getCohortStatus", args: [cohortKey] }),
        client.readContract({ address: registry, abi: registryAbi, functionName: "isDisclosed", args: [cohortKey] }),
      ]);
      return { state, expected, terminal, targetCommitment, disclosed };
    },
    assignment: async (registry, cohortKey, assignmentKey) => {
      const [state, latestVersion] = await client.readContract({ address: registry, abi: registryAbi, functionName: "getAssignmentStatus", args: [cohortKey, assignmentKey] });
      return { state, latestVersion };
    },
    observationCommitment: (registry, cohortKey, assignmentKey, version) =>
      client.readContract({ address: registry, abi: registryAbi, functionName: "getObservationCommitment", args: [cohortKey, assignmentKey, version] }),
    txEmitsObservation: async (registry, txHash, cohortKey, assignmentKey, commitment) => {
      const receipt = await client.getTransactionReceipt({ hash: txHash }).catch((e: unknown) => {
        if (e instanceof Error && e.name === "TransactionReceiptNotFoundError") return null;
        throw e;
      });
      if (!receipt) return null;
      if (receipt.status !== "success") return false;
      return receipt.logs.some(
        (l) =>
          l.address.toLowerCase() === registry.toLowerCase() &&
          l.topics[1]?.toLowerCase() === cohortKey.toLowerCase() &&
          l.topics[2]?.toLowerCase() === assignmentKey.toLowerCase() &&
          l.data.toLowerCase().includes(commitment.slice(2).toLowerCase()),
      );
    },
  };
}

export class PacketFormatError extends Error {}

/**
 * Unzips with zip-slip, duplicate-name, file-count and decompression-bomb limits. Both declared
 * and compressed sizes are bounded, and entries may not overlap, so a small archive can't expand
 * into a huge one by pointing many entries at the same bytes.
 */
export function unzipPacket(zip: Uint8Array): Map<string, Uint8Array> {
  if (zip.byteLength > PACKET_LIMITS.maxTotalBytes) throw new PacketFormatError("packet too large");
  let entries = 0;
  let expanded = 0;
  let compressed = 0;
  const names = new Set<string>();
  let raw: Unzipped;
  try {
    raw = unzipSync(zip, {
      filter: (f) => {
        entries++;
        expanded += f.originalSize;
        compressed += f.size;
        if (entries > PACKET_LIMITS.maxFiles) throw new PacketFormatError("too many files in packet");
        if (names.has(f.name) || f.name === "__proto__") throw new PacketFormatError(`duplicate or reserved entry name: ${f.name}`);
        names.add(f.name);
        if (f.compression === 0 && f.size !== f.originalSize) throw new PacketFormatError(`stored entry ${f.name} declares inconsistent sizes`);
        if (f.originalSize > PACKET_LIMITS.maxFileBytes || f.size > PACKET_LIMITS.maxFileBytes || expanded > PACKET_LIMITS.maxTotalBytes) {
          throw new PacketFormatError("packet expands beyond limits");
        }
        if (compressed > zip.byteLength) throw new PacketFormatError("archive entries overlap");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PacketFormatError) throw e;
    throw new PacketFormatError("not a readable ZIP archive");
  }
  const out = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    if (name.endsWith("/")) continue;
    if (name.startsWith("/") || name.includes("\\") || name.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) {
      throw new PacketFormatError(`unsafe path in packet: ${name}`);
    }
    out.set(name, data);
  }
  return out;
}

const dec = new TextDecoder("utf-8", { fatal: true });

function readJson<T>(files: Map<string, Uint8Array>, path: string): T {
  const data = files.get(path);
  if (!data) throw new PacketFormatError(`missing ${path}`);
  return parseStrictJson(dec.decode(data)) as T;
}

export async function jwkFingerprint(jwk: JsonWebKey): Promise<string> {
  return hashCanonical({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
}

export interface VerifyOptions {
  chain: ChainReader | null;
  /**
   * Trust anchors the issuing organization publishes (GET /v1/system/chain-config) or hands over
   * directly. Without both, the packet can be internally consistent but the issuer is unproven,
   * so the result can't be VERIFIED_INTEGRITY.
   */
  trustedReportKeyFingerprint?: string;
  trustedRegistryAddress?: string;
}

const msg = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : "error");

export async function verifyPacket(files: Map<string, Uint8Array>, opts: VerifyOptions): Promise<VerificationResult> {
  const checks: Check[] = [];
  const summary: VerificationResult["summary"] = {};
  const state = { chainReachable: false, reviewState: "PENDING" };
  try {
    await runChecks(files, opts, checks, summary, state);
  } catch (e) {
    // Anything structurally wrong with a packet is an integrity failure, reported, never thrown.
    checks.push({ name: "packetFormat", status: "FAIL", detail: `packet is malformed: ${msg(e)}` });
  }
  const anyFail = checks.some((c) => c.status === "FAIL");
  const anyUnknown = checks.some((c) => c.status === "UNKNOWN");
  const integrity: IntegrityStatus = anyFail ? "INVALID" : !anyUnknown ? "VERIFIED_INTEGRITY" : state.chainReachable ? "UNABLE_TO_VERIFY" : "VALID_LOCAL_ONLY";
  return { integrity, reviewState: state.reviewState, checks, summary, disclaimer: INTEGRITY_DISCLAIMER };
}

async function runChecks(
  files: Map<string, Uint8Array>,
  opts: VerifyOptions,
  checks: Check[],
  summary: VerificationResult["summary"],
  state: { chainReachable: boolean; reviewState: string },
) {
  const add = (name: string, status: CheckStatus, detail: string) => checks.push({ name, status, detail });

  // 1. Manifest and its signature
  const manifest = readJson<PacketManifest>(files, "manifest.json");
  const signatures = readJson<PacketSignatures>(files, "signatures.json");
  if (manifest.schema !== PACKET_SCHEMA) {
    add("manifest", "UNKNOWN", `unsupported packet schema ${String(manifest.schema)}`);
    return;
  }
  const enumProblems = [
    ["SIMULATED_DEMO", "FIELD_DATA"].includes(manifest.sourceType) ? null : "sourceType",
    ["REVIEWED", "DISPUTED", "PENDING"].includes(manifest.reviewState) ? null : "reviewState",
    Array.isArray(manifest.files) ? null : "files",
    /^0x[0-9a-fA-F]{40}$/.test(manifest.registryAddress) ? null : "registryAddress",
  ].filter(Boolean);
  state.reviewState = manifest.reviewState;
  Object.assign(summary, { reportId: manifest.reportId, chainId: manifest.chainId, registryAddress: manifest.registryAddress, sourceType: manifest.sourceType, criterionIncluded: manifest.criterionIncluded });
  const fingerprint = await jwkFingerprint(signatures.reportSigningKey);
  summary.reportSigningKeyFingerprint = fingerprint;
  const manifestOk = await verifyCanonical(signatures.reportSigningKey, manifest, signatures.manifestSignature).catch(() => false);
  if (enumProblems.length) add("manifest", "FAIL", `manifest has invalid fields: ${enumProblems.join(", ")}`);
  else add("manifest", manifestOk ? "PASS" : "FAIL", manifestOk ? "manifest signature valid" : "manifest signature does not match the packet's report signing key");

  // 2. Issuer binding
  const trustedKey = opts.trustedReportKeyFingerprint?.trim().toLowerCase().replace(/^0x/, "");
  const trustedRegistry = opts.trustedRegistryAddress?.trim().toLowerCase();
  const issuerIssues: string[] = [];
  if (trustedRegistry && trustedRegistry !== manifest.registryAddress.toLowerCase()) issuerIssues.push(`packet was anchored on ${manifest.registryAddress}, not the trusted registry`);
  if (trustedKey && trustedKey !== fingerprint) issuerIssues.push(`packet is signed by key ${fingerprint.slice(0, 16)}…, not the trusted key`);
  if (issuerIssues.length) add("issuer", "FAIL", issuerIssues.join("; "));
  else if (!trustedKey || !trustedRegistry)
    add("issuer", "UNKNOWN", `issuer not pinned: confirm registry ${manifest.registryAddress} and signing key ${fingerprint.slice(0, 16)}… with the issuing organization, then supply both`);
  else add("issuer", "PASS", "registry and signing key match the issuer's published trust anchors");

  // 3. File digests
  const listed = new Set(manifest.files.map((f) => f.path));
  const hashFailures: string[] = [];
  for (const f of manifest.files) {
    const data = files.get(f.path);
    if (!data) hashFailures.push(`${f.path} missing`);
    else if ((await sha256Hex(data)) !== f.sha256 || data.byteLength !== f.byteLength) hashFailures.push(`${f.path} digest mismatch`);
  }
  const unlisted = [...files.keys()].filter((p) => !listed.has(p) && p !== "manifest.json" && p !== "signatures.json");
  if (unlisted.length) hashFailures.push(`unlisted files: ${unlisted.join(", ")}`);
  add("fileHashes", hashFailures.length ? "FAIL" : "PASS", hashFailures.length ? hashFailures.join("; ") : `${manifest.files.length} file digests match`);

  // 4. Payloads: schema, canonical hash, contiguous versions 1..n
  const proofs = readJson<PacketProofs>(files, "proofs.json");
  const deviceKeys = readJson<PacketDeviceKeys>(files, "device-keys.json");
  const payloads: unknown[] = [readJson(files, "observation-v1.json"), ...readJson<unknown[]>(files, "observation-amendments.json")];
  const versions = proofs.versions;
  summary.versions = versions.length;
  const canonFailures: string[] = [];
  if (payloads.length !== versions.length) canonFailures.push(`${payloads.length} payloads but ${versions.length} proofs`);
  versions.forEach((v, i) => {
    if (v.version !== i + 1) canonFailures.push(`proof ${i + 1} is version ${v.version}; versions must run 1..n`);
  });
  const parsed = payloads.map((p) => observationPayloadSchema.safeParse(p));
  for (const [i, payload] of payloads.entries()) {
    const proof = versions[i];
    const pr = parsed[i]!;
    if (!pr.success) canonFailures.push(`version ${i + 1} does not match the observation schema`);
    if (!proof) continue;
    const digest = await hashCanonical(payload);
    if (digest !== proof.payloadSha256) canonFailures.push(`version ${proof.version} payload SHA-256 ${digest.slice(0, 12)}… ≠ signed ${proof.payloadSha256.slice(0, 12)}…`);
    if (pr.success && pr.data.version !== proof.version) canonFailures.push(`payload ${i + 1} claims version ${pr.data.version}`);
  }
  add("payloadCanonicalization", canonFailures.length ? "FAIL" : "PASS", canonFailures.length ? canonFailures.join("; ") : `${payloads.length} payload(s) recomputed under RFC 8785, versions 1..${versions.length}`);
  const first = parsed[0]?.success ? parsed[0].data : null;
  const last = parsed[parsed.length - 1]?.success ? parsed[parsed.length - 1]!.data : null;
  if (first) summary.originalCount = first.count;
  if (last) summary.latestCount = last.count;

  // 5. Device signatures, bound to this payload, assignment, chain and the attested key's owner
  const sigFailures: string[] = [];
  for (const [i, v] of versions.entries()) {
    const key = deviceKeys.keys.find((k) => k.deviceKeyId === v.deviceKeyId);
    const payload = parsed[i]?.success ? parsed[i]!.data : null;
    if (!key) {
      sigFailures.push(`version ${v.version}: device key not in the attested registry`);
      continue;
    }
    const f = v.finalization;
    if (
      f.payloadSha256 !== v.payloadSha256 ||
      f.submissionSalt !== v.submissionSalt ||
      f.version !== v.version ||
      f.assignmentKey !== manifest.assignmentKey ||
      f.chainId !== manifest.chainId ||
      f.registryAddress.toLowerCase() !== manifest.registryAddress.toLowerCase()
    ) {
      sigFailures.push(`version ${v.version}: finalization does not bind this payload, assignment and chain`);
      continue;
    }
    if (payload && payload.deviceKeyId !== v.deviceKeyId) sigFailures.push(`version ${v.version}: payload names a different device key`);
    if (payload && key.userId !== payload.auditorUserId) sigFailures.push(`version ${v.version}: device key belongs to a different person`);
    if (payload && key.revokedAt && key.revokedAt < payload.clientClaimedAt) sigFailures.push(`version ${v.version}: device key was revoked before signing`);
    if (!(await verifyFinalization(key.publicJwk, f, v.signature).catch(() => false))) sigFailures.push(`version ${v.version}: P-256 signature invalid`);
  }
  add("auditorDeviceSignature", sigFailures.length ? "FAIL" : "PASS", sigFailures.length ? sigFailures.join("; ") : `${versions.length} device signature(s) valid and bound to the auditor`);

  const provenanceOk = await verifyCanonical(signatures.reportSigningKey, deviceKeys, signatures.deviceKeysSignature).catch(() => false);
  add(
    "deviceEnrollmentProvenance",
    provenanceOk ? "PASS" : "FAIL",
    provenanceOk ? "device key registry attested by the organization's report signing key" : "device key registry attestation signature invalid",
  );

  // 6. Offline recomputation of both commitments
  const domain = { chainId: manifest.chainId, registryAddress: manifest.registryAddress };
  const obsFailures: string[] = [];
  for (const v of versions) {
    const recomputed = observationCommitment({ ...domain, cohortKey: manifest.cohortKey, assignmentKey: manifest.assignmentKey, version: v.version, payloadSha256: v.payloadSha256, submissionSalt: v.submissionSalt });
    if (recomputed !== v.commitment) obsFailures.push(`version ${v.version} commitment does not recompute from the payload and salt`);
  }
  const targetFailures: string[] = [];
  if (manifest.criterionIncluded) {
    const criterion = readJson<CriterionObject>(files, "criterion.json");
    if (!proofs.criterionSalt) targetFailures.push("criterion salt missing");
    else if (targetCommitment({ ...domain, cohortKey: manifest.cohortKey, criterionHash: await hashCanonical(criterion), criterionSalt: proofs.criterionSalt }) !== proofs.targetCommitment) {
      targetFailures.push("disclosed criterion and salt do not recompute to the target commitment");
    }
    if (criterion.cohortKey !== manifest.cohortKey) targetFailures.push("criterion is bound to a different cohort");
    summary.criterion = { operator: criterion.operator, targetCount: criterion.targetCount };
    if (first && criterion.operator === "gte") summary.recomputedOutcome = evaluate({ operator: "gte", observedCount: first.count, targetCount: criterion.targetCount });
  }

  // 7. Chain: every read independent, so one missing receipt never hides a commitment mismatch
  const anchorTxs = versions.map((v) => v.anchorTxHash).filter((x): x is Hex => !!x);
  summary.anchorTxHashes = anchorTxs;
  const chain = opts.chain;
  let chainUsable = false;
  if (!chain) {
    add("chainCanonicality", "UNKNOWN", "no RPC configured; chain verification NOT CHECKED");
  } else {
    try {
      const id = await chain.chainId();
      state.chainReachable = true;
      if (id !== manifest.chainId) add("chainCanonicality", "UNKNOWN", `this RPC serves chain ${id}; the packet was anchored on chain ${manifest.chainId}. Use an RPC for chain ${manifest.chainId}`);
      else if (!(await chain.codeExists(manifest.registryAddress))) add("chainCanonicality", "UNKNOWN", `this RPC has no contract at ${manifest.registryAddress}`);
      else chainUsable = true;
    } catch (e) {
      add("chainCanonicality", "UNKNOWN", `RPC unreachable: ${msg(e)}`);
    }
  }

  let chainChecked = false;
  if (chain && chainUsable) {
    chainChecked = true;
    const reg = manifest.registryAddress;
    const txIssues: string[] = [];
    const txUnknown: string[] = [];
    for (const v of versions) {
      try {
        const onchain = await chain.observationCommitment(reg, manifest.cohortKey, manifest.assignmentKey, v.version);
        if (onchain.toLowerCase() !== v.commitment.toLowerCase()) obsFailures.push(`version ${v.version}: registry holds ${onchain.slice(0, 10)}…, packet claims ${v.commitment.slice(0, 10)}…`);
      } catch (e) {
        chainChecked = false;
        txUnknown.push(`commitment read for version ${v.version} failed: ${msg(e)}`);
      }
      if (!v.anchorTxHash) {
        txIssues.push(`version ${v.version} has no anchor transaction`);
        continue;
      }
      try {
        const emits = await chain.txEmitsObservation(reg, v.anchorTxHash, manifest.cohortKey, manifest.assignmentKey, v.commitment);
        if (emits === null) txUnknown.push(`RPC has no receipt for ${v.anchorTxHash.slice(0, 10)}…`);
        else if (!emits) txIssues.push(`tx ${v.anchorTxHash.slice(0, 10)}… does not emit this commitment`);
      } catch (e) {
        txUnknown.push(`receipt lookup failed: ${msg(e)}`);
      }
    }
    const lifecycle: string[] = [];
    try {
      const assignment = await chain.assignment(reg, manifest.cohortKey, manifest.assignmentKey);
      if (assignment.state !== ASSIGNMENT_ANCHORED) lifecycle.push(`assignment is not anchored on the registry (state ${assignment.state})`);
      if (assignment.latestVersion !== versions.length) txIssues.push(`registry has ${assignment.latestVersion} version(s) for this assignment; the packet carries ${versions.length}`);
    } catch (e) {
      txUnknown.push(`assignment read failed: ${msg(e)}`);
    }
    try {
      const cohort = await chain.cohort(reg, manifest.cohortKey);
      summary.disclosedOnchain = cohort.disclosed;
      if (cohort.targetCommitment === ZERO32) targetFailures.push("cohort is not registered on this registry");
      else if (cohort.targetCommitment.toLowerCase() !== proofs.targetCommitment.toLowerCase()) targetFailures.push("registry target commitment differs from the packet");
      // The product's core claim: the criterion only appears in a packet after the whole cohort closed onchain.
      if (manifest.criterionIncluded && cohort.state !== COHORT_CLOSED) lifecycle.push("packet discloses the criterion but the cohort is not closed onchain");
    } catch (e) {
      txUnknown.push(`cohort read failed: ${msg(e)}`);
    }
    if (txIssues.length || lifecycle.length) add("chainCanonicality", "FAIL", [...txIssues, ...lifecycle].join("; "));
    else if (txUnknown.length) add("chainCanonicality", "UNKNOWN", txUnknown.join("; "));
    else
      add(
        "chainCanonicality",
        "PASS",
        `anchor receipt(s) found on chain ${manifest.chainId}; assignment anchored at version ${versions.length}${manifest.criterionIncluded ? "; cohort closed onchain before the criterion was disclosed" : ""}`,
      );
  }

  add(
    "targetCommitment",
    targetFailures.length ? "FAIL" : chainChecked ? "PASS" : "UNKNOWN",
    targetFailures.length
      ? targetFailures.join("; ")
      : chainChecked
        ? manifest.criterionIncluded
          ? "disclosed criterion and salt recompute to the commitment registered before collection"
          : "registry target commitment matches (criterion not disclosed in this packet)"
        : "recomputed locally; registry value NOT CHECKED",
  );
  add(
    "observationCommitment",
    obsFailures.length ? "FAIL" : chainChecked ? "PASS" : "UNKNOWN",
    obsFailures.length ? obsFailures.join("; ") : chainChecked ? "salted commitment recomputed and matches the registry" : "recomputed locally; registry value NOT CHECKED",
  );

  // 8. Review chain: amendment links and evidence digests
  const reviewFailures: string[] = [];
  let referenced = 0;
  let included = 0;
  for (const [i, pr] of parsed.entries()) {
    if (!pr.success) continue;
    for (const ev of pr.data.evidence) {
      referenced++;
      const entry = manifest.files.find((f) => f.path.startsWith(`evidence/${ev.fileId}`));
      if (!entry) continue;
      included++;
      if (entry.sha256 !== ev.sha256) reviewFailures.push(`evidence ${ev.fileId.slice(0, 8)} digest differs from the signed payload`);
    }
    if (i > 0 && pr.data.previousSubmissionId !== versions[i - 1]?.submissionId) reviewFailures.push(`version ${i + 1} does not link to version ${i}`);
  }
  add(
    "reviewChain",
    reviewFailures.length ? "FAIL" : "PASS",
    reviewFailures.length ? reviewFailures.join("; ") : `review state ${manifest.reviewState}; ${included} of ${referenced} signed evidence file(s) included and matching; amendment links consistent`,
  );
}
