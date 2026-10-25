import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { CanonicalizationError } from "@blindcount/crypto";
import { can, type Action, type Role } from "@blindcount/domain";
import { ApiError, forbidden, notFound } from "./errors";
import { sha256, type AppContext } from "./context";

export const SESSION_COOKIE = "bc_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
  reauthedAt: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthedUser | null;
  }
}

export function ok<T>(req: FastifyRequest, data: T) {
  return { data, requestId: req.id };
}

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ApiError("INVALID_REQUEST", "Request validation failed", {
      fields: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return r.data;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function installHttp(app: FastifyInstance, ctx: AppContext) {
  app.decorateRequest("user", null);

  // CSRF: every mutation must be same-origin and carry the custom header (forces CORS preflight).
  app.addHook("onRequest", async (req) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.headers["x-blindcount-csrf"] !== "1") throw new ApiError("NOT_AUTHORIZED", "Missing CSRF header");
    const origin = req.headers.origin;
    const allowed = ctx.cfg.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    if (origin && !allowed.includes(origin)) throw new ApiError("NOT_AUTHORIZED", "Cross-origin request rejected");
  });

  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await ctx.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== "ACTIVE" || !session.user.emailVerifiedAt) return;
    req.user = {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      sessionId: session.id,
      reauthedAt: session.reauthedAt,
    };
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? {}, requestId: req.id, retryable: err.retryable } });
    }
    // Inputs JSON accepts but canonical JSON can't represent (lone surrogates, unsafe integers) are client errors.
    if (err instanceof CanonicalizationError) {
      return reply.status(422).send({ error: { code: "INVALID_OBSERVATION", message: "The observation contains values that can't be signed canonically", details: {}, requestId: req.id, retryable: false } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "Validation failed", details: {}, requestId: req.id, retryable: false } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests", details: {}, requestId: req.id, retryable: true } });
    if (e.statusCode === 413 || e.code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply.status(413).send({ error: { code: "FILE_TOO_LARGE", message: "Body too large", details: {}, requestId: req.id, retryable: false } });
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)
      return reply.status(e.statusCode).send({ error: { code: "INVALID_REQUEST", message: "Malformed request", details: {}, requestId: req.id, retryable: false } });
    req.log.error({ err: { message: e.message, code: e.code } }, "unhandled error");
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal error", details: {}, requestId: req.id, retryable: true } });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found", details: {}, requestId: req.id, retryable: false } });
  });
}

export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) throw new ApiError("UNAUTHENTICATED", "Sign in required");
  return req.user;
}

export function requireFreshAuth(user: AuthedUser) {
  if (Date.now() - user.reauthedAt.getTime() > REAUTH_WINDOW_MS) {
    throw new ApiError("REAUTH_REQUIRED", "Confirm your identity again to perform this action");
  }
}

export interface MemberScope {
  user: AuthedUser;
  organizationId: string;
  roles: Role[];
}

/** Live membership check on every request (INV-14). Non-members get 404, never 403 (no existence leak). */
export async function requireMember(ctx: AppContext, req: FastifyRequest, organizationId: string, action?: Action): Promise<MemberScope> {
  const user = requireUser(req);
  if (!/^[0-9a-f-]{36}$/.test(organizationId)) throw notFound();
  const m = await ctx.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } } });
  if (!m || m.status !== "ACTIVE") throw notFound();
  const roles = m.roles as Role[];
  if (action && !can(roles, action)) throw forbidden();
  return { user, organizationId, roles };
}

export function idempotencyKey(req: FastifyRequest): string {
  const k = req.headers["idempotency-key"];
  if (typeof k !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(k)) throw new ApiError("INVALID_REQUEST", "Idempotency-Key header required");
  return k;
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.cfg.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}
