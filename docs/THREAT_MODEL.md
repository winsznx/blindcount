# Threat model (P0)

Mapped to PRD 11.1 and 16.3. "Test" names the automated test that exercises the defence.

| Threat | Defence | Test |
|---|---|---|
| Target exposed to auditors via API, SSR or bundle | Auditor data comes only from `auditorProjection` (an explicit allowlist). Criteria are encrypted with a separate key and never selected outside custodian/report paths. All app pages are client-rendered from scoped APIs, so there's no SSR hydration of manager data | `e2e-flow.test.ts` "never sent the criterion…" scans every auditor response; Playwright captures auditor network traffic and page HTML |
| Guessing the target from the onchain commitment | 32-byte CSPRNG salt, domain separation, chain id and registry address in the preimage | `crypto.test.ts` brute-force over 200 candidates |
| Tampering after sealing | Signed canonical payload, salted commitment onchain, DB triggers refuse UPDATE/DELETE of submission content | Direct `UPDATE` rejected in `e2e-flow.test.ts`; altered packet → INVALID (API test, CLI, browser) |
| Double submit / replay | Idempotency key unique per org, row lock on the assignment, unique version per observation, unique client nonce, contract rejects a second version 1 | 8 concurrent submits → exactly one version and one anchor job; Foundry tests 5–6 |
| Early reveal / admin bypass | Close requires DB terminal state AND onchain `terminal == expected`. Disclosure requires the `CLOSED` state (set only after the close tx confirms), the CUSTODIAN role and fresh auth | D3 tests (API and Playwright); Foundry tests 9–12 |
| Offline backdating | Device-claimed time and server receipt time are stored separately; UI never calls device time independent | Receipt timeline copy; review screen labels device time "claimed" |
| Photo reuse | SHA-256 duplicate detection across assignments, raised as a review flag, never an accusation | `review-checks.ts`; flag shown with human labelling |
| Prompt injection in notes/images | Notes are rendered as inert text and never sent to AI. AI receives only images, has no tools, and output is schema-validated with banned assertions | Both auditors' notes contain an injection string; Playwright asserts it renders as plain text on the review desk and changes nothing |
| Cross-tenant IDOR | Every route resolves the resource's org server-side and checks live membership; non-members get 404 | `e2e-flow.test.ts` cross-tenant block |
| Malicious ZIP | Path normalization (no `..`, absolute or backslash paths), max 64 files, 25 MB per file, 120 MB total | `domain.test.ts` zip-slip, bomb, non-zip |
| Relayer compromise | Roles are separated (publisher/anchor/closer/void/pauser); the void approver is a distinct key; pause blocks writes but not reads; mismatched onchain commitments are quarantined with a critical alert | Foundry pause and role tests |
| Session theft / CSRF | HttpOnly SameSite=Lax cookie, custom CSRF header + origin check on all mutations, hashed session tokens, live membership check per request | CSRF-less POST → 403; revoked member → 404 on next request |
| Evidence exfiltration | No public object URLs; evidence is served only through an authorized, audited route with `CSP: default-src 'none'` | API test: another auditor fetching the evidence → 404 |
| Forged or repacked packet | Verifier pins the issuer's registry and report-signing key, checks onchain closure before disclosure and the exact version count | API test: self-signed repack → INVALID; correction stripped from a copy → INVALID |
| Login code brute force | Attempts reserved atomically before comparison; per-email failure lockout across codes | Code review; covered by the auth flow in every test |

## Trust assumptions we do not remove

- Criterion custodians and managers know the target and could leak it outside the app.
- The organization's relayer attests device enrollment (P0 trust model). Verifiers should compare the report-signing key fingerprint out of band.
- Both void keys are held by the organization's server; the contract still requires two distinct signers, and the two approvers are distinct people in the audit trail.
- Platform operators could access the application encryption keys. Customer-managed KMS is P2.
- A valid packet says nothing about whether the count is true.
