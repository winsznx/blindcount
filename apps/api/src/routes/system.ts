import type { FastifyInstance } from "fastify";
import { keccak256, toHex } from "viem";
import { registryAbi } from "@blindcount/contracts";
import { jwkFingerprint } from "@blindcount/domain";
import type { AppContext } from "../lib/context";
import { ok } from "../lib/http";

export const VERIFIER_VERSION = "blindcount-verify/1.0.0";

export function systemRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/v1/system/chain-config", async (req) => {
    return ok(req, {
      chainId: ctx.cfg.CHAIN_ID,
      chainName: ctx.cfg.CHAIN_NAME,
      registryAddress: ctx.registry.address,
      abiHash: keccak256(toHex(JSON.stringify(registryAbi))),
      rpcHint: ctx.cfg.CHAIN_PUBLIC_RPC_HINT ?? null,
      explorerUrl: ctx.cfg.CHAIN_EXPLORER_URL ?? null,
      verifierVersion: VERIFIER_VERSION,
      reportSigningKeyFingerprint: await jwkFingerprint(ctx.reportKey.publicJwk),
      relayerAddress: ctx.registry.relayerAddress,
      voidApproverAddress: ctx.registry.voidApprover.address,
      appEnv: ctx.cfg.APP_ENV,
    });
  });

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_req, reply) => {
    const [db, chain, storage] = await Promise.all([
      ctx.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      ctx.registry.status(),
      ctx.store.healthy(),
    ]);
    const ready = db && chain.ok && storage;
    return reply.status(ready ? 200 : 503).send({ status: ready ? "ready" : "degraded", checks: { database: db, chain: chain.ok, storage } });
  });

  app.get("/v1/system/status", async (req) => {
    const [db, chain, jobs, alerts] = await Promise.all([
      ctx.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      ctx.registry.status(),
      ctx.prisma.anchorJob.groupBy({ by: ["state"], _count: true }).catch(() => []),
      ctx.prisma.systemAlert.count({ where: { state: "OPEN" } }).catch(() => -1),
    ]);
    return ok(req, {
      database: db,
      chain: { ok: chain.ok, chainId: chain.chainId ?? null, blockNumber: chain.blockNumber ?? null, error: chain.error ?? null, relayerFunded: chain.relayerBalanceWei ? BigInt(chain.relayerBalanceWei) > 0n : null },
      jobs: Object.fromEntries(jobs.map((j) => [j.state, j._count])),
      openAlerts: alerts,
      ai: ctx.cfg.AI_ENABLED === "true" && !!ctx.cfg.AI_API_KEY ? "configured" : "disabled",
      checkedAt: new Date().toISOString(),
    });
  });
}
