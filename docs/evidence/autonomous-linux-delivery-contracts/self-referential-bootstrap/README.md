# Autonomous Linux delivery contracts bootstrap

- `stack_kind=self_referential_bootstrap`
- Originating PR: `#557`
- Base commit: `80a388f4c0e9627c46c442d5124b000d51141691`
- Implementation subject commit: `f9e7c415b3c71a8b5ead1ba25f090fcaf45430c4`
- Ledger entry: `autonomous-linux-delivery-contracts`
- Verification contract: `autonomous-linux-delivery-contracts/v1`
- Contract SHA-256: `2b03b006e23998453d0f62a440af5dcbccc680f2771d2f7e1abc65330b321856`
- Activation status: `HELD`

This PR adds the standalone contracts and parser that will classify, adjudicate,
and record a future autonomous merge and Linux test-delivery mechanism. Because
those files are themselves a verification authority, the base-pinned mechanism
cannot prove their post-merge behavior before the change merges. This evidence
records the exact pre-merge regression gates while the ledger entry remains
open. A separate PR must rerun the immutable command list from the merged
first-parent `main` commit and commit a fixpoint attestation.

The active trusted-host merge v1 path remains `LEGACY_GUARDED` and
`preserved_unwired`. No signer installation, private inventory mutation,
credential access, live ruleset change, approval, merge, runtime stop, Linux
deployment, or production action was performed to create this evidence.

The current linked worktree is absent from the registered GitNexus index, so
GitNexus impact and detect-changes remain `UNKNOWN`. Compensating evidence is the
exact staged diff, independent read-only review, typed dynamic negative probes,
and the executable command results in `gate-suites.txt`; `UNKNOWN` is not
recorded as a pass.
