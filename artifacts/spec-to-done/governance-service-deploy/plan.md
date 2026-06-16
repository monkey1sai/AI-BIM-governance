# spec-to-done Plan: governance-service-deploy

## Inputs

- Spec: `docs/superpowers/specs/2026-06-16-governance-service-deploy-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-16-governance-service-deploy.md`
- Worktree: `C:\Repos\active\iot\AI-BIM-governance\.worktrees\governance-service-deploy-spec`
- Branch: `docs/governance-service-deploy-spec`
- User-facing: true

## Gate Summary

- P0 args: OK.
- Existing linked worktree: OK; not main workspace.
- Spec approval: Approved by reviewer agent Planck, blocking findings none after third review.
- GitNexus impact pre-scan:
  - `scripts/deploy.ps1` file impact: LOW, no direct processes reported.
  - `Start-HostNativeConversion` / `Start-HostNativeKit`: not indexed as symbols; fallback guard is focused static search and script tests.

## Execution Strategy

Implement sequentially in the existing worktree:

1. Add `Start-HostNativeGovernance` to `scripts/lib/host-native-launcher.ps1`.
2. Wire `scripts/deploy.ps1` parameters, runtime signature, dry-run audit fields, Phase 4a lifecycle, Docker env injection, and Phase 5 probes.
3. Add governance to `scripts/stop-all.ps1`.
4. Extend `scripts/tests/test-deploy-dryrun.ps1` and add `scripts/tests/test-deploy-governance-static.ps1`.
5. Run focused syntax/static/dry-run validation.
6. Attempt runtime smoke and browser evidence if local runtime permits; otherwise record HELD at P4 with exact blocker.

