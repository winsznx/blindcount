import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp, createContext } from "../src/app";
import { loadConfig } from "../src/lib/config";
import type { AppContext } from "../src/lib/context";
import { runOnce } from "../src/worker";

export async function setup(): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const cfg = loadConfig({ ...process.env, NODE_ENV: "test", RUN_WORKER_IN_PROCESS: "false" });
  const ctx = await createContext(cfg);
  const tables = await ctx.prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE bypasses the row-level append-only triggers; acceptable for an ephemeral test database only.
  await ctx.prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  const app = await buildApp(ctx);
  return { app, ctx };
}

export async function drainJobs(ctx: AppContext, max = 200) {
  for (let i = 0; i < max; i++) {
    if (!(await runOnce(ctx))) {
      const pending = await ctx.prisma.anchorJob.count({ where: { state: { in: ["QUEUED", "RUNNING", "FAILED"] } } });
      if (!pending) return;
      // On a public chain a job may be waiting for confirmations; give it time before polling again.
      await new Promise((r) => setTimeout(r, ctx.cfg.CHAIN_ID === 31337 ? 50 : 4000));
    }
  }
}

export function lastCodeFor(ctx: AppContext, email: string): string {
  const p = resolve(ctx.cfg.STORAGE_DIR, "outbox.log");
  if (!existsSync(p)) throw new Error("no outbox");
  const lines = readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; body: string });
  const m = lines.filter((l) => l.to === email).map((l) => /code is (\d{6})/.exec(l.body)?.[1] ?? /invite\/([A-Za-z0-9_-]+)/.exec(l.body)?.[1]).filter(Boolean);
  return m[m.length - 1]!;
}

export function lastInviteTokenFor(ctx: AppContext, email: string): string {
  const p = resolve(ctx.cfg.STORAGE_DIR, "outbox.log");
  const lines = readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; body: string });
  const m = lines.filter((l) => l.to === email).map((l) => /invite\/([A-Za-z0-9_-]+)/.exec(l.body)?.[1]).filter(Boolean);
  return m[m.length - 1]!;
}

export class Client {
  cookie = "";
  constructor(
    private readonly app: FastifyInstance,
    private readonly ctx: AppContext,
    readonly email: string,
  ) {}

  async req(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const isBuffer = Buffer.isBuffer(body);
    const res = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : isBuffer ? body : JSON.stringify(body),
      headers: {
        ...(body !== undefined && !isBuffer ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { "x-blindcount-csrf": "1", origin: "http://localhost:3000" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
    });
    const set = res.headers["set-cookie"];
    const c = (Array.isArray(set) ? set : set ? [set] : []).find((x) => x.startsWith("bc_session="));
    if (c) this.cookie = c.split(";")[0]!;
    return res;
  }

  async signIn(displayName?: string) {
    const s = await this.req("POST", "/v1/auth/email/start", { email: this.email });
    if (s.statusCode !== 202) throw new Error(`start ${s.statusCode}`);
    const code = lastCodeFor(this.ctx, this.email);
    const v = await this.req("POST", "/v1/auth/email/verify", { email: this.email, code, displayName });
    if (v.statusCode !== 200) throw new Error(`verify ${v.statusCode} ${v.body}`);
    return v.json().data.userId as string;
  }
}

/** Generates a real, valid RGB PNG of the given size with a unique colour. */
export function makePng(width: number, height: number, seed: number): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = (seed * 37 + x) & 0xff;
    row[2 + x * 3] = (seed * 91) & 0xff;
    row[3 + x * 3] = (x * 3) & 0xff;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
