import { loadConfig } from "../src/lib/config";

try {
  const cfg = loadConfig();
  console.log(`environment OK: APP_ENV=${cfg.APP_ENV} chain=${cfg.CHAIN_ID} registry=${cfg.CHAIN_REGISTRY_ADDRESS}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
