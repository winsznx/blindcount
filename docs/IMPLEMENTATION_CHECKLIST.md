# Implementation checklist (PRD v1.0)

**Done** means implemented and covered by an automated test. **Done (manual)** means implemented and exercised in the running app, without a dedicated assertion. **Needs input** means the code is complete and waits on a credential only the operator can provide.

Test locations: `C` contracts, `X` crypto, `D` domain, `A` API integration (live Postgres + chain; also passes against Ethereum Sepolia), `L` CLI, `E` Playwright.

## P0 release gate (PRD 19.4)

| Gate | Status | Evidence |
|---|---|---|
| Public testnet registry deployed and documented | Done | Ethereum Sepolia `0x4f38…e8e1`, Sourcify exact match, [DEPLOYMENTS.md](DEPLOYMENTS.md) |
| Criterion and roster frozen without auditor exposure | Done | A, E (network capture + HTML scan) |
| Real form, real uploads, signed payload, server receipt | Done | A, E (phone viewport) |
| Relayer anchors; real tx shown and independently checked | Done | A on Sepolia; verifier reads the receipt and registry |
| Incomplete cohort blocks closure and reveal | Done | A, E, C |
| Complete cohort closes, discloses only to authorised roles, evaluates deterministically | Done | A, E, D |
| Reviewer decides; PDF/CSV/ZIP export | Done | A, E |
| Standalone verifier passes a valid ZIP and fails an altered one | Done | A, L, E |
| Judge-reachable routes exercised in a live browser | Done | E covers the full story, offline, corrections, and every public page |
| No overclaiming | Done | [CLAIM_LEDGER.md](CLAIM_LEDGER.md) |
| Demo data labelled; research cited and reproduced | Done | Programme `dataSource`, PDF banner, manifest `sourceType`; `data/research/reproduce.py` |
| Backups, logs, abuse cases; no secrets committed | Done | `pnpm backup:verify`; log redaction of tokens; `.gitignore`; CI secret scan |
| README and one-command local setup | Done | `pnpm setup:local` |
| 3–5 minute film | In progress | Script in [DEMO.md](DEMO.md) |

## Functional requirements

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-001 | Email sign-in, sessions, sign out | Done | A, E |
| FR-002 | Multi-tenancy | Done | A |
| FR-003 | One-use, 7-day, email-bound invitations | Done | A |
| FR-004 | Server-side permission matrix | Done | D, A |
| FR-005 | Device key registration and revocation | Done | A (revoked key refused) |
| FR-006 | Step-up re-authentication | Done (manual) | Disclose, decisions, void approval, privileged invites, member removal |
| FR-007 | Revocation applies immediately | Done | A |
| FR-008 | Audit export CSV | Done (manual) | Security page |
| FR-010 | Programme CRUD | Done | A, E |
| FR-011 | Cohort editor with encrypted target | Done | A, E |
| FR-012 | Pseudonymous farms, duplicates rejected | Done | A |
| FR-013 | Blind preview | Done | A, E |
| FR-014 | Freeze roster; publish needs assignments and chain success | Done | A |
| FR-015 | Target commitment matches chain | Done | A, verifier |
| FR-016 | Published cohort immutable | Done | A, DB trigger |
| FR-017 | Only the designated auditor submits | Done | A |
| FR-018 | Void with reason and two distinct approvers | Done | C (onchain second signer), API checks, real reasons collected in UI |
| FR-021 | Mobile field form | Done | E |
| FR-022 | Criterion never displayed to auditors | Done | A, E |
| FR-023 | Review before finalize | Done | E |
| FR-024 | One-way finalization | Done | A |
| FR-025 | Media hash verification | Done | A |
| FR-026 | Idempotent receipts | Done | A |
| FR-027 | Distinct local, received, anchoring, sealed, failed states | Done | E |
| FR-028 | Device-signed offline finalization | Done | E (offline) |
| FR-029 | Offline drafts and queued sync | Done | E: offline finalize, tab closed, automatic upload on reconnect |
| FR-033 | Progress dashboard | Done | E |
| FR-034 | Close only when all terminal | Done | A, E, C |
| FR-035 | Controlled disclosure | Done | A, E |
| FR-036 | Deterministic comparison | Done | D, A |
| FR-037 | Approve or dispute, no self-approval | Done | A |
| FR-038 | Evidence flags with explanation and labels | Done (manual) | Review desk |
| FR-039 | Amendment chain preserves the first count | Done | C, A, E |
| FR-040 | Review queue | Done | E |
| FR-041 | Dual control on outcome changes | Done | Criterion author can't decide; reviewer chooses accept-correction or keep-original explicitly |
| FR-042 | Dispute and correction workflow | Done | A, E |
| FR-043 | PDF and CSV | Done | A (original and accepted counts) |
| FR-044 | Portable ZIP | Done | A, L, E |
| FR-045 | `/verify` with FAIL and UNKNOWN | Done | A, E |
| FR-046 | Security labels | Done | |
| FR-047 | Target only after disclosure | Done | |
| FR-048 | AI evidence review with explicit uncertainty | Needs input | Adapter, prompt, schema and quotas implemented; needs `AI_API_KEY` |
| FR-049 | Duplicate and metadata checks | Done (manual) | Job after every anchor |
| FR-050 | AI failure fallback | Done | A |
| FR-051 | Aggregate metrics | Done (manual) | Overview |
| FR-052 | Independent CLI | Done | L |
| FR-054 | Structured audit trail | Done | Append-only trigger |
| FR-055 | Anchor retries and dead-letter queue | Done (manual) | Chain queue with retry; single-flight; event recovery |
| FR-056 | Health probes | Done | A |
| FR-057 | Validation with field errors | Done | A |
| FR-059 | Backup and restore drill | Done | `pnpm backup:verify` |
| Email delivery | Real inboxes for codes and invitations | Needs input | Resend adapter implemented; needs `RESEND_API_KEY` |

## Roadmap after the hackathon

French field UI (FR-032), resumable uploads (FR-030), location opt-in (FR-031), cohort cloning (FR-019), retention purge jobs (FR-058), consent event workflow (FR-060), customer-managed keys (FR-062), KoboToolbox/ODK import, Merkle-root rosters for scale.
