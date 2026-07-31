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
| Required checks expected | CI / Agent Governance / PR Metadata Contract |

## Frontend Verification

User-facing changes must pass two independent producers: real frontend/runtime operability evidence and the pinned `docs/plans/design-system-reference.manifest.json` fidelity gate. Scope is derived from changed paths plus the base/head manifest union; the PR body cannot select an easier screen. `mixed` and `partial_reference_missing` permit honest partial work but require `Full completion claimed = no`. Semantic evidence is produced only by the `design-semantic-visual` CI Playwright job, never supplied as PR input; `PR Metadata Contract` validates the live PR metadata, while normal protected CI checks determine mergeability.

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
| Design gate status | `passed` / `mixed` / `partial_reference_missing` |
| Design screen(s) | all machine-required manifest screen IDs, or `reference_missing` |
| Reference-missing route(s) / surface(s) | exact machine-derived list, or `none` |
| Full completion claimed | `yes` / `no` |
| Design reference manifest | `docs/plans/design-system-reference.manifest.json` |
| Visual fidelity result | CI output `artifacts/e2e/design-system-visual-result.json`, or `reference_missing` |
| Visual comparison | Chromium DPR 1; 1440x900 + 1920x1080; pixel diff <=1%; semantic parity 100%, or `reference_missing` |
| Visual artifacts | CI output `artifacts/e2e/design-system-visual/<screen>/<viewport>-actual.png` + `-diff.png`, or `reference_missing` |
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

## Self-Referential Bootstrap

Required when the PR changes the verification mechanism itself (deploy path / evidence harness / gate script). Rule: `docs/agents/self-referential-bootstrap.md`. Open ledger debt in `scripts/self-referential-bootstrap-ledger.json` blocks further mechanism PRs until fixpoint closure.

| Item | Result |
|---|---|
| Self-referential bootstrap | `yes` / `no` |
| Bootstrap ledger entry | entry id, or `not applicable` when `no` |
| Bootstrap reason | concrete mechanism gap (>=30 chars), or `not applicable` when `no` |

## Validation

- _List commands and results._

## Known Risks

- _List residual risks or state none._
