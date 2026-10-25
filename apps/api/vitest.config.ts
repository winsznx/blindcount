import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const base = parseEnv(readFileSync(new URL("../../.env", import.meta.url), "utf8"));
// TEST_CHAIN=testnet runs the same suite against the deployed Sepolia registry instead of Anvil.
const testnet = process.env.TEST_CHAIN === "testnet";
if (testnet) Object.assign(base, parseEnv(readFileSync(new URL("../../.env.testnet", import.meta.url), "utf8")));

export default defineConfig({
  test: {
    testTimeout: testnet ? 1_200_000 : 60_000,
    hookTimeout: testnet ? 300_000 : 60_000,
    env: {
      ...base,
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://blindcount:blindcount@localhost:5433/blindcount_test",
      STORAGE_DIR: "../../storage-test",
    },
  },
});
