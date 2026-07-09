# 2026-07-09 affected-only PR CI governance

## Context

PR #319 exposed repeated waiting on GitHub-hosted CI for checks that can be run locally with stronger, faster feedback. The user explicitly approved reducing PR-time remote coverage:

```txt
同意降低 PR 遠端覆蓋，照這個 CI 改造 commit/push
```

This change is a governance exception for pull-request CI only. It does not remove full service verification from the repository.

## Decision

- Keep local PR preflight as the mandatory first gate:
  `scripts/dev/check-pr-local-preflight.ps1 -PrNumber <n>`.
- Add a GitHub Actions changed-path classifier for PR events.
- Run service-level CI jobs on PRs only when the changed-path classifier marks the service as affected.
- Let unaffected service-level required jobs finish as job-level skipped-success, not workflow-level path-filter pending.
- Keep full service CI available on `push` to `main` and `workflow_dispatch`.
- Reduce GitHub `pr-review-agent` to PR body machine-evidence validation; local preflight remains the authority for review-agent and affected sub-repo verification.

## Safety Boundaries

- This is intentionally a PR-time coverage reduction, not a removal of validation.
- User-facing changes still require PR body machine truth and local/browser evidence.
- The classifier must be conservative for governance and workflow paths.
- If local preflight fails, agents must not wait for GitHub CI to compensate.

## Verification

- Workflow YAML parse for `.github/workflows/{ci,pr-review-agent,agent-governance}.yml`.
- `node --check .claude/workflows/ship-item.js`.
- `git diff --check origin/main...HEAD`.
- `gitnexus detect-changes --repo AI-BIM-governance --scope compare --base-ref origin/main`.
- `scripts/dev/check-pr-local-preflight.ps1 -PrNumber <n>`.
