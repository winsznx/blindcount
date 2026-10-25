import { defineConfig, devices } from "@playwright/test";

const E2E_DB = "postgresql://blindcount:blindcount@localhost:5433/blindcount_e2e";
const env = { DATABASE_URL: E2E_DB, STORAGE_DIR: "../../storage-e2e", PORT: "4100", WEB_URL: "http://localhost:3100", CORS_ALLOWED_ORIGINS: "http://localhost:3100" };

export default defineConfig({
  testDir: "./tests",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "pnpm --filter @blindcount/api start", env, url: "http://localhost:4100/health/live", reuseExistingServer: false, timeout: 60_000 },
    // Next.js rewrites are resolved at build time, so the web app is built against the e2e API port.
    { command: "pnpm --filter @blindcount/web build && pnpm --filter @blindcount/web start -p 3100", env: { API_INTERNAL_URL: "http://127.0.0.1:4100", NEXT_TELEMETRY_DISABLED: "1" }, url: "http://localhost:3100", reuseExistingServer: false, timeout: 240_000 },
  ],
});
