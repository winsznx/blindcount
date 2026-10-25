# Devpost submission draft

## Track

**Sustainable Supply Chains.** The track's problem statement is "difficult to verify ethical sourcing and sustainability claims." BlindCount targets the step every sourcing claim depends on: the field inspection that says a farm meets a programme requirement. It increases accountability by making the first inspection result tamper-evident and independently verifiable, and by removing the auditor's incentive to adjust the count toward a known pass mark.

## Tagline

Count first. Compare later. Blind field inspections with a sealed first observation and a proof packet anyone can verify.

## The problem

Cocoa sustainability programmes pay for and report on shade trees planted on farms. That reporting rests on field verifiers who count trees, and who usually know the minimum a farm needs to qualify. A 2026 randomized study of 407 cocoa farms in Côte d'Ivoire (Cammelli, Six and Garrett; Dryad doi:10.5061/dryad.v9s4mw77q) found that verifiers who could see the threshold amended failing counts far more often. We downloaded the authors' public data and reproduced their headline result: 24.8 points of excess amendments with the threshold shown, 11.2 with it concealed. The fix is a design change software can enforce: don't let the person counting see the number that decides the outcome, and preserve what they first reported.

Existing tools collect forms well (KoboToolbox and ODK already work offline). What they don't do is enforce a concealed criterion across a whole cohort of audits or hand a buyer a record they can check without trusting the programme's database.

## What BlindCount does

1. A programme manager sets a hidden minimum (for example, shade trees ≥ 15) for a cohort of farm visits. The value is encrypted with its own key and committed onchain as a salted hash, so it can be proven later but not guessed now.
2. Each field auditor gets a phone form with no target, no score meter and no hint. They record the count and photos. The phone signs the observation with a key that never leaves the device, and it works offline.
3. The server verifies the signature and evidence digests, stores the first version append-only, and a relayer anchors a salted commitment on an EVM testnet.
4. The cohort can't close, and the target can't be revealed, until every assignment is sealed or voided by two people. This is enforced by the API and by the smart contract: revealing the threshold after the first audit would compromise all the others.
5. After onchain closure, the criterion custodian discloses the target. Deterministic code evaluates each count, and a reviewer approves or disputes with a written reason. AI evidence checks are advisory and can't change an outcome.
6. The programme exports a PDF, a CSV row and a ZIP proof packet. A buyer or certifier verifies it in the browser or with an open-source CLI, without a BlindCount account. Change one digit in the packet and verification fails on the exact file.

Sealed records prove what was submitted. They don't prove a count was true, and BlindCount says so on every report.

## How we built it

- **Smart contract:** `BlindCountRegistryV1` (Solidity 0.8.24, OpenZeppelin 5.1 AccessControlDefaultAdminRules, Pausable, EIP-712), live on Ethereum Sepolia at `0x4f38eabf65725d38b4c04410c04318869ae3e8e1` with source verified on Sourcify. Separate roles for publishing, anchoring, closing, voiding and pausing; voids need a second signer. It stores only opaque keys and salted commitments, never counts, targets or personal data. 28 Foundry tests cover every adversarial case in our spec, fuzzing, and commitment vectors shared with the TypeScript code. Slither and Aderyn report no high or medium issues.
- **Cryptography:** RFC 8785 canonical JSON, SHA-256, domain-separated keccak commitments bound to chain id and registry address, WebCrypto P-256 device signatures. The commitment encoding is checked against Foundry's independent ABI encoder.
- **Backend:** Fastify + PostgreSQL (Prisma) with database triggers that refuse edits to sealed records, a Postgres job queue that reads chain state before every retry so nothing is anchored twice, and a role model with separation of duties.
- **Frontend:** Next.js PWA. Mobile-first field form with encrypted offline drafts, manager and reviewer workspaces, and an in-browser verifier.
- **Tests:** contract, crypto, domain, CLI, an API integration suite that runs the whole story against the live Sepolia contract, and a Playwright test with four browser users covering offline work, corrections and tamper detection.
- **Independent review:** before submitting, four reviewers audited the contracts and cryptography, authentication, the chain pipeline and the web app separately. Every finding was fixed and tested.

## AI

AI is used where it is honest: an advisory evidence-quality check (blur, darkness, irrelevant scene, possible reuse) that never receives the criterion, the count or the outcome, can't set an outcome, and is labelled as a suggestion. Deterministic checks (duplicate photo digests across farms, clock inconsistencies) run on every submission. BlindCount does not claim a model can count trees from a few photos.

## Who it's for and how it scales

Users: sustainability programme managers at cocoa exporters and cooperatives, independent monitoring providers, field verifiers on low-connectivity phones, and the buyers and certifiers who receive reports.

Adoption: BlindCount produces the same artefact teams already file (a field verification report), plus a packet that needs no account to check. It can sit beside an existing form tool. Onchain cost is one transaction per visit plus three per cohort. A Merkle-root roster would cut that further at scale. Nothing identifying goes onchain, so the public chain is safe to use for farm-level records.

Beyond cocoa: any programme where a field count decides eligibility (agroforestry payments, reforestation monitoring, deforestation-free sourcing checks under rules like the EU Deforestation Regulation) has the same weakness.

## Climate impact (stated carefully)

Shade trees in cocoa support biodiversity, soil health and farm resilience, and programmes and buyers make public claims based on how many were planted and survive. If the inspections behind those claims can be quietly adjusted, money and credibility flow to trees that may not exist. BlindCount makes those inspections harder to bias and easier to audit. We don't convert tree counts into carbon tonnes. That needs a validated methodology, and overclaiming is the problem we're addressing.

## What's real in the demo

A real app, real device signatures, real Ethereum Sepolia transactions and real independent verification. The demo farms are simulated and labelled as such on screen; the research evidence comes from the published study's own data.

## Challenges

- Making the reveal per cohort instead of per form, in both the database and the contract, and letting the verifier prove it from the chain.
- Supporting corrections after closure without ever rewriting the original: corrections are appended, signed versions, and the contract guarantees the closed history can't change.
- Letting a phone sign offline before photos are uploaded (the client proposes evidence ids that the server then checks).
- Never saying "sealed" or "verified" one step too early, including when the chain is slow or the verifier has no RPC.

## What's next

A field pilot with a cooperative or monitoring provider on one crop and region, French field screens for Côte d'Ivoire, KoboToolbox/ODK import, Merkle-root rosters for very large cohorts, and customer-managed keys.
