# Security

BlindCount exists to keep two promises: a field auditor never sees the threshold that decides a farm's outcome until the whole cohort is closed, and the first count they record can't be changed without anyone noticing. This file covers what is deployed, who can do what, each invariant with the test that enforces it, the independent reviews and static analysis behind it, and the trust boundaries.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting on this repository, not in a public issue. Include the file or contract, steps or a proof of concept, and the impact.

## What is deployed

`BlindCountRegistryV1` on Ethereum Sepolia (chain id 11155111) at [`0x4f38eabf65725d38b4c04410c04318869ae3e8e1`](https://sepolia.etherscan.io/address/0x4f38eabf65725d38b4c04410c04318869ae3e8e1), deployed in block 11,987,080. The source is verified on Sourcify with an exact match for creation and runtime bytecode. The contract is not upgradeable and holds no funds or tokens. Full transaction list: [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md).

## Who can do what

| Actor | Can | Cannot |
|---|---|---|
| Field auditor | Record and sign observations for their own assignments; sign a correction when a reviewer requests one | See the criterion, any outcome, other auditors' visits; edit a submitted version |
| Manager | Create programmes and cohorts, commit a hidden criterion, build and publish the roster, request voids, close a cohort | Audit their own cohort; decide review outcomes for a criterion they set; invite themselves |
| Criterion custodian | Disclose the criterion after onchain closure, with a fresh sign-in | Disclose before the registry has closed the cohort |
| Reviewer | Decide approve, accept correction, keep original, dispute or request correction; label evidence flags | Review their own submission; change any count |
| Owner | Invite any role (with fresh sign-in), remove members, retry chain jobs | Bypass any of the above |
| Relayer key | Publish cohorts, anchor commitments, close, record disclosure | Anchor a first observation after closure; anchor out of order; void an anchored assignment; void without a second approver's EIP-712 signature |
| Anyone with a packet | Verify it in the browser or CLI against their own RPC | Learn anything from the chain beyond opaque keys and salted commitments |

## Invariants and their tests

| PRD | Invariant | Enforced by | Test |
|---|---|---|---|
| INV-01 | No auditor-facing response contains the criterion, its salt or an outcome while it matters | `auditorProjection` allowlist; criterion encrypted under its own key | `apps/api/test/e2e-flow.test.ts` "never sent the criterion…" scans every auditor response; Playwright captures the auditors' network traffic and page HTML |
| INV-02 | Roster and target commitment frozen before auditors get access | Publish transaction + `freezeRoster`; DB trigger locks the criterion | API test "publishes the cohort…" (423/409 on edits after publish) |
| INV-03 | Only the enrolled auditor finalizes their assignment | Ownership check + P-256 signature against a registered, unrevoked key | API test "rejects a revoked device key…"; tampered signature → 422 |
| INV-04 | Exactly one first version per assignment | Row lock, unique `(observation, version)`, contract `NonContiguousVersion` | API test: 8 concurrent submits → one version, one anchor; Foundry cases 5–6 |
| INV-05 | A submitted version is never edited | Append-only DB trigger; PATCH always 409; corrections are new versions | API test: direct `UPDATE` rejected by the database |
| INV-06 | Every commitment is salted, domain-separated and chain-bound | `packages/crypto`; 32-byte CSPRNG salts | `crypto.test.ts` brute-force test; `CommitmentVectors.t.sol` matches the TypeScript encoding byte for byte |
| INV-07 | No disclosure while any assignment is unresolved | DB terminal check + onchain `terminal == expected`; disclose requires `CLOSED` | API and Playwright D3 tests; Foundry cases 9–12 |
| INV-09 | Only confirmed onchain state yields SEALED or CLOSED | Worker reads the registry back before recording; rejects replacement receipts | Worker code path covered by every anchoring test |
| INV-10 | AI can't decide outcomes | AI output is advisory and schema-limited; outcomes come only from `evaluate()` | API test: AI unavailable, review still completes |
| INV-11 | The verifier checks the chain itself and can say "unknown" | Shared `verifyPacket` in browser and CLI; issuer pinning | API test: unreachable RPC → VALID_LOCAL_ONLY, unpinned issuer → UNABLE_TO_VERIFY |
| INV-12 | Stored, exported and verified media digests match | SHA-256 at upload, at submission and in the packet | API test: altered evidence → INVALID |
| INV-13 | Tenant isolation | Every route resolves the resource's organization and checks live membership | API test: cross-tenant reads → 404 |
| INV-14 | Membership changes apply immediately | Live membership check per request; revoke cancels pending invitations | API test: revoked member → 404 on the next request |
| INV-15 | No one alters and approves alone | Criterion author can't decide outcomes; auditor can't review own work; void needs two people onchain | API test self-review → 404; Foundry void tests |
| INV-16 | Nothing identifying goes onchain | Contract stores only opaque keys and salted commitments | Contract interface; `test_noTargetDataInRoleOrEvents` |
| INV-17 | Closure can't be bypassed | `CLOSER_ROLE`, terminal-count check, optional `closingAfter` | Foundry cases 9, 10, 13 |

The verifier also proves the product's central claim on its own: when a packet discloses the criterion, it checks onchain that the cohort was closed before the disclosure (`chainCanonicality`).

## Independent review

Before submission, four independent reviewers each audited one area of the codebase (contracts and cryptography; authentication and authorization; submission pipeline and chain worker; web app), working only from the code. They reported about 50 findings, and every one was fixed or closed with a test. The main fixes:

- Login codes: attempts are reserved atomically, and a per-email failure lockout applies across codes.
- A manager can no longer give themselves the reviewer role. Privileged invitations need a fresh sign-in.
- The verifier requires the issuer's registry and signing key before it says VERIFIED. It checks that the cohort closed onchain before disclosure, that versions are contiguous and complete, and it rejects ZIP-bomb and duplicate-entry archives.
- The chain worker never broadcasts while a transaction is pending, recovers lost hashes from contract events, rejects replacement receipts, and runs single-flight across processes.
- Offline photo storage keeps the bytes encrypted as binary and re-checks them against their SHA-256 before upload.

## Static analysis

Slither (117 detectors) reports 3 informational results. Aderyn reports 0 high and 2 low. Every result is assessed in [docs/STATIC_ANALYSIS.md](docs/STATIC_ANALYSIS.md).

## Trust boundaries

- The person who enters a criterion knows it. The guarantee is that auditors and unrelated reviewers can't obtain it through the product.
- The organization's report-signing key attests device enrollment. Verifiers pin that key and the registry address, both published at `/v1/system/chain-config`.
- Application encryption keys are held by the operator. Per-tenant customer-managed keys are on the roadmap.
- A valid packet proves what was submitted and when. Whether the field count is true is for reviewers, and the product says so on every report.
