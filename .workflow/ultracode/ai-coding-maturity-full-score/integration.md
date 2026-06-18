# Integration

## Accepted

- Packet 01 conservative baseline: before this pass, the repo was strong Level 3 / partial Level 4 / conditional Level 5, approximately 3.2/5.
- Packet 02 requirements rule: all `docs/plans` files are treated as requirements input, with `docs-plans-README.md` precedence. User-facing done requires route/button/fixture/loading/success/failure/retry/runtime ID plus E2E evidence.
- Packet 03 Level 4 gap: add fixed CI coverage for root contracts, coordinator, viewer, Kit Manager, compose, PowerShell static analysis, secret scan, and governance-service.
- Packet 04 Level 5 gap: add issue forms, CODEOWNERS, PR evidence template/checker, governance CI, and branch-protection documentation.
- Packet 05 review: required-check workflows must run on every PR; path filters belong inside jobs/checkers, not on workflow triggers.

## Rejected

- Claiming full Level 5 from repo files alone. Remote branch protection/rulesets and green Actions runs are outside this local edit pass.
- Treating backend/API-only success as product completion. `docs/plans` require frontend-operable evidence for user-facing capability.
- Leaving `governance-service` out of Level 4 CI coverage.

## Conflicts

- Cost-saving workflow path filters conflict with required-check readiness. Decision: remove workflow-level filters for `pr-review-agent` and `agent-governance`.
- `governance-service` uses host-native IFC dependencies. Decision: CI installs `ifcopenshell` for hosted-runner tests; if hosted runner cannot resolve it, that becomes a visible environment blocker.

## Decisions

- Local repo score after fixes: 4.3/5 conservative current maturity.
- Repo-local readiness: Level 4 baseline prepared; Level 5 governance artifacts prepared for remote enforcement.
- Full 5/5 requires GitHub repository rulesets/branch protection enabled and verified, green Actions results, and remaining product/runtime evidence gaps closed.

## Final changes

- Added GitHub issue forms, CODEOWNERS, CI workflow, agent-governance workflow, PR body evidence checker/tests, and Superpowers plan.
- Hardened PR review workflow by removing normal GitNexus fallback and enforcing PR body evidence before agent review.
- Added governance-service CI lane and required-check documentation.
- Added `.gitignore` rule for root pytest temp directories.

## Verification

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-agent-governance-check.ps1` passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-pr-body-evidence.ps1` passed.
- PowerShell syntax parse for all new test scripts passed.
- `python -m pytest tests -q -p no:cacheprovider` passed: 66 passed.
- `python -m pytest governance-service\tests -q` passed: 103 passed, 1 warning.
- `python -m pytest services\kit-manager-api\tests -q` passed: 11 passed.
- `git diff --check` passed with line-ending warnings only.
- `git check-ignore -v pytest-of-jacks` confirmed `.gitignore:70:pytest-of-*/`.

## Skipped / blocked checks

- `bim-review-coordinator npm run verify` was attempted earlier and blocked by local EPERM/dist writes plus missing local AWS SDK packages; CI uses `npm ci` first.
- `web-viewer-sample npm run verify` built but Vitest hit local `%TEMP%` EPERM errors.
- `apps/kit-manager-web npm run build` failed locally because `node_modules` is absent; CI installs dependencies first.
- PSScriptAnalyzer was not installed locally to avoid network/module install; CI job defines it.
- No deployment, browser E2E, GPU/Kit/WebRTC smoke, or remote GitHub settings mutation was performed.

## Remaining risks

- GitHub branch protection/ruleset must still be enabled remotely.
- Hosted Actions have not run yet on this branch.
- Product/runtime full score still needs callback auth, IFC golden/bad/large/empty fixture coverage, and multi-viewer/GPU load evidence.
