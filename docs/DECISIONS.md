# Decision records

Deviations from, or resolutions of, the PRD. Each one says what changed and why.

## D-01 Postgres-backed job queue instead of Redis/BullMQ
The PRD stack lists Redis + BullMQ. The worker instead claims rows from `anchor_jobs` with `FOR UPDATE SKIP LOCKED`. The PRD already requires that table with a unique `event_key`, so exactly-once effects come from the same table that would back BullMQ anyway, and one fewer stateful service has to be backed up. Jobs back off from 5 seconds to a 5-minute cap over 10 attempts (about 25 minutes, enough to ride out a public RPC rate limit), then move to `DEAD` with a `system_alerts` row. Operators retry from the Security page's chain queue. Claims take a Postgres advisory lock and skip work while another job holds a live lease, so the queue is single-flight across any number of worker processes: only one transaction from the relayer key is ever in flight, which rules out nonce races. A transaction that is pending or short of confirmations is waited on, never re-broadcast, and waiting doesn't consume retries. If a hash is lost (crash, timeout), the worker recovers the transaction from the registry's event log.

## D-02 Filesystem object store behind an interface
Evidence, PDFs and packets go through `ObjectStore` (`apps/api/src/lib/storage.ts`). The shipped implementation writes private files (mode 600) under random 40-hex keys. An S3/MinIO implementation is a drop-in replacement and isn't written yet. Evidence is streamed through authenticated, audited API routes instead of presigned URLs, so no object URL is ever exposed.

## D-03 Worker lives in the API package
`apps/worker` from the PRD layout is `apps/api/src/worker.ts` plus `worker-main.ts`. It shares the context, vaults and registry client, and avoids a third package with duplicated wiring.

## D-04 `domain` includes evaluation and the packet verifier
`packages/evaluation` and `packages/report` are folded into `packages/domain` (evaluation, packet schema, verifier) and `apps/api/src/lib/report.ts` (PDF/CSV/ZIP rendering). The verifier is shared by the browser and the CLI so there is exactly one implementation to audit.

## D-05 Signature format is IEEE P1363, not DER
WebCrypto produces 64-byte `r||s`. The envelope's `signatureFormat` is `P256_SHA256_P1363` and the server rejects anything else. The PRD allows either if normalized at the boundary.

## D-06 Canonicalization restricted to integers
RFC 8785 permits floats. No BlindCount signed schema contains one, so the canonicalizer rejects non-integers. That removes the riskiest cross-runtime divergence. Test vectors are checked against Foundry's `cast` encoder, which is independent of our viem-based code.

## D-07 `voidAssignment` takes the approver address explicitly
The PRD interface signature is `voidAssignment(cohort, assignment, reason, sig)`. The contract adds an explicit `approver` argument and verifies an EIP-712 signature bound to that approver's current nonce, which makes replay protection and "approver ≠ caller" checks straightforward. In P0 the approver key is held by the server and used only after a second person approves in the app. Both identities are in the audit trail. This is disclosed on the Security page.

## D-08 Corrections are appended versions, anchored even after closure
Review happens after closure, so a correction has to be anchorable then. The registry accepts version 2+ for an anchored assignment while the cohort is frozen or closed, and only version 1 while it collects. A correction never changes the original commitment, the terminal count or the closed status (Foundry `test_correctionAfterCloseKeepsOriginalAndClosedStatus`). The auditor signs the new version on the device, linked to the previous one by `previousSubmissionId`. It is re-evaluated deterministically, and the reviewer either accepts it or keeps the original. Reports show both counts and outcomes, and the verifier requires the packet to carry exactly the versions the registry holds.

## D-09 Creator of an organization is owner, manager and custodian
Small programmes need one person who can run the cohort and hold the criterion. Separation of duties is enforced per action: a cohort manager can't be an auditor on their own cohort, an auditor can't review their own submission, and the criterion author can't be the sole reviewer of a disputed outcome.

## D-10 Offline evidence ids are client-proposed UUIDs
For a phone to sign a payload offline, the payload must reference evidence ids before upload. The client proposes a v4 UUID (`X-Evidence-Id`), and the server enforces uniqueness, ownership and SHA-256 at upload and again at submission.

## D-11 No amber in the interface
"Pending / needs review" uses slate blue (`#34557A`) instead of the PRD's amber warning token, per the product owner's design direction. Every status also carries an icon and literal text.

## D-12 Ethereum Sepolia instead of Base Sepolia
The PRD names Base Sepolia as the demo chain and makes the network configurable. We deployed to Ethereum Sepolia, the most widely recognised public testnet with a mature explorer and Sourcify verification. Every commitment is bound to the chain id and registry address, so moving networks is a redeploy plus configuration.

## D-13 The research figures are reproduced, not just cited
`data/research/reproduce.py` downloads the authors' CC0 dataset, pins its SHA-256 and recomputes the contrast their Stata script uses. It gets 24.8 points with the threshold shown and 11.2 with it concealed (407 farms), matching the published ~25% and ~11%. Only the script and the aggregate results are committed; the raw rows stay out of the repository.

## D-14 Verification needs pinned trust anchors
A packet is internally self-consistent by construction, so on its own it can't prove who issued it. The verifier reports VERIFIED_INTEGRITY only when the issuer's registry address and report-signing key fingerprint are supplied and match. The web verifier prefills them from the hosting deployment, and the CLI takes `--registry` and `--trusted-key`.
