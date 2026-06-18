## Summary

- _Describe the PR scope._

## AI Coding Governance

| Item | Result |
|---|---|
| Linked issue |  |
| Requirement source | `docs/plans/...` / `docs/superpowers/...` / not needed |
| CODEOWNERS / owner review | requested / not needed |
| GitNexus evidence | impact / detect_changes / not needed |
| gstack evidence | screenshot / trace / not user-facing |
| Agent workflow changed? | no / yes, describe rollback |
| Required checks expected | CI / Agent Governance / PR Review Agent |

## Frontend Verification

User-facing changes must be operable from the frontend. Backend/API-only completion is not accepted.

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
