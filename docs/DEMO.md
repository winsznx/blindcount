# Demo script (about 4 minutes)

All farms, people and counts are simulated and labelled. Chain transactions are real.

1. **Problem (0:00).** Open `/research`. The cited study reported about 25% manipulated reports, and about 11% when criteria were concealed. Those are the authors' figures, not BlindCount's.
2. **Manager (0:40).** Sign in as `manager@demo.blindcount.test`. Programmes → New cohort. Commit a hidden minimum of 15 and add two assignments. The blind preview shows "Target sealed until cohort closes". Freeze and publish: three registry transactions appear.
3. **Auditor A on a phone (1:10).** Sign in as auditor A. My visits → Start visit → Set up signing key. Count 18, add a photo, consent, then Review and finalize. Watch the receipt go Finalized on device → Received → Blockchain confirmed, with the tx hash.
4. **Cohort guard (2:00).** As the manager, Close cohort is refused: 1 assignment has no sealed result, and the target stays sealed.
5. **Auditor B (2:20).** Finalize 12. Close the cohort, then Disclose criterion (re-confirm the email code). Outcomes: 18 meets, 12 is below.
6. **Reviewer (2:50).** Review desk → FARM-001. Original 18 evaluated against ≥ 15. Approve with a reason, then generate the report and proof packet.
6b. **Correction (3:05).** Reviewer requests a recount on FARM-002 (count 12). Auditor B signs version 2 (16) on the phone; it anchors after closure, flips to "meets criterion", and the reviewer accepts it. The report shows 12 → 16; version 1 never changed.
7. **Verifier (3:20).** `/verify`, drop the ZIP: Verified integrity. Edit the count in a copy and drop it: Integrity failed, `observation-v1.json digest mismatch`. The same result comes from `pnpm verify:packet -- --packet … --rpc …`.
8. **Limit (3:50).** Cryptographic integrity doesn't establish whether the field count is factually correct.

Steps 2–7 are automated in `e2e/tests/canonical-story.spec.ts`.
