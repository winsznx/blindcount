import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const E2E_DB = "postgresql://blindcount:blindcount@localhost:5433/blindcount_e2e";
// FILM_CHAIN=testnet records the story against the live Ethereum Sepolia registry for the demo film.
const testnetChain: Record<string, string> =
  process.env.FILM_CHAIN === "testnet"
    ? Object.fromEntries(
        readFileSync(new URL("../.env.testnet", import.meta.url), "utf8")
          .split("\n")
          .filter((l) => /^CHAIN_[A-Z_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      )
    : {};
const env = { DATABASE_URL: E2E_DB, STORAGE_DIR: "../../storage-e2e", PORT: "4100", WEB_URL: "http://localhost:3100", CORS_ALLOWED_ORIGINS: "http://localhost:3100", ...testnetChain };

export default defineConfig({
  testDir: "./tests",
  timeout: process.env.FILM_CHAIN ? 1_800_000 : 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 60_000, navigationTimeout: 60_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "pnpm --filter @blindcount/api start", env, url: "http://localhost:4100/health/live", reuseExistingServer: false, timeout: 60_000 },
    // Next.js rewrites are resolved at build time, so the web app is built against the e2e API port.
    { command: "pnpm --filter @blindcount/web build && pnpm --filter @blindcount/web start -p 3100", env: { API_INTERNAL_URL: "http://127.0.0.1:4100", NEXT_TELEMETRY_DISABLED: "1" }, url: "http://localhost:3100", reuseExistingServer: false, timeout: 240_000 },
  ],
});
