## Summary

- _Describe the PR scope._

## AI Coding Governance

Machine values: `Change lane` = `F` / `B` / `G` / `S`; `Behavior contract changed` = `yes` / `no`; `Requirement source` = `issue` / `docs/plans` / `superpowers spec` / `existing contract` / `not applicable`.

| Item | Result |
|---|---|
| Change lane |  |
| Behavior contract changed |  |
| Linked issue |  |
| Requirement source |  |
| CODEOWNERS / owner review | requested / not needed |
| GitNexus evidence | impact / detect_changes / not needed |
| Browser E2E evidence | Playwright / gstack / supported engine / not user-facing |
| Agent workflow changed? | no / yes, describe rollback |
| Required checks expected | CI / Agent Governance / PR Review Agent |

## Frontend Verification

User-facing changes must be operable from the frontend. Backend/API-only completion is not accepted; record the real backend API, observed runtime ID, visible loading/success/failure/retry states, and screenshot or trace.

| Item | Result |
|---|---|
| Frontend route |  |
| Main button(s) tested |  |
| Fixture used |  |
| Backend API called |  |
| Runtime action |  |
| Visible success state |  |
| E2E command |  |
| Screenshot / trace |  |
| Manual test steps |  |
| Known gaps |  |

## Deploy Path Verification

Required for runtime / Docker / Kit / viewer / ports / env / conversion-service changes.

| Item | Result |
|---|---|
| Affects runtime / docker / Kit / viewer / ports / env? | yes / no |
| Canonical deploy path updated? | `scripts/deploy.ps1` updated / verified / not needed |
| New root script added? | no / yes with `scripts/script-registry.json` entry |
| Deploy dry-run command | `.\scripts\deploy.ps1 -DryRun` |
| Full deploy tested | `.\scripts\deploy.ps1 -Force -StrictPostVerify` / not available |
| Verify command | `.\scripts\verify-all.ps1` |
| Frontend URL verified |  |
| Evidence path |  |

## Validation

- _List commands and results._

## Known Risks

- _List residual risks or state none._
