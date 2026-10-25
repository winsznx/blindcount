import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "testnet", "production"]).default("local"),
  PORT: z.coerce.number().int().default(4000),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  ENVELOPE_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "base64 32 bytes"),
  CRITERION_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "base64 32 bytes"),
  REPORT_SIGNING_JWK: z.string().min(10),
  STORAGE_DIR: z.string().default("../../storage"),
  CHAIN_ID: z.coerce.number().int(),
  CHAIN_NAME: z.string().default("Anvil (local)"),
  CHAIN_RPC_URL: z.string().url(),
  CHAIN_PUBLIC_RPC_HINT: z.string().optional(),
  CHAIN_EXPLORER_URL: z.string().optional(),
  CHAIN_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  CHAIN_RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  CHAIN_VOID_APPROVER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  CHAIN_CONFIRMATIONS: z.coerce.number().int().min(1).default(1),
  CHAIN_REGISTRY_DEPLOY_BLOCK: z.coerce.number().int().min(0).default(0),
  AI_ENABLED: z.enum(["true", "false"]).default("false"),
  AI_PROVIDER: z.enum(["anthropic", "gateway"]).default("anthropic"),
  AI_GATEWAY_URL: z.string().default("https://ai-gateway.vercel.sh/v1/chat/completions"),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_API_KEY: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  EMAIL_FROM: z.string().default("BlindCount <onboarding@resend.dev>"),
  RESEND_API_KEY: z.string().optional(),
  RUN_WORKER_IN_PROCESS: z.enum(["true", "false"]).default("true"),
  LOG_LEVEL: z.string().default("info"),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${missing}`);
  }
  if (parsed.data.EMAIL_PROVIDER === "resend" && !parsed.data.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER=resend needs RESEND_API_KEY");
  if (parsed.data.CHAIN_RELAYER_PRIVATE_KEY === parsed.data.CHAIN_VOID_APPROVER_PRIVATE_KEY) {
    throw new Error("CHAIN_VOID_APPROVER_PRIVATE_KEY must differ from the relayer key");
  }
  return parsed.data;
}
