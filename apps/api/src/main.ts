import { buildApp, createContext } from "./app";
import { startWorker } from "./worker";

const ctx = await createContext();
const app = await buildApp(ctx);
const stopWorker = ctx.cfg.RUN_WORKER_IN_PROCESS === "true" ? startWorker(ctx, (m) => app.log.warn(m)) : null;

const shutdown = async () => {
  await stopWorker?.();
  await app.close();
  await ctx.prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: ctx.cfg.PORT, host: "0.0.0.0" });
