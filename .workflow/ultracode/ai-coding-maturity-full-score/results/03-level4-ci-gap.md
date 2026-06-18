# Result 03-level4-ci-gap: Level 4 CI Gap

## Summary

Before this pass, the repo was partial Level 4 because GitHub Actions only had the PR Review Agent workflow. A credible Level 4 needs a fixed fast CI lane and a separate runtime/GPU smoke lane.

## Evidence

- Existing local verification commands already covered root pytest, coordinator verify, viewer verify, Kit Manager API pytest, script tests, and compose config docs.
- Hosted CI should not include GPU/Kit/WebRTC deploy or full browser visual proof. Those require self-hosted/runtime evidence.
- Viewer `npm run verify` does not include `npm run test:session-first`, so CI should add it explicitly.
- `web-viewer-sample npm run lint` is not ready as a blocking gate due documented pre-existing lint errors.

## Files changed

Parent implemented `.github/workflows/ci.yml` and included root contracts, coordinator, viewer plus `test:session-first`, Kit Manager API, Kit Manager web build, compose config, PowerShell static analysis, and secret-pattern scan.

## Decisions

Do not put GPU/Kit/deploy/browser visual E2E in hosted CI. Keep those as self-hosted or manual evidence lanes.

## Risks

Some CI jobs are newly defined and not yet proven by GitHub Actions. Local checks found existing local dependency/sandbox issues for Node subprojects, but root pytest and Kit Manager API pytest passed.

## Verification run

- `.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider` -> 66 passed.
- `services/kit-manager-api` pytest -> 11 passed.

## Open questions

Whether to add a future self-hosted `runtime-smoke.yml` for GPU/Kit/WebRTC evidence.
