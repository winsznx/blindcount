import { createContext } from "./app";
import { startWorker } from "./worker";

const ctx = await createContext();
const stop = startWorker(ctx, (m) => console.error(m));
console.error("blindcount worker started");
const shutdown = async () => {
  await stop();
  await ctx.prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
