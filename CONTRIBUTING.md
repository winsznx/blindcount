# Contributing

## Setup

Requirements: Node 24 (`.nvmrc`), pnpm 12, Docker, Foundry.

```bash
pnpm install          # also provides OpenZeppelin and forge-std for the contracts
pnpm setup:local      # Postgres, migrations, Anvil, registry deploy, .env
pnpm dev
```

## Before you open a pull request

```bash
pnpm typecheck
pnpm contracts:test
pnpm test             # needs Postgres (blindcount_test) and Anvil with the registry deployed
pnpm test:e2e         # Playwright; builds the web app against a dedicated API port
```

## Rules that keep the product honest

- Never add a field to `auditorProjection` (`apps/api/src/routes/projections.ts`) without a test proving it can't carry the criterion or an outcome. The leak tests in `apps/api/test/e2e-flow.test.ts` and `e2e/tests/canonical-story.spec.ts` must keep passing.
- Signed payloads are canonicalized with `@blindcount/crypto`. Don't hash JSON any other way.
- Sealed records are append-only at the database level. Corrections are new versions, never updates.
- UI copy says what was checked and nothing more. Use "sealed", "verified" or "approved" only for states the server or chain has confirmed.
- AI output is advisory. It never sets an outcome, and it never receives the criterion, count or outcome.

## Style

TypeScript strict mode, named exports, kebab-case file names. Comments explain why, not what. See `docs/ARCHITECTURE.md` for where things live and `docs/DECISIONS.md` before changing a stack choice.
