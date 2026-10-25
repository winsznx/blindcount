import { randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, sha256, type AppContext } from "../lib/context";
import { ApiError } from "../lib/errors";
import { newToken, ok, parse, requireUser, SESSION_COOKIE, SESSION_TTL_MS, setSessionCookie } from "../lib/http";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;
const EMAIL_FAILURE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_FAILURE_LIMIT = 10;

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const codeHash = (email: string, code: string) => sha256(`${ctx.cfg.SESSION_SECRET}:login:${email}:${code}`);

  /** Attempts across every code for this email in the last hour, so issuing new codes never resets the budget. */
  async function emailLocked(email: string): Promise<boolean> {
    const since = new Date(Date.now() - EMAIL_FAILURE_WINDOW_MS);
    const [all, used] = await Promise.all([
      ctx.prisma.loginCode.aggregate({ where: { email, createdAt: { gt: since } }, _sum: { attempts: true } }),
      ctx.prisma.loginCode.count({ where: { email, createdAt: { gt: since }, usedAt: { not: null } } }),
    ]);
    // A used code's final attempt was the successful one; everything else is a failure.
    return (all._sum.attempts ?? 0) - used >= EMAIL_FAILURE_LIMIT;
  }

  app.post("/v1/auth/email/start", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const recent = await ctx.prisma.loginCode.findFirst({ where: { email, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } } });
    // Same 202 regardless of whether the account exists, a cooldown applies or the email is locked (anti-enumeration).
    if (!recent && !(await emailLocked(email))) {
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      await ctx.prisma.loginCode.create({ data: { email, codeHash: codeHash(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
      await ctx.outbox(email, "Your BlindCount sign-in code", `Your BlindCount sign-in code is ${code}. It expires in 10 minutes.`);
    }
    return reply.status(202).send(ok(req, { sent: true, cooldownSeconds: RESEND_COOLDOWN_MS / 1000 }));
  });

  app.post("/v1/auth/email/verify", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { email, code, displayName } = parse(
      z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/), displayName: z.string().trim().min(1).max(80).optional() }),
      req.body,
    );
    const pending = await ctx.prisma.loginCode.findFirst({ where: { email, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    const invalid = new ApiError("UNAUTHENTICATED", "That code is invalid or expired");
    if (!pending) throw invalid;
    if (await emailLocked(email)) throw new ApiError("RATE_LIMITED", "Too many attempts for this email. Try again in an hour.");
    // Reserve the attempt atomically before comparing, so concurrent guesses can't share one budget.
    const reserved = await ctx.prisma.loginCode.updateMany({ where: { id: pending.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    if (reserved.count !== 1) throw invalid;
    if (!timingSafeEqual(Buffer.from(pending.codeHash), Buffer.from(codeHash(email, code)))) throw invalid;
    const claimed = await ctx.prisma.loginCode.updateMany({ where: { id: pending.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw invalid;

    const now = new Date();
    const user = await ctx.prisma.user.upsert({
      where: { email },
      create: { email, emailVerifiedAt: now, displayName: displayName ?? email.split("@")[0]!, lastLoginAt: now },
      update: { emailVerifiedAt: now, lastLoginAt: now },
    });
    if (user.status !== "ACTIVE") throw invalid;

    // Re-verifying while signed in refreshes the step-up window on the existing session.
    const existing = req.user?.id === user.id ? req.user.sessionId : null;
    if (existing) {
      await ctx.prisma.session.update({ where: { id: existing }, data: { reauthedAt: now } });
    } else {
      const token = newToken();
      await ctx.prisma.session.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
      setSessionCookie(ctx, reply, token);
    }
    await audit(ctx.prisma, { actorId: user.id, action: existing ? "auth.reauthenticated" : "auth.signed_in", objectType: "user", objectId: user.id, traceId: req.id });
    return ok(req, { userId: user.id, reauthenticated: !!existing });
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const user = requireUser(req);
    await ctx.prisma.session.update({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/v1/auth/me", async (req) => {
    const user = requireUser(req);
    const memberships = await ctx.prisma.membership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { organization: { select: { id: true, name: true, countryCode: true, timeZone: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ok(req, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      reauthedAt: user.reauthedAt.toISOString(),
      memberships: memberships.map((m) => ({ organization: m.organization, roles: m.roles, authVersion: m.authVersion })),
    });
  });
}
