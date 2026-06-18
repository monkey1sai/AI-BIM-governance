# Proposal: stop-all-single-pid-cleanup

## Why

Post-merge closeout for PR #215 exposed a strict-mode cleanup bug in `scripts/stop-all.ps1`: when `scripts\.run\` contains exactly one `.pid` file, `Get-ChildItem` returns a scalar `FileInfo`, and `$pidFiles.Count` raises a strict-mode error after the service has been stopped.

The shutdown still stopped the intended governance process, but the error made the session closeout look unhealthy and could confuse operators.

## What Changes

- Wrap the `.pid` file enumeration in `@(...)` so zero, one, and many pid files all have array semantics.
- Add a focused regression test that creates one stale `governance-service.pid`, runs `stop-all.ps1`, and asserts that the strict-mode `Count` error does not appear.

## Impact

- Affected capability: `one-click-deploy-hybrid`
- Affected files:
  - `scripts/stop-all.ps1`
  - `scripts/tests/test-stop-all-single-pid.ps1`
- Non-goals:
  - no change to which services `stop-all.ps1` is allowed to stop
  - no change to deploy startup order
  - no Docker or runtime behavior changes
