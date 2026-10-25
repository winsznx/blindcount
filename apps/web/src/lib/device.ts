/**
 * Device-local storage for field work (PRD 15.2). The signing key is a non-extractable
 * WebCrypto P-256 key stored as a CryptoKey object in IndexedDB; its private half can never
 * be read by JavaScript. Drafts and signed envelopes are encrypted with a separate
 * non-extractable AES-GCM key held the same way.
 */
import { exportPublicJwk } from "@blindcount/crypto";

const DB_NAME = "blindcount";
const DB_VERSION = 1;
const STORES = ["deviceMetadata", "draftsEncrypted", "signedFinalizations", "lastSyncReceipts"] as const;
type Store = (typeof STORES)[number];

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser does not support offline storage."));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => {
      // Another tab upgrading the schema closes this connection; reopen lazily next time.
      req.result.onversionchange = () => {
        req.result.close();
        connection = null;
      };
      resolve(req.result);
    };
    req.onblocked = () => reject(new Error("Close other BlindCount tabs so offline storage can update."));
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
  connection.catch(() => {
    connection = null;
  });
  return connection;
}

/** Resolves only when the transaction commits, so "saved" always means durably saved. */
async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onabort = t.onerror = () => reject(t.error ?? r.error ?? new Error("Couldn't save on this device. Storage may be full."));
  });
}

export const idbGet = <T,>(store: Store, key: string) => tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbPut = (store: Store, key: string, value: unknown) => tx(store, "readwrite", (s) => s.put(value, key));
export const idbDelete = (store: Store, key: string) => tx(store, "readwrite", (s) => s.delete(key));
export const idbKeys = (store: Store) => tx<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys());

export interface DeviceRecord {
  orgId: string;
  userId: string;
  deviceKeyId: string | null;
  signingKey: CryptoKeyPair;
  storageKey: CryptoKey;
  createdAt: string;
}

const deviceSlot = (orgId: string, userId: string) => `device:${orgId}:${userId}`;

export function webCryptoSupported(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof indexedDB !== "undefined";
}

export async function loadDevice(orgId: string, userId: string): Promise<DeviceRecord | null> {
  return (await idbGet<DeviceRecord>("deviceMetadata", deviceSlot(orgId, userId))) ?? null;
}

export async function createDevice(orgId: string, userId: string): Promise<DeviceRecord> {
  const signingKey = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const storageKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const rec: DeviceRecord = { orgId, userId, deviceKeyId: null, signingKey, storageKey, createdAt: new Date().toISOString() };
  await idbPut("deviceMetadata", deviceSlot(orgId, userId), rec);
  return rec;
}

export async function saveDeviceId(rec: DeviceRecord, deviceKeyId: string) {
  await idbPut("deviceMetadata", deviceSlot(rec.orgId, rec.userId), { ...rec, deviceKeyId });
}

export async function forgetDevice(orgId: string, userId: string) {
  await idbDelete("deviceMetadata", deviceSlot(orgId, userId));
}

export const publicJwk = (rec: DeviceRecord) => exportPublicJwk(rec.signingKey.publicKey);

interface Sealed {
  iv: Uint8Array;
  ct: ArrayBuffer;
}

async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv, ct };
}

async function unseal<T>(key: CryptoKey, s: Sealed): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: s.iv }, key, s.ct);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export async function saveEncrypted(store: "draftsEncrypted" | "signedFinalizations", rec: DeviceRecord, key: string, value: unknown) {
  await idbPut(store, key, await seal(rec.storageKey, value));
}

export async function loadEncrypted<T>(store: "draftsEncrypted" | "signedFinalizations", rec: DeviceRecord, key: string): Promise<T | null> {
  const s = await idbGet<Sealed>(store, key);
  if (!s) return null;
  try {
    return await unseal<T>(rec.storageKey, s);
  } catch {
    return null;
  }
}

/** Binary payloads (photos) are encrypted directly, never routed through JSON. */
export async function saveBinary(rec: DeviceRecord, key: string, data: ArrayBuffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, rec.storageKey, data);
  await idbPut("draftsEncrypted", key, { iv, ct });
}

export async function loadBinary(rec: DeviceRecord, key: string): Promise<ArrayBuffer | null> {
  const s = await idbGet<Sealed>("draftsEncrypted", key);
  if (!s) return null;
  try {
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv: s.iv }, rec.storageKey, s.ct);
  } catch {
    return null;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
