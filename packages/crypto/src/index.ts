import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";

/**
 * RFC 8785 (JCS) canonicalization, restricted to the value space BlindCount signs:
 * objects, arrays, strings, booleans, null and safe integers. Non-integer numbers are
 * rejected outright because no signed BlindCount schema contains them, and refusing them
 * removes the riskiest cross-runtime divergence (float serialization).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      assertWellFormedUnicode(value);
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) throw new CanonicalizationError(`unsupported number ${value}`);
      return Object.is(value, -0) ? "0" : String(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new CanonicalizationError("unsupported object type");
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
      // JCS sorts by UTF-16 code units, which is exactly JS default string comparison.
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${canonicalize(k)}:${canonicalize(v)}`).join(",")}}`;
    }
    default:
      throw new CanonicalizationError(`unsupported type ${typeof value}`);
  }
}

export class CanonicalizationError extends Error {}

function assertWellFormedUnicode(s: string) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CanonicalizationError("lone surrogate");
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new CanonicalizationError("lone surrogate");
    }
  }
}

/** Parses JSON text and rejects duplicate object keys, which JSON.parse silently collapses. */
export function parseStrictJson(text: string): unknown {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  const fail = (msg: string): never => {
    throw new CanonicalizationError(`${msg} at ${i}`);
  };
  const parseString = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) fail("unterminated string");
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const parseValue = (): unknown => {
    ws();
    const ch = text[i];
    if (ch === "{") {
      i++;
      const keys = new Set<string>();
      const out: Record<string, unknown> = {};
      ws();
      if (text[i] === "}") {
        i++;
        return out;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail("expected key");
        const key = parseString();
        if (keys.has(key)) fail(`duplicate key "${key}"`);
        keys.add(key);
        ws();
        if (text[i] !== ":") fail("expected colon");
        i++;
        Object.defineProperty(out, key, { value: parseValue(), enumerable: true, writable: true, configurable: true });
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return out;
        }
        fail("expected , or }");
      }
    }
    if (ch === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue());
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return arr;
        }
        fail("expected , or ]");
      }
    }
    if (ch === '"') return parseString();
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) fail("unexpected token");
    i += m![0].length;
    return JSON.parse(m![0]);
  };
  const v = parseValue();
  ws();
  if (i !== text.length) fail("trailing data");
  return v;
}

const enc = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Lowercase hex SHA-256, no 0x prefix. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export async function hashCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

export function randomBytes32(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function randomNonce(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

const h = (s: string): Hex => (s.startsWith("0x") ? (s as Hex) : (`0x${s}` as Hex));

export const DOMAIN = {
  observation: keccak256(toHex("BLINDCOUNT_OBSERVATION_V1")),
  target: keccak256(toHex("BLINDCOUNT_TARGET_V1")),
  cohortKey: keccak256(toHex("BLINDCOUNT_COHORT_KEY_V1")),
  assignmentKey: keccak256(toHex("BLINDCOUNT_ASSIGNMENT_KEY_V1")),
} as const;

export interface ChainDomain {
  chainId: number;
  registryAddress: Address;
}

export function deriveCohortKey(p: { organizationId: string; cohortId: string; nonce: Hex }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "bytes32" }],
      [DOMAIN.cohortKey, p.organizationId, p.cohortId, p.nonce],
    ),
  );
}

export function deriveAssignmentKey(p: { organizationId: string; cohortId: string; assignmentId: string; nonce: Hex }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "bytes32" }],
      [DOMAIN.assignmentKey, p.organizationId, p.cohortId, p.assignmentId, p.nonce],
    ),
  );
}

export function observationCommitment(
  p: ChainDomain & { cohortKey: Hex; assignmentKey: Hex; version: number; payloadSha256: string; submissionSalt: Hex },
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        DOMAIN.observation,
        BigInt(p.chainId),
        p.registryAddress,
        p.cohortKey,
        p.assignmentKey,
        p.version,
        h(p.payloadSha256),
        p.submissionSalt,
      ],
    ),
  );
}

export interface CriterionObject {
  schema: "blindcount.criterion.v1";
  operator: "gte";
  unit: "shade_trees";
  targetCount: number;
  cohortKey: Hex;
  version: number;
}

export async function criterionHash(c: CriterionObject): Promise<string> {
  return hashCanonical(c);
}

export function targetCommitment(p: ChainDomain & { cohortKey: Hex; criterionHash: string; criterionSalt: Hex }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [DOMAIN.target, BigInt(p.chainId), p.registryAddress, p.cohortKey, h(p.criterionHash), p.criterionSalt],
    ),
  );
}

export interface FinalizationMessage {
  schema: "blindcount.client.finalization.v1";
  chainId: number;
  registryAddress: string;
  assignmentKey: string;
  version: number;
  payloadSha256: string;
  submissionSalt: string;
  clientNonce: string;
  clientClaimedAt: string;
}

/** WebCrypto ECDSA P-256 with SHA-256; signature bytes are IEEE P1363 (r||s, 64 bytes). */
export const SIGNATURE_FORMAT = "P256_SHA256_P1363" as const;

const ecdsa = { name: "ECDSA", hash: "SHA-256" } as const;

export async function generateDeviceKey(extractable = false): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, extractable, ["sign", "verify"]);
}

export async function exportPublicJwk(key: CryptoKey): Promise<JsonWebKey> {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export async function signFinalization(privateKey: CryptoKey, msg: FinalizationMessage): Promise<string> {
  const sig = await crypto.subtle.sign(ecdsa, privateKey, enc.encode(canonicalize(msg)));
  return base64urlEncode(new Uint8Array(sig));
}

export async function verifyFinalization(publicJwk: JsonWebKey, msg: FinalizationMessage, signatureB64url: string): Promise<boolean> {
  if (publicJwk.kty !== "EC" || publicJwk.crv !== "P-256") return false;
  let sig: Uint8Array;
  try {
    sig = base64urlDecode(signatureB64url);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: publicJwk.x, y: publicJwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return crypto.subtle.verify(ecdsa, key, sig as BufferSource, enc.encode(canonicalize(msg)));
}

/** Detached manifest signature for report packets (same P-256 primitive, separate key). */
export async function signCanonical(privateKey: CryptoKey, value: unknown): Promise<string> {
  const sig = await crypto.subtle.sign(ecdsa, privateKey, enc.encode(canonicalize(value)));
  return base64urlEncode(new Uint8Array(sig));
}

export async function verifyCanonical(publicJwk: JsonWebKey, value: unknown, signatureB64url: string): Promise<boolean> {
  return verifyFinalization(publicJwk, value as FinalizationMessage, signatureB64url);
}
