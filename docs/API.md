# API (v1)

Base: `/v1`. JSON. Responses are `{ data, requestId }` or `{ error: { code, message, details, requestId, retryable } }`. All mutations need `X-BlindCount-CSRF: 1` and a same-origin `Origin`. Sessions use the HttpOnly cookie `bc_session`.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | /auth/email/start | public | Always 202 (no account enumeration). 30 s resend cooldown |
| POST | /auth/email/verify | public | 6-digit code, 5 attempts, 10 min. Re-verifying refreshes step-up auth |
| POST | /auth/logout | user | 204 |
| GET | /auth/me | user | Memberships and roles |
| POST | /organizations | user | Creator becomes OWNER, MANAGER, CUSTODIAN |
| GET | /organizations/:org | member | |
| GET | /organizations/:org/members | owner, manager | |
| POST/DELETE | /organizations/:org/invitations[/:id] | owner, manager (auditor/reviewer only) | Single live token per email, 7 days |
| GET | /invitations/:token | public | Org name, roles, masked email |
| POST | /invitations/:token/accept | invitee | Email must match |
| DELETE | /organizations/:org/members/:user | owner + fresh auth | Revokes devices too |
| POST/GET/DELETE | /organizations/:org/devices[/:id] | auditor / owner | P-256 public JWK |
| GET | /organizations/:org/audit-events[?format=csv] | owner, manager | |
| GET/POST | /organizations/:org/programmes | | |
| GET/DELETE | /programmes/:id | | Delete blocked when cohorts exist |
| POST | /programmes/:id/cohorts | manager | |
| PUT | /cohorts/:id/criterion | manager, DRAFT only | Returns the commitment, never the value |
| POST | /cohorts/:id/assignments | manager | `preview: true` validates only |
| GET | /cohorts/:id/blind-preview | manager | Exactly the auditor projection |
| POST | /cohorts/:id/publish | manager, Idempotency-Key | 202. Worker sends 3 registry txs |
| GET | /cohorts/:id | manager, reviewer, owner | Target only after DISCLOSED |
| GET | /cohorts/:id/progress | | Close blockers |
| POST | /cohorts/:id/close | manager, Idempotency-Key | 409 `COHORT_NOT_CLOSABLE` with blockers |
| POST | /cohorts/:id/disclose | custodian + fresh auth, CLOSED | Evaluates deterministically, opens review cases |
| POST | /assignments/:id/void-request | manager | |
| POST | /assignments/:id/void-approve | reviewer/owner ≠ requester, fresh auth | |
| GET | /assignments?orgId= | auditor | Own visits only |
| GET | /assignments/:id/form | assigned auditor | |
| POST | /assignments/:id/evidence | assigned auditor | Raw JPEG/PNG, `X-Content-SHA256`, `X-Evidence-Consent`, optional `X-Evidence-Id` |
| DELETE | /assignments/:id/evidence/:file | assigned auditor | Unattached only |
| POST | /assignments/:id/submissions | assigned auditor, Idempotency-Key | Signed envelope. 202 new, 200 replay, 409 conflict |
| PATCH | /assignments/:id/submissions/:sid | | Always 409 `SEALED_RECORD_IMMUTABLE` |
| GET | /assignments/:id/submission-status | auditor, manager | |
| POST | /assignments/:id/amendments | assigned auditor, Idempotency-Key | Signed version n+1 linked to version n, only after a reviewer requested a correction |
| GET | /cohorts/:id/reviews | reviewer, manager | |
| GET | /reviews/:id | reviewer, manager, not the auditor | |
| POST | /reviews/:id/flags/:flag/label | reviewer | |
| POST | /reviews/:id/ai-review | reviewer | Advisory. Explicit fallback when unavailable |
| POST | /reviews/:id/decision | reviewer + fresh auth, not the criterion author | APPROVE (accepts the latest version), APPROVE_ORIGINAL, DISPUTE, REQUEST_CORRECTION |
| GET | /evidence/:id/content | uploader, reviewer, manager | Audited |
| POST | /observations/:id/reports | reviewer, manager, Idempotency-Key | DISCLOSED cohorts only |
| GET | /organizations/:org/reports, /reports/:id | | |
| GET | /reports/:id/download?format=pdf\|csv\|zip[&grant=] | role or share grant | Audited |
| POST/DELETE | /reports/:id/share-grants, /share-grants/:id | manager | Hashed token, expiry, download limit |
| GET | /organizations/:org/jobs | owner, manager | Chain queue: queued, sending, retrying and stopped jobs |
| POST | /jobs/:id/requeue | owner, manager | Retry a failed or stopped job |
| GET | /system/chain-config | public | Registry, ABI hash, report key fingerprint (the verifier's trust anchors) |
| GET | /system/status | public | |
| GET | /health/live, /health/ready | | Ready checks DB, chain and storage |

There is no endpoint that compares a guessed count against the target.
