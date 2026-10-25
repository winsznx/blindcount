import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope. Two independent keys: one for general confidential data
 * (payloads, submission salts) and one reserved for hidden criteria (INV-08).
 * Ciphertext format: v1.<keyRef>.<iv b64>.<tag b64>.<ct b64>
 */
export class Vault {
  constructor(
    private readonly keyRef: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) throw new Error("vault key must be 32 bytes");
  }

  static fromBase64(keyRef: string, b64: string): Vault {
    return new Vault(keyRef, Buffer.from(b64, "base64"));
  }

  get ref(): string {
    return this.keyRef;
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return ["v1", this.keyRef, iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
  }

  decrypt(envelope: string, aad: string): string {
    const [v, ref, iv, tag, ct] = envelope.split(".");
    if (v !== "v1" || ref !== this.keyRef || !iv || !tag || !ct) throw new Error("vault envelope mismatch");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  }
}
