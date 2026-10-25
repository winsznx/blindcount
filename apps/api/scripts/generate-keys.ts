import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { generatePrivateKey } from "viem/accounts";

// Writes fresh secrets to a file (never stdout). Usage: pnpm --filter @blindcount/api keys:generate <out-file>
const out = process.argv[2];
if (!out) {
  console.error("usage: keys:generate <output env file>");
  process.exit(3);
}
if (existsSync(out)) {
  console.error(`${out} exists; refusing to overwrite`);
  process.exit(3);
}
const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const lines = [
  `SESSION_SECRET=${randomBytes(48).toString("base64url")}`,
  `ENVELOPE_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
  `CRITERION_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
  `REPORT_SIGNING_JWK='${JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d })}'`,
  `CHAIN_VOID_APPROVER_PRIVATE_KEY=${generatePrivateKey()}`,
];
writeFileSync(out, lines.join("\n") + "\n", { mode: 0o600 });
console.error(`wrote ${lines.length} secrets to ${out}`);
