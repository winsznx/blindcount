import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MANAGER_INVITABLE, type Role } from "@blindcount/domain";
import { hashCanonical } from "@blindcount/crypto";
import { audit, sha256, type AppContext } from "../lib/context";
import { ApiError, forbidden, notFound } from "../lib/errors";
import { newToken, ok, parse, requireFreshAuth, requireMember, requireUser } from "../lib/http";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const roleSchema = z.enum(["OWNER", "MANAGER", "AUDITOR", "REVIEWER", "CUSTODIAN"]);
const PRIVILEGED_ROLES: readonly Role[] = ["OWNER", "MANAGER", "CUSTODIAN"];

export function orgRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/organizations", async (req, reply) => {
    const user = requireUser(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        countryCode: z.string().regex(/^[A-Z]{2}$/),
        timeZone: z.string().min(1).max(64).refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "unknown time zone"),
        privacyAcknowledged: z.literal(true),
      }),
      req.body,
    );
    const org = await ctx.prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({ data: { name: body.name, countryCode: body.countryCode, timeZone: body.timeZone } });
      // Creator is owner + manager + criterion custodian; separation is enforced per action (SoD), not by role exclusivity.
      await tx.membership.create({ data: { organizationId: o.id, userId: user.id, roles: ["OWNER", "MANAGER", "CUSTODIAN"] } });
      await audit(tx, { organizationId: o.id, actorId: user.id, action: "organization.created", objectType: "organization", objectId: o.id, traceId: req.id });
      return o;
    });
    return reply.status(201).send(ok(req, org));
  });

  app.get<{ Params: { orgId: string } }>("/v1/organizations/:orgId", async (req) => {
    const scope = await requireMember(ctx, req, req.params.orgId);
    const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: scope.organizationId } });
    return ok(req, { ...org, myRoles: scope.roles });
  });

  app.get<{ Params: { orgId: string } }>("/v1/organizations/:orgId/members", async (req) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "org.members.read");
    const [members, invitations] = await Promise.all([
      ctx.prisma.membership.findMany({ where: { organizationId: scope.organizationId }, include: { user: { select: { id: true, email: true, displayName: true } } }, orderBy: { createdAt: "asc" } }),
      ctx.prisma.invitation.findMany({ where: { organizationId: scope.organizationId, acceptedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    ]);
    return ok(req, {
      members: members.map((m) => ({ userId: m.userId, email: m.user.email, displayName: m.user.displayName, roles: m.roles, status: m.status })),
      invitations: invitations.map((i) => ({ id: i.id, email: i.email, roles: i.roles, expiresAt: i.expiresAt, deliveryStatus: i.deliveryStatus, expired: i.expiresAt < new Date() })),
    });
  });

  app.post<{ Params: { orgId: string } }>("/v1/organizations/:orgId/invitations", async (req, reply) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "org.invite");
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), roles: z.array(roleSchema).min(1).max(5) }), req.body);
    const isOwner = scope.roles.includes("OWNER");
    if (!isOwner && body.roles.some((r) => !MANAGER_INVITABLE.includes(r))) throw forbidden("Managers may only invite auditors and reviewers");
    // Granting yourself a role would let one person hold conflicting duties (PRD 3.2).
    if (body.email === scope.user.email) throw forbidden("You can't invite yourself. Ask another owner to change your roles.");
    if (body.roles.some((r) => PRIVILEGED_ROLES.includes(r))) requireFreshAuth(scope.user);

    const token = newToken();
    const invite = await ctx.prisma.$transaction(async (tx) => {
      // Replace any outstanding invite for the same address (single live token per org+email).
      await tx.invitation.updateMany({ where: { organizationId: scope.organizationId, email: body.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const inv = await tx.invitation.create({
        data: { organizationId: scope.organizationId, email: body.email, roles: body.roles, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedBy: scope.user.id },
      });
      await audit(tx, { organizationId: scope.organizationId, actorId: scope.user.id, action: "membership.invited", objectType: "invitation", objectId: inv.id, traceId: req.id, metadata: { roles: body.roles.join(",") } });
      return inv;
    });
    const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: scope.organizationId } });
    let deliveryStatus: "SENT" | "FAILED" = "SENT";
    try {
      await ctx.outbox(body.email, `You're invited to ${org.name} on BlindCount`, `Accept your invitation: ${ctx.cfg.WEB_URL}/invite/${token}\nThis link is single-use and expires in 7 days.`);
      await ctx.prisma.invitation.update({ where: { id: invite.id }, data: { deliveryStatus: "SENT" } });
    } catch {
      deliveryStatus = "FAILED";
      await ctx.prisma.invitation.update({ where: { id: invite.id }, data: { deliveryStatus } });
    }
    return reply.status(201).send(ok(req, { id: invite.id, email: invite.email, roles: invite.roles, expiresAt: invite.expiresAt, deliveryStatus }));
  });

  app.delete<{ Params: { orgId: string; id: string } }>("/v1/organizations/:orgId/invitations/:id", async (req, reply) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "org.invite");
    const r = await ctx.prisma.invitation.updateMany({ where: { id: req.params.id, organizationId: scope.organizationId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) throw notFound();
    await audit(ctx.prisma, { organizationId: scope.organizationId, actorId: scope.user.id, action: "membership.invite_revoked", objectType: "invitation", objectId: req.params.id, traceId: req.id });
    return reply.status(204).send();
  });

  app.get<{ Params: { token: string } }>("/v1/invitations/:token", async (req) => {
    const inv = await ctx.prisma.invitation.findUnique({ where: { tokenHash: sha256(req.params.token) } });
    if (!inv || inv.revokedAt || inv.acceptedAt) throw new ApiError("NOT_FOUND", "This invitation is no longer valid");
    const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: inv.organizationId }, select: { name: true } });
    return ok(req, { organizationName: org.name, roles: inv.roles, expired: inv.expiresAt < new Date(), emailHint: inv.email.replace(/^(.).*(@.*)$/, "$1…$2") });
  });

  app.post<{ Params: { token: string } }>("/v1/invitations/:token/accept", async (req) => {
    const user = requireUser(req);
    const result = await ctx.prisma.$transaction(async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { tokenHash: sha256(req.params.token) } });
      if (!inv || inv.revokedAt || inv.acceptedAt) throw new ApiError("NOT_FOUND", "This invitation is no longer valid");
      if (inv.expiresAt < new Date()) throw new ApiError("STATE_CONFLICT", "This invitation has expired. Ask for a new one.");
      if (inv.email !== user.email) throw forbidden("This invitation was sent to a different email address");
      if ((inv.roles as Role[]).some((r) => PRIVILEGED_ROLES.includes(r))) requireFreshAuth(user);
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new ApiError("NOT_FOUND", "This invitation is no longer valid");
      const existing = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } } });
      const roles = Array.from(new Set([...(existing?.status === "ACTIVE" ? existing.roles : []), ...inv.roles])) as Role[];
      await tx.membership.upsert({
        where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } },
        create: { organizationId: inv.organizationId, userId: user.id, roles },
        update: { roles, status: "ACTIVE", authVersion: { increment: 1 } },
      });
      await audit(tx, { organizationId: inv.organizationId, actorId: user.id, action: "membership.accepted", objectType: "invitation", objectId: inv.id, traceId: req.id });
      return { organizationId: inv.organizationId, roles };
    });
    return ok(req, result);
  });

  app.delete<{ Params: { orgId: string; userId: string } }>("/v1/organizations/:orgId/members/:userId", async (req, reply) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "org.members.revoke");
    requireFreshAuth(scope.user);
    if (req.params.userId === scope.user.id) throw new ApiError("STATE_CONFLICT", "Owners cannot revoke themselves");
    await ctx.prisma.$transaction(async (tx) => {
      const r = await tx.membership.updateMany({ where: { organizationId: scope.organizationId, userId: req.params.userId, status: "ACTIVE" }, data: { status: "REVOKED", authVersion: { increment: 1 } } });
      if (r.count === 0) throw notFound();
      // A pending invitation must not reinstate someone who was just removed.
      const member = await tx.user.findUniqueOrThrow({ where: { id: req.params.userId }, select: { email: true } });
      await tx.invitation.updateMany({ where: { organizationId: scope.organizationId, email: member.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.deviceKey.updateMany({ where: { organizationId: scope.organizationId, userId: req.params.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, { organizationId: scope.organizationId, actorId: scope.user.id, action: "membership.revoked", objectType: "user", objectId: req.params.userId, traceId: req.id });
    });
    return reply.status(204).send();
  });

  // ---- devices (FR-005) ----
  const jwkSchema = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/), y: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

  app.post<{ Params: { orgId: string } }>("/v1/organizations/:orgId/devices", async (req, reply) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "visit.own");
    const body = parse(z.object({ label: z.string().trim().min(1).max(80), publicJwk: jwkSchema }), req.body);
    const thumb = await hashCanonical(body.publicJwk);
    const existing = await ctx.prisma.deviceKey.findUnique({ where: { jwkThumbprint: thumb } });
    if (existing) {
      if (existing.userId !== scope.user.id || existing.organizationId !== scope.organizationId) throw new ApiError("STATE_CONFLICT", "Key already registered");
      if (existing.revokedAt) throw new ApiError("STATE_CONFLICT", "This key was revoked. Generate a new device key.");
      return ok(req, { id: existing.id, label: existing.deviceLabel, enrolledAt: existing.enrolledAt });
    }
    const dev = await ctx.prisma.deviceKey.create({
      data: { organizationId: scope.organizationId, userId: scope.user.id, deviceLabel: body.label, publicJwk: body.publicJwk, jwkThumbprint: thumb },
    });
    await audit(ctx.prisma, { organizationId: scope.organizationId, actorId: scope.user.id, action: "device.enrolled", objectType: "device_key", objectId: dev.id, traceId: req.id });
    return reply.status(201).send(ok(req, { id: dev.id, label: dev.deviceLabel, enrolledAt: dev.enrolledAt }));
  });

  app.get<{ Params: { orgId: string } }>("/v1/organizations/:orgId/devices", async (req) => {
    const scope = await requireMember(ctx, req, req.params.orgId);
    const isOwner = scope.roles.includes("OWNER");
    const devices = await ctx.prisma.deviceKey.findMany({
      where: { organizationId: scope.organizationId, ...(isOwner ? {} : { userId: scope.user.id }) },
      include: { user: { select: { email: true } } },
      orderBy: { enrolledAt: "desc" },
    });
    return ok(req, devices.map((d) => ({ id: d.id, label: d.deviceLabel, userEmail: d.user.email, mine: d.userId === scope.user.id, enrolledAt: d.enrolledAt, revokedAt: d.revokedAt, attestationLevel: d.attestationLevel })));
  });

  app.delete<{ Params: { orgId: string; id: string } }>("/v1/organizations/:orgId/devices/:id", async (req, reply) => {
    const scope = await requireMember(ctx, req, req.params.orgId);
    const dev = await ctx.prisma.deviceKey.findFirst({ where: { id: req.params.id, organizationId: scope.organizationId } });
    if (!dev) throw notFound();
    if (dev.userId !== scope.user.id && !scope.roles.includes("OWNER")) throw forbidden();
    await ctx.prisma.deviceKey.update({ where: { id: dev.id }, data: { revokedAt: dev.revokedAt ?? new Date() } });
    await audit(ctx.prisma, { organizationId: scope.organizationId, actorId: scope.user.id, action: "device.revoked", objectType: "device_key", objectId: dev.id, traceId: req.id });
    return reply.status(204).send();
  });

  app.get<{ Params: { orgId: string }; Querystring: { format?: string } }>("/v1/organizations/:orgId/audit-events", async (req, reply) => {
    const scope = await requireMember(ctx, req, req.params.orgId, "org.members.read");
    const events = await ctx.prisma.auditEvent.findMany({ where: { organizationId: scope.organizationId }, orderBy: { recordedAt: "desc" }, take: 500 });
    if (req.query.format === "csv") {
      const { csvRow } = await import("../lib/csv");
      const lines = [csvRow(["recorded_at", "actor_id", "actor_type", "action", "object_type", "object_id", "trace_id"])];
      for (const e of events) lines.push(csvRow([e.recordedAt.toISOString(), e.actorId ?? "", e.actorType, e.action, e.objectType, e.objectId ?? "", e.traceId]));
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="audit-events.csv"').send(lines.join("\r\n") + "\r\n");
    }
    return ok(req, events);
  });
}
