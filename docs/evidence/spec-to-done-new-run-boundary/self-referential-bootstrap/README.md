# Spec-to-done new-run classifier preregistration

- stack_kind=self_referential_bootstrap
- Originating PR: #687
- Base commit: bfba0f061edc9b62e7d6edfb5fd412358ef22666
- Classifier subject commit: 61b12f8471a7eb2ecc649cf076efcfcd4568aff6
- Ledger entry: spec-to-done-new-run-boundary-classifier
- Verification contract: spec-to-done-new-run-boundary-classifier/v1
- Contract SHA-256: 82d607837a5a7d78ca3e1b2100082f9d018e4333e68c3016931d9a1b95bbd9e3
- Activation status: HELD until the post-merge ledger-only fixpoint closes this debt

## Scope

This first predecessor changes only the base-pinned mechanism classifier, its trusted-merge
superset, and regression coverage. It does not implement the new-run boundary, does not modify
the `rvt-ifc-usdc-lineage` product change, and does not weaken or skip P0, P1, P3, P4, P5, P6,
or P7.

The PR gate executes the classifier from the immutable PR base. Therefore a single PR cannot
both add a new mechanism-path classification and use that head-only classification to register
complete bootstrap debt. This preregistration makes the exact future executable and enforcement
paths visible to a later implementation PR whose base contains this change.

The future boundary is append-only and can be admitted only after a fully valid
`HELD@P<n> reason=run_budget_exhausted` checkpoint whose fixed budget has actually reached a
limit. The boundary starts a fresh P0 run with all per-run counters reset to their unchanged
limits. No other hold reason can use this reset seam.

## Owner provenance and retained ledger anchor

The owner explicitly accepted the exact-path GitNexus impact-unavailable risk for the hidden
JavaScript validator and PowerShell self-referential classifier. The owner also selected a
current-session user-message SHA-256 tuple binding as the authorization provenance, explicitly
acknowledging that it is an auditable external attestation rather than a digital signature.

- Owner message encoding: exact UTF-8 bytes, no BOM, no trailing newline
- Owner message byte length: `479`
- Owner message SHA-256: `0907a87c4408a3e80b1995433af494a3735921ad72cc4259b79ba52f139f9176`
- Retained ledger byte length: `33542`
- Retained ledger checkpoint count: `28`
- Retained ledger SHA-256: `a3ace2ba9a0eb7db5aea36682866309974e3214ba544068de05db194a56a5f59`
- Retained terminal checkpoint: `HELD@P1 reason=run_budget_exhausted agentCalls=40/40`

The validator can verify tuple shape, deterministic binding, exact prefix bytes, and transition
invariants. It cannot manufacture owner consent. A caller without the external owner-message
provenance is not authorized to construct or append a boundary even if it can calculate hashes.

## Future implementation invariants protected by this preregistration

1. Preserve the complete historical byte prefix and verify its SHA-256, byte length, and
   non-empty checkpoint count before accepting a boundary.
2. Bind repository identity, slug/spec, previous prefix, previous terminal checkpoint, old and
   new Git identities, reset counters, run sequence, and a fresh run identifier to the owner
   message digest through one deterministic tuple digest.
3. Treat `run_budget_exhausted` as terminal inside a run. Its only successor is a valid
   owner-authorized `NEW_RUN@P0` boundary.
4. Require at least one fixed counter to be exactly exhausted; reject fabricated exhaustion,
   non-budget holds, counter-limit changes, partial resets, and carried P4/P5/P6 evidence.
5. Sanitize every local Git probe, pin the trusted Git executable and repository/worktree
   identity, disable optional locks, hooks, fsmonitor, external diff, and text conversion, and
   reject wrong/detached branches or unrelated HEAD history.
6. Append through a bounded lock-and-compare helper that rejects stale prefixes, concurrent
   forks, symlinks/reparse targets, and non-canonical state paths.
7. Classify the validator, append helper, procedure copies, contract/schema, and their
   enforcement tests as self-referential mechanism paths where they affect machine adjudication.
8. Keep every P0-P7 phase, browser evidence, adversarial review, approval, and merge gate
   unchanged. Old evidence and approvals do not cross the boundary.

This classifier PR may register only its own mechanism paths already recognized by base
`bfba0f061edc9b62e7d6edfb5fd412358ef22666`. It must not claim the future validator or helper
as changed or verified. Those paths become eligible for complete debt registration only after
this preregistration and its ledger-only fixpoint are merged.

## Baseline evidence

Exact worktree HEAD and freshly fetched `origin/main` were both
`bfba0f061edc9b62e7d6edfb5fd412358ef22666`; the tracked worktree was clean.

- GitNexus CLI: `1.6.9`; exact-path index current at `bfba0f0`, 19,005 nodes, 40,506 edges,
  1,083 clusters, 300 flows.
- Required hidden JavaScript and PowerShell symbols are not represented in the graph; impact
  is explicitly recorded as `UNKNOWN`, not passed.
- Targeted Python governance baseline: `51 passed, 9 skipped`; all skips are existing
  POSIX-only terminal-P7 Git proxy cases.
- `scripts/tests/test-self-referential-bootstrap.ps1`: all assertions passed.
- `scripts/tests/test-agent-governance-check.ps1`: all assertions passed.
