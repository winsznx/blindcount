import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { resolve } from "node:path";
import { createPrisma } from "@blindcount/db";
import { loadConfig, type Config } from "./lib/config";
import { importSigningKey, type AppContext } from "./lib/context";
import { Vault } from "./lib/secrets";
import { fileOutbox, resendOutbox } from "./lib/email";
import { FileObjectStore } from "./lib/storage";
import { Registry } from "./lib/chain";
import { installHttp } from "./lib/http";
import { authRoutes } from "./routes/auth";
import { orgRoutes } from "./routes/orgs";
import { cohortRoutes } from "./routes/cohorts";
import { assignmentRoutes } from "./routes/assignments";
import { reviewRoutes } from "./routes/reviews";
import { systemRoutes } from "./routes/system";
import { opsRoutes } from "./routes/ops";

export async function createContext(cfg: Config = loadConfig()): Promise<AppContext> {
  const storageRoot = resolve(cfg.STORAGE_DIR);
  const outboxPath = resolve(storageRoot, "outbox.log");
  return {
    cfg,
    prisma: createPrisma(cfg.DATABASE_URL),
    vault: Vault.fromBase64("general-v1", cfg.ENVELOPE_ENCRYPTION_KEY),
    criterionVault: Vault.fromBase64("criterion-v1", cfg.CRITERION_ENCRYPTION_KEY),
    store: new FileObjectStore(resolve(storageRoot, "objects")),
    registry: new Registry(cfg),
    reportKey: await importSigningKey(cfg.REPORT_SIGNING_JWK),
    outbox: cfg.EMAIL_PROVIDER === "resend" ? resendOutbox(cfg) : fileOutbox(outboxPath),
  };
}

export function redactUrl(url: string): string {
  return url.replace(/\?.*$/, "?…").replace(/\/invitations\/[A-Za-z0-9_-]{20,}/, "/invitations/…");
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      ctx.cfg.NODE_ENV === "test"
        ? false
        : {
            level: ctx.cfg.LOG_LEVEL,
            redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
            // Share-grant and invitation tokens travel in URLs; log the path without them.
            serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, url: redactUrl(req.url) }) },
          },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
    genReqId: () => `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
  });
  await app.register(cookie, { secret: ctx.cfg.SESSION_SECRET });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute", keyGenerator: (req) => req.ip });
  installHttp(app, ctx);
  authRoutes(app, ctx);
  orgRoutes(app, ctx);
  cohortRoutes(app, ctx);
  assignmentRoutes(app, ctx);
  reviewRoutes(app, ctx);
  systemRoutes(app, ctx);
  opsRoutes(app, ctx);
  return app;
}
