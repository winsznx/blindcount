# Claim ledger

Every claim BlindCount makes in the README, the website and the submission, with the evidence behind it. Checked on 25 October 2026 against the repository state in which all suites below passed.

| # | Claim | Evidence | How to check |
|---|---|---|---|
| C1 | The registry is live on Ethereum Sepolia with verified source | Address `0x4f38…e8e1`, block 11,987,080; Sourcify exact match | [DEPLOYMENTS.md](DEPLOYMENTS.md), Etherscan, Sourcify |
| C2 | The full story runs against the live Sepolia contract | Integration suite: 14/14 passed against chain 11155111 in 301 s, 8 relayer transactions | `TEST_CHAIN=testnet pnpm --filter @blindcount/api test` |
| C3 | Auditors never receive the criterion, its salt or an outcome | Every auditor response in the integration test is scanned; Playwright captures the auditors' network traffic and page HTML | `apps/api/test/e2e-flow.test.ts`, `e2e/tests/canonical-story.spec.ts` |
| C4 | The criterion can't be disclosed until the whole cohort is closed onchain | API refuses close with outstanding assignments (D3); contract `closeCohort` reverts unless all are terminal; disclose requires `CLOSED` | Foundry cases 9–12; API and Playwright D3 steps |
| C5 | The verifier checks that the criterion was disclosed after onchain closure | `chainCanonicality` reads the cohort state and fails a packet whose criterion appears while the cohort isn't closed | `packages/domain/src/packet.ts`; asserted in the API test |
| C6 | The first observation is signed on the device with a non-extractable key | WebCrypto P-256 key generated non-extractable and stored in IndexedDB | `apps/web/src/lib/device.ts`; Playwright signs from the browser |
| C7 | Submitted versions can't be edited | PATCH always 409; Postgres trigger refuses UPDATE and DELETE of submission content | API test runs a direct `UPDATE` and expects the trigger error |
| C8 | Concurrent submissions produce exactly one record | Row lock + unique constraints; 8 concurrent requests → 1 version, 1 anchor job | API test "concurrent identical-key…" |
| C9 | Commitments match across TypeScript and Solidity | The same vectors are asserted in both languages | `packages/crypto/test/crypto.test.ts`, `packages/contracts/test/CommitmentVectors.t.sol` |
| C10 | Small counts can't be guessed from the chain | 32-byte salts; brute force over candidate targets fails | `crypto.test.ts` |
| C11 | Changing one digit in a packet fails verification at the exact file | Tampered count → `observation-v1.json digest mismatch`; altered photo → INVALID | API test, CLI (exit 1), Playwright browser verifier |
| C12 | A repacked packet signed with another key fails | Issuer pinning (registry + report key) | API test "self-signed repack" |
| C13 | Without an RPC the verifier never shows a false green | No RPC or unreachable RPC → VALID_LOCAL_ONLY; unpinned issuer → UNABLE_TO_VERIFY | API test |
| C14 | Corrections are anchored after closure without changing the original | Contract appends v2 to a closed cohort; original commitment, terminal count and CLOSED state unchanged | Foundry `test_correctionAfterCloseKeepsOriginalAndClosedStatus`; API and Playwright correction flows |
| C15 | A packet that drops a correction fails | Verifier compares the packet's versions to the registry's `latestVersion` | API test "dropping the correction" |
| C16 | Field work survives going offline, including photos, and uploads by itself | Playwright: offline finalize with photo, tab closed, reconnect, new page, sealed onchain with no button pressed | `e2e/tests/canonical-story.spec.ts` (auditor B) |
| C17 | Separation of duties | Auditor can't review own work; criterion author can't decide outcomes; manager can't self-invite or audit own cohort; void needs two people onchain | API tests; Foundry void tests |
| C18 | Cross-tenant access is impossible | Every route resolves the organization server-side; non-members get 404 | API test |
| C19 | The study's 25% / 11% figures are reproduced from public data | 24.8 vs 11.2 points, 407 farms, pinned dataset digest | `python3 -I data/research/reproduce.py` → `data/research/results.json` |
| C20 | AI never sees the criterion, count or outcome, and can't decide | Adapter sends images only; outcomes come only from `evaluate()`; AI output schema bans fraud and count assertions | `apps/api/src/review-checks.ts`; API test for the unavailable path |
| C21 | Static analysis: no high or medium findings | Slither 3 informational, Aderyn 0 high / 2 low, each assessed | [STATIC_ANALYSIS.md](STATIC_ANALYSIS.md) |
| C22 | Backups restore with identical sealed records and evidence | Dump, restore, row counts, sealed digests and evidence hashes compared | `pnpm backup:verify` (PASS on data with sealed submissions) |
| C23 | Nothing identifying is written onchain | The contract stores only opaque keys and salted commitments | Contract interface; `test_noTargetDataInRoleOrEvents` |
| C24 | Independent review before submission | Four reviewers audited contracts/crypto, auth, pipeline and web; about 50 findings fixed or closed | [SECURITY.md](../SECURITY.md#independent-review) |

## Wording we don't use

"Certified", "fraud detected", "verified tree count" or any carbon figure. A packet proves what was submitted and when; reviewers judge whether it's true.
