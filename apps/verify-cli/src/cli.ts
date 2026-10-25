#!/usr/bin/env -S npx tsx
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PacketFormatError, rpcChainReader, unzipPacket, verifyPacket, type VerificationResult } from "@blindcount/domain";
import { EXIT, exitCodeFor } from "./exit";

function printText(r: VerificationResult) {
  const mark = { PASS: "PASS ", FAIL: "FAIL ", UNKNOWN: "UNKN ", SKIPPED: "SKIP " } as const;
  console.log(`BlindCount packet verification: ${r.integrity}`);
  console.log(`Evidence review state: ${r.reviewState}`);
  for (const c of r.checks) console.log(`  [${mark[c.status]}] ${c.name.padEnd(28)} ${c.detail}`);
  if (r.summary.reportSigningKeyFingerprint) console.log(`Report signing key fingerprint: ${r.summary.reportSigningKeyFingerprint}`);
  console.log(`\n${r.disclaimer}`);
}

async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        packet: { type: "string" },
        rpc: { type: "string" },
        output: { type: "string", default: "text" },
        "trusted-key": { type: "string" },
        registry: { type: "string" },
        help: { type: "boolean", default: false },
      },
    }).values;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return EXIT.MISUSE;
  }
  if (args.help || !args.packet || !["text", "json"].includes(args.output ?? "")) {
    console.error(
      "usage: blindcount-verify --packet <file.zip> --rpc <url> --registry <issuer registry> --trusted-key <issuer key fingerprint> [--output text|json]\n" +
        "The issuer publishes its registry and key fingerprint at /v1/system/chain-config. Without both, the result can't be VERIFIED.",
    );
    return args.help ? 0 : EXIT.MISUSE;
  }
  let files;
  try {
    files = unzipPacket(new Uint8Array(await readFile(args.packet)));
  } catch (e) {
    console.error(e instanceof PacketFormatError ? `invalid packet: ${e.message}` : `cannot read ${args.packet}`);
    return e instanceof PacketFormatError ? EXIT.INVALID : EXIT.MISUSE;
  }
  const result = await verifyPacket(files, { chain: args.rpc ? rpcChainReader(args.rpc) : null, trustedReportKeyFingerprint: args["trusted-key"], trustedRegistryAddress: args.registry });
  if (args.output === "json") console.log(JSON.stringify(result, null, 2));
  else printText(result);
  return exitCodeFor(result);
}

// This file is only ever an entry point, so it always runs; tests import ./exit instead.
try {
  process.exit(await main(process.argv.slice(2)));
} catch (e) {
  console.error(`blindcount-verify: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(EXIT.UNAVAILABLE);
}
