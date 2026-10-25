export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryable = false,
  ) {
    super(message);
  }
  get offline(): boolean {
    return this.status === 0;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T>(method: Method, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body !== undefined && !(body instanceof Blob) ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { "x-blindcount-csrf": "1" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, "OFFLINE", "You appear to be offline. Your work is kept on this device.", {}, true);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; details?: Record<string, unknown>; retryable?: boolean } } | null;
  if (!res.ok || !json || json.error) {
    const e = json?.error;
    throw new ApiFailure(res.status, e?.code ?? "INTERNAL_ERROR", e?.message ?? "Something went wrong on the server.", e?.details ?? {}, e?.retryable ?? res.status >= 500);
  }
  return json.data as T;
}

export const get = <T,>(path: string) => api<T>("GET", path);

export function idemKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    const fields = (e.details.fields as Array<{ path: string; message: string }> | undefined) ?? [];
    return fields.length ? `${e.message}: ${fields.map((f) => `${f.path || "value"} ${f.message.toLowerCase()}`).join("; ")}` : e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  reauthedAt: string;
  memberships: Array<{ organization: { id: string; name: string; countryCode: string; timeZone: string }; roles: Role[] }>;
}

export type Role = "OWNER" | "MANAGER" | "AUDITOR" | "REVIEWER" | "CUSTODIAN";

export interface ChainConfig {
  chainId: number;
  chainName: string;
  registryAddress: string;
  rpcHint: string | null;
  explorerUrl: string | null;
  reportSigningKeyFingerprint: string;
  verifierVersion: string;
  appEnv: string;
  relayerAddress: string;
}
