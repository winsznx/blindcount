import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export default function globalSetup() {
  const url = "postgresql://blindcount:blindcount@localhost:5433/blindcount_e2e";
  execSync("npx prisma migrate reset --force --skip-seed", { cwd: "../packages/db", env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  rmSync("../storage-e2e", { recursive: true, force: true });
}
