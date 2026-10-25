# Static analysis

Run on `packages/contracts/src/BlindCountRegistryV1.sol`, 25 October 2026, OpenZeppelin 5.1.0, solc 0.8.24.

## Slither

`slither src/BlindCountRegistryV1.sol --filter-paths node_modules`: 117 detectors, 3 results, none actionable.

| Detector | Location | Assessment |
|---|---|---|
| unused-return | `voidAssignment`, `ECDSA.tryRecover` | The third return value (error argument) is intentionally discarded. The recover error code itself is checked and the call reverts on any error |
| timestamp | `closeCohort`, `block.timestamp < closingAfter` | Intended. `closingAfter` is an optional earliest-close policy; a validator skew of seconds has no security impact |
| operator-fee-outlier | `registerAssignments` loop | An OP-stack fee heuristic. Not applicable on Ethereum Sepolia; the loop is bounded by the cohort's `expectedAssignments` |

## Aderyn

`aderyn . --src src`: 0 high, 2 low.

| Issue | Assessment |
|---|---|
| L-1 Centralization risk for trusted roles | Accepted and disclosed. Roles are split (publisher, anchor, closer, void, void approver, pauser) and the admin uses `AccessControlDefaultAdminRules` with a 1-day transfer delay. Production should hold admin in a multisig |
| L-2 Events missing `indexed` fields | Accepted. Cohort and assignment keys, the fields consumers filter on, are indexed |

## Tests

Foundry: 23 tests covering every adversarial case in PRD 19.2, plus a fuzz test that terminal counts never exceed the roster (256 runs).
