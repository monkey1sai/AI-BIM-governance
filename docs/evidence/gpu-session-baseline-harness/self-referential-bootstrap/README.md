> Document nature: **working note**. This file is bootstrap evidence, not an authoritative runtime, API, or deployment specification.

# GPU session-baseline evidence harness bootstrap

- `stack_kind=self_referential_bootstrap`
- Pull request: #511
- Ledger entry: `gpu-session-baseline-harness`
- Baseline: freshly fetched `origin/main` at `cba626587c6cc50000e35050988c29208c8246ac`
- Branch parent at capture: `f6bb26b717ce12c77431374083a9159ac4870f1e` (plus the review round-2 working tree recorded by this commit)
- This is isolated branch bootstrap evidence. It is not canonical post-change evidence, it is not deploy-target evidence, and it does not claim a completed GPU capacity baseline.

## Why bootstrap evidence is required

This pull request ADDS the GPU session-baseline evidence harness
(`scripts/measure-session-baseline.ps1`, `scripts/lib/measure-session-baseline.ps1`,
`scripts/tests/test-measure-session-baseline.ps1`) and in the same change registers those paths in
`Get-SelfReferentialMechanismPaths`. Three mechanism gaps follow:

1. The base tree contains no such harness at all, so the pre-change mechanism cannot emit a
   `gpu-session-baseline-report/v1` report describing the changed behaviour.
2. The report is only meaningful on a live Kit/GPU deployment host, and that host is rebuilt
   exclusively from freshly fetched `origin/main`. An unmerged revision of the harness therefore
   never executes there, so no pre-merge run can be canonical.
3. Registering the harness in the matcher is itself a change to the adjudicating gate library
   (`scripts/lib/self-referential-bootstrap.ps1`) and its suite. The contract requires that to be
   declared with `bootstrap=yes` rather than allowed to validate itself under `bootstrap=no`.
   Wiring the harness suite into `.github/workflows/ci.yml` is intentionally deferred until this
   debt closes, so the enforcement surface is untouched by this pull request.

## Observations recorded on this branch

- `pwsh -NoProfile -File scripts/tests/test-measure-session-baseline.ps1` completed with 20 `[PASS]`
  groups and the `ALL PASSED` terminator on the Windows development host. Full output is in
  `harness-suite.txt`.
- The harness ran on this development host only. Every report it produced there carries
  `environment_fingerprint.complete=false` and emits the "SHALL NOT be used to set SLOs or
  admission parameters" warning, so nothing in this pull request may be read as a settled baseline.
- `environment_fingerprint.kit_version.source='checkout_packman_declared'` and
  `runtime_verified=false`: the Kit revision is parsed from the checkout's `kit-sdk.packman.xml`,
  never interrogated from a running Kit process. When Kit GPU processes are observed at capture
  time, `observed_kit_process_count` and an extra caveat clause record that those specific
  processes were not interrogated. Runtime version query is task 1.2 scope.
- A multi-GPU host reports `gpu_fingerprint_scope=first_gpu_only` and `complete=false`, so a
  partially fingerprinted host cannot silence the warning.
- `software_queue_required` is derived from MIG availability alone; consumer grade is retained as
  an informational field only.

## Fixpoint obligation

After #511 merges, execute the first canonical baseline run on the deployment host from freshly
fetched `origin/main`, validate the emitted report against the pinned
`gpu-session-baseline-report/v1` schema, rerun the contract command set
(`test-measure-session-baseline`, `test-self-referential-bootstrap`, `test-agent-governance-check`,
`invoke-powershell-static`, `canonical-host-baseline-run`), then record the merged mechanism commit
and the fixpoint attestation under `docs/evidence/gpu-session-baseline-harness/fixpoint/` and close
the ledger entry. Until that run exists, no SLO or admission parameter may cite this harness.
