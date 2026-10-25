#!/usr/bin/env bash
# One-command local setup: Postgres, migrations, local chain, registry deploy and a .env
# with freshly generated secrets. Secrets are written to .env (mode 600), never printed.
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v anvil >/dev/null || { echo "Foundry is required (https://getfoundry.sh)"; exit 1; }
docker compose -f infra/compose/docker-compose.yml up -d db
until docker exec compose-db-1 pg_isready -U blindcount >/dev/null 2>&1; do sleep 1; done

if ! cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
  nohup anvil --chain-id 31337 --port 8545 --silent >/dev/null 2>&1 &
  sleep 2
fi

if [ ! -f .env ]; then
  tmp=$(mktemp)
  rm -f "$tmp"
  (cd apps/api && npx tsx scripts/generate-keys.ts "$tmp")
  {
    echo "# Local development only. Anvil account #0 is a public dev key; never use it on a real network."
    sed -n '1,200p' .env.example | grep -E '^(NODE_ENV|APP_ENV|PORT|WEB_URL|CORS_ALLOWED_ORIGINS|DATABASE_URL|STORAGE_DIR|CHAIN_ID|CHAIN_NAME|CHAIN_RPC_URL|CHAIN_PUBLIC_RPC_HINT|CHAIN_CONFIRMATIONS|AI_ENABLED|RUN_WORKER_IN_PROCESS)='
    echo "CHAIN_RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    cat "$tmp"
  } > .env
  chmod 600 .env
  rm -f "$tmp"
fi
cp .env packages/db/.env
pnpm db:migrate
if ! grep -q '^CHAIN_REGISTRY_ADDRESS=' .env; then
  addr=$(cd packages/contracts && pnpm -s deploy:local 2>/dev/null | tail -1 | python3 -c 'import json,sys;print(json.load(sys.stdin)["address"])')
  echo "CHAIN_REGISTRY_ADDRESS=$addr" >> .env
fi
pnpm --filter @blindcount/api check-env
echo "Local setup complete. Run: pnpm dev   (web http://localhost:3000, api http://localhost:4000)"
