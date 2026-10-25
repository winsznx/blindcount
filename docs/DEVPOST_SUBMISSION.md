# Devpost submission (paste-ready)

Platform: Devpost, IEEE ClimateChain Global Hackathon. Fill each Devpost field with the matching block below.

---

## Project name

BlindCount

## Elevator pitch (max ~200 characters)

Field inspections that hide the pass mark from the inspector, seal the first count on-chain, and give buyers a proof packet anyone can verify. Count first. Compare later.

## Which track / category

Sustainable Supply Chains

---

## Project story (the main description field)

### Inspiration

Cocoa sustainability programmes pay for shade trees, and buyers make public claims based on field counts. The people doing those counts usually know the minimum a farm needs to pass. A 2026 randomized study of 407 cocoa farms in Côte d'Ivoire (Cammelli, Six and Garrett; Dryad doi:10.5061/dryad.v9s4mw77q) found that verifiers who could see the threshold amended failing counts far more often. We downloaded the authors' public data and reproduced their headline result: 24.8 points of excess amendments with the threshold shown, 11.2 with it concealed. The fix is a design change software can enforce. Don't let the person counting see the number that decides the outcome, and preserve what they first reported.

### What it does

1. A programme manager sets a hidden minimum (for example, shade trees ≥ 15) for a cohort of farm visits. The value is encrypted with its own key and committed on-chain as a salted hash, so it can be proven later but not guessed now.
2. Each field auditor gets a phone form with no target, no score meter and no hint. They record the count and photos. The phone signs the observation with a key that never leaves the device, and it works offline.
3. The server verifies the signature and evidence digests, stores the first version append-only, and a relayer anchors a salted commitment on Ethereum Sepolia.
4. The cohort can't close, and the target can't be revealed, until every assignment is sealed or voided by two people. This is enforced by the API and by the smart contract, so revealing the threshold after the first audit can't compromise the others.
5. After on-chain closure, the criterion custodian discloses the target. Deterministic code evaluates each count, and a reviewer approves or disputes with a written reason. A correction is a new signed, anchored version; the original never changes.
6. A buyer or certifier verifies the proof packet in the browser or with an open-source CLI, without a BlindCount account. Change one digit in the packet and verification fails on the exact file.

Sealed records prove what was submitted. They don't prove a count was true, and BlindCount says so on every report.

### How we built it

- **Smart contract:** `BlindCountRegistryV1` (Solidity 0.8.24, OpenZeppelin 5.1 AccessControlDefaultAdminRules, Pausable, EIP-712), live on Ethereum Sepolia at `0x4f38eabf65725d38b4c04410c04318869ae3e8e1`, source verified on Sourcify (exact match). Separate roles for publishing, anchoring, closing, voiding and pausing; voids need a second signer. It stores only opaque keys and salted commitments, never counts, targets or personal data. 28 Foundry tests cover every adversarial case, fuzzing, and commitment vectors shared with the TypeScript code. Slither and Aderyn report no high or medium issues.
- **Cryptography:** RFC 8785 canonical JSON, SHA-256, domain-separated keccak commitments bound to chain id and registry address, WebCrypto P-256 device signatures. The commitment encoding is checked against Foundry's independent ABI encoder.
- **Backend:** Fastify + PostgreSQL (Prisma) with database triggers that refuse edits to sealed records, a Postgres job queue that reads chain state before every retry so nothing is anchored twice, and a role model with separation of duties.
- **Frontend:** Next.js PWA. Mobile-first field form with encrypted offline drafts, manager and reviewer workspaces, and an in-browser verifier.
- **Tests:** contract, crypto, domain, CLI, an API integration suite that runs the whole story against the live Sepolia contract, and a Playwright test with four browser users covering offline work, corrections and tamper detection.
- **Independent review:** before submitting, four reviewers audited the contracts and cryptography, authentication, the chain pipeline and the web app separately. Every finding was fixed and tested.

### How AI is used

AI is an advisory evidence-quality check (blur, darkness, irrelevant scene, possible reuse) that never receives the criterion, the count or the outcome, can't set an outcome, and is labelled as a suggestion. Deterministic checks (duplicate photo digests across farms, clock inconsistencies) run on every submission. BlindCount does not claim a model can count trees from a few photos.

### Challenges we ran into

- Making the reveal per cohort instead of per form, in both the database and the contract, and letting the verifier prove it from the chain.
- Supporting corrections after closure without ever rewriting the original. Corrections are appended, signed versions, and the contract guarantees the closed history can't change.
- Letting a phone sign offline before photos are uploaded (the client proposes evidence ids that the server then checks).
- Never saying "sealed" or "verified" one step too early, including when the chain is slow or the verifier has no RPC.

### Accomplishments we're proud of

- The reveal unit is the cohort, enforced on-chain. `closeCohort` reverts unless every registered assignment is anchored or voided, and disclosure is only possible after that.
- The whole story runs against the live Sepolia contract in CI, not a mock.
- Verification trusts nothing BlindCount serves. The same verifier runs in the browser and a CLI, pins the issuer, and reads the chain through an RPC the verifier chooses.
- We reproduced the published study's headline figures from its own public data.

### What we learned

An integrity system earns trust by being precise about what it does and does not prove. A sealed record proves what was submitted, by which enrolled device, and that it was anchored before the criterion was disclosed. Whether the trees are really there is the reviewer's call, and every report says so. Overclaiming would undermine everything else.

### What's next

A field pilot with a cooperative or monitoring provider on one crop and region, French field screens for Côte d'Ivoire, KoboToolbox/ODK import, Merkle-root rosters for very large cohorts, and customer-managed keys.

---

## Built with (technology tags)

typescript, next.js, react, fastify, node.js, postgresql, prisma, solidity, foundry, openzeppelin, ethereum, ethers.js, web-crypto, docker, caddy, playwright, vercel

## Try it out (links)

- Live app: https://blindcount.xyz
- Source (MIT): https://github.com/winsznx/blindcount
- Live registry on Sepolia: https://sepolia.etherscan.io/address/0x4f38eabf65725d38b4c04410c04318869ae3e8e1

## Video demo

[YouTube link — paste after upload]

## What's real in the demo

A real app, real device signatures, real Ethereum Sepolia transactions and real independent verification. The demo farms are simulated and labelled as such on screen; the research evidence comes from the published study's own data.
