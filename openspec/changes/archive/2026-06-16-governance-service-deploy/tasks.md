# Tasks: governance-service-deploy

## 1. Deploy behavior

- [x] 1.1 Add `-SkipGovernance` and `-GovernancePort` to `scripts/deploy.ps1`.
- [x] 1.2 Add host-native `governance-service` launcher using `python -m uvicorn app:app`.
- [x] 1.3 Start governance before conversion / Kit / Docker compose.
- [x] 1.4 Export `HOST_GOVERNANCE_API_BASE` to Docker coordinator.
- [x] 1.5 Refresh web plane when the governance API base changes.
- [x] 1.6 Add direct and coordinator-proxy health checks.
- [x] 1.7 Add `governance-service` to `scripts/stop-all.ps1`.

## 2. Governance evidence

- [x] 2.1 Add OpenSpec delta for `one-click-deploy-hybrid`.
- [x] 2.2 Keep the Superpowers spec / plan as implementation governance artifacts.
- [x] 2.3 Record spec-to-done state through PR stage.

## 3. Validation

- [x] 3.1 `scripts/tests/test-deploy-governance-static.ps1`.
- [x] 3.2 `scripts/tests/test-deploy-dryrun.ps1`.
- [x] 3.3 `scripts/deploy.ps1 -Build -SkipKit -SkipConversion -StrictPostVerify`.
- [x] 3.4 A1/M1 Playwright E2E: `npm run test:e2e -- --project=chromium e2e/a1-m1-closeout.spec.ts`.
- [x] 3.5 `npx openspec validate governance-service-deploy --strict`.
- [x] 3.6 PR review agent check passes.
