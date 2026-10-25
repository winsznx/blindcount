# Runbook

## Local services
- `pnpm setup:local` brings up Postgres (port 5433), Anvil (8545), migrations, the registry and `.env`.
- `pnpm dev` runs the API (4000, with an in-process worker) and web (3000).
- Test databases: `blindcount_test` (API integration) and `blindcount_e2e` (Playwright, reset automatically).

## Deploying the registry (Ethereum Sepolia)
The current deployment is recorded in [DEPLOYMENTS.md](DEPLOYMENTS.md). To deploy again:
1. In `.env.testnet` set `CHAIN_ID=11155111`, `CHAIN_RPC_URL`, `CHAIN_RELAYER_PRIVATE_KEY`, `CHAIN_VOID_APPROVER_PRIVATE_KEY`, and optionally `CHAIN_DEPLOYER_PRIVATE_KEY` and `CHAIN_ADMIN_ADDRESS` (use a multisig for admin in production).
2. Fund the relayer with Sepolia ETH.
3. `pnpm contracts:deploy:testnet`. It prints JSON with the address, deploy block and every role grant.
4. Verify the source: `forge verify-contract <address> src/BlindCountRegistryV1.sol:BlindCountRegistryV1 --chain 11155111 --verifier sourcify --constructor-args $(cast abi-encode "constructor(address)" <admin>)`.
5. Set `CHAIN_REGISTRY_ADDRESS`, `CHAIN_REGISTRY_DEPLOY_BLOCK`, `CHAIN_EXPLORER_URL=https://sepolia.etherscan.io`, `CHAIN_PUBLIC_RPC_HINT` and `CHAIN_CONFIRMATIONS=3` in the API environment.
6. Run the full integration suite against it: `TEST_CHAIN=testnet pnpm --filter @blindcount/api test`.

## Production API
`docker compose -f infra/compose/docker-compose.yml --profile app up -d --build` runs migrate, api and worker. Put TLS and a reverse proxy in front. Keep Postgres private.

## Incidents
- **Anchoring stuck:** open Security → Chain queue. `Retrying` jobs back off for up to about 25 minutes; `Stopped` jobs have a `system_alerts` row. After fixing the cause (RPC, relayer gas), press Retry now. The worker settles any transaction it already sent and reads chain state before acting, so a retry never double-anchors.
- **Commitment mismatch alert (critical):** an onchain commitment differs from the DB. Don't retry. Freeze the cohort (pause the registry from the pauser key), preserve DB and chain evidence, and investigate.
- **Reorg:** closure re-checks that every anchor block is still canonical and blocks with `REORG_PENDING` if not.
- **Credential compromise:** remove the member (revokes devices), rotate `SESSION_SECRET` to drop all sessions, pause the registry if relayer keys are affected, rotate roles from the admin.
- **Lost salt / key:** never regenerate salts. Restore the vault keys and DB from backup.

## Backups
`pnpm backup:verify` dumps the database, restores it to a scratch database, compares row counts and sealed payload digests, and re-hashes every evidence object. Run it daily and copy `storage/backups` and `storage/objects` offsite, encrypted. Vault keys must be backed up separately from data.
