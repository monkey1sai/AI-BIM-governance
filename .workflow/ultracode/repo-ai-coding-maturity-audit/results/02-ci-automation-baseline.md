# Packet 02 Result: CI And Automation Baseline

## Verdict

Partial Level 4 only. The repo has useful local verification and one PR review workflow, but not a complete CI/CD lint/type/test/smoke matrix.

## Accepted Evidence

- `.github/workflows/pr-review-agent.yml` is the only workflow under `.github/workflows`.
- The workflow runs on pull requests and executes `scripts/pr-review-agent.ps1`.
- `scripts/lib/pr-review-agent.ps1` maps changed paths to targeted verification commands.
- Local scripts and package manifests include build/test/verify commands, including `scripts/verify-all.ps1`, coordinator `npm run verify`, and viewer `npm run verify`.

## Blocking Gaps

- No separate fixed `ci.yml` baseline covering root contracts, coordinator, viewer, streaming, governance service, Kit Manager API, and Kit Manager web.
- No CD/deploy workflow was found.
- Lint/type/test coverage is inconsistent across subprojects.
- Runtime smoke, browser visual evidence, and Kit/WebRTC evidence are still runbook or local evidence paths, not required CI gates.
- Python dependencies in the PR workflow are installed ad hoc instead of per-service reproducible environments.

## Parent Decision

Do not score as solid Level 4. Count this as Level 4-in-progress.
