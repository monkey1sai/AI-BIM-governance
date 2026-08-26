# Spec-to-done new-run classifier preregistration

- stack_kind=self_referential_bootstrap
- Originating PR: #687
- Opening base commit: bfba0f061edc9b62e7d6edfb5fd412358ef22666
- Opening classifier subject commit: 61b12f8471a7eb2ecc649cf076efcfcd4568aff6
- Synchronized PR base commit: 14a6ac6d912e1cacadd0de5cf862772124aab00d
- Functional-fix subject before this evidence-only correction: eddece2ba2d75875173197369d3008cf7bf68b25
- Final candidate head binding: live PR metadata and exact-head checks; intentionally not self-embedded because changing this tracked file changes that commit
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

At historical opening, this classifier PR could register only its own mechanism paths already recognized by base
`bfba0f061edc9b62e7d6edfb5fd412358ef22666`. It must not claim the future validator or helper
as changed or verified. Those paths become eligible for complete debt registration only after
this preregistration and its ledger-only fixpoint are merged.

## Opening baseline evidence (historical classifier admission)

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

## Synchronized functional-fix evidence

The PR was synchronized to base `14a6ac6d912e1cacadd0de5cf862772124aab00d` and the
mandatory-adjudicator repair was committed as
`eddece2ba2d75875173197369d3008cf7bf68b25`. This section binds the executable repair subject
that existed immediately before this evidence-only correction; it does not claim that SHA is
the final containing commit. The final candidate head is necessarily external live PR/CI
evidence, because embedding a commit's own hash in this tracked file would change that hash.

- Branch: `codex/governance/spec-to-done-new-run-boundary`.
- GitNexus CLI: `1.6.9`; exact worktree index and current commit were both `eddece2`.
- GitNexus detect-changes: `LOW`; 6 files, 5 indexed symbols, 0 affected processes.
- PowerShell impact target `Assert-SelfReferentialBootstrapBody`: `UNKNOWN/target not found`;
  this remains the owner-accepted exact-path unavailable risk and is not an impact pass.
- Future NEW_RUN paths: mechanism classifier 8/8; mandatory-adjudicator clean-ledger rejection
  8/8; trusted-host coverage 8/8; adjacent/wrong-case matches 0/8.
- `scripts/tests/test-self-referential-bootstrap.ps1`: exit 0; all assertions passed.
- `scripts/tests/test-agent-governance-check.ps1`: exit 0; all assertions passed.
- `node scripts/tests/test-trusted-host-merge.mjs`: exit 0; 18 passed and 1 expected
  Windows-platform skip for the Linux gitlink fixture.
- `scripts/tests/invoke-powershell-static.ps1`, `scripts/tests/scan-secret-patterns.ps1`, and
  `git diff --check`: exit 0.
- Exact-subject workflow dispatch `32873419853`: success; Windows
  `rebuild/test-deploy contracts` job `97885719300` and host-native launcher PowerShell 7 passed.

Any approval or merge decision must ignore stale embedded SHA claims and instead verify the
live PR base/head tuple, current-head checks, reviews, and zero unresolved threads.
