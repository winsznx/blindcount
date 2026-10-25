import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@blindcount/db";
import type { Config } from "./config";
import type { ObjectStore } from "./storage";
import type { Registry } from "./chain";
import { Vault } from "./secrets";

export interface SigningKey {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
}

export interface AppContext {
  cfg: Config;
  prisma: PrismaClient;
  vault: Vault;
  criterionVault: Vault;
  store: ObjectStore;
  registry: Registry;
  reportKey: SigningKey;
  outbox: (to: string, subject: string, body: string) => Promise<void>;
}

export async function importSigningKey(jwkJson: string): Promise<SigningKey> {
  const jwk = JSON.parse(jwkJson) as JsonWebKey;
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface AuditInput {
  organizationId?: string | null;
  actorId?: string | null;
  actorType?: "user" | "system" | "worker";
  action: string;
  objectType: string;
  objectId?: string | null;
  traceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

/** Append-only audit trail. Metadata must already be redacted: never notes, targets, salts or signatures. */
export function audit(db: PrismaClient | Prisma.TransactionClient, e: AuditInput) {
  return db.auditEvent.create({
    data: {
      organizationId: e.organizationId ?? null,
      actorId: e.actorId ?? null,
      actorType: e.actorType ?? "user",
      action: e.action,
      objectType: e.objectType,
      objectId: e.objectId ?? null,
      traceId: e.traceId ?? randomUUID(),
      metadataRedacted: e.metadata ?? {},
    },
  });
}
