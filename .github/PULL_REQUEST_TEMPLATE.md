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

## Windows On-Demand Verification

Required when changed paths can alter Windows platform behavior. The tier is machine-derived from changed paths (`scripts/lib/windows-verification-scope.ps1`); the highest match wins and the PR body cannot select an easier one. Docs and tests-only changes owe nothing.

| Item | Result |
|---|---|
| Windows verification tier | `platform_unit` / `deploy_dryrun` / `kit_gpu`, or omit when not applicable |
| Windows verification evidence | the actual Windows run and its result |

## Self-Referential Bootstrap

Required when the PR changes the verification mechanism itself (deploy path /
evidence harness / gate script). Rule:
`docs/agents/self-referential-bootstrap.md`. On a Lean Governance base the
ledger is a closed historical archive: declare `no`, keep it unchanged, and
treat the classifier output as advisory. The tuple-bound
`owner-authorized-migration` value exists only for PR #704.

| Item | Result |
|---|---|
| Self-referential bootstrap | yes / no |
| Lean migration owner message | `not applicable`, or the exact #704 owner-message SHA-256/byte tuple |
| Current candidate head | exact 40-character PR head SHA for `owner-authorized-migration` |
| Bootstrap ledger entry | `not applicable` on a Lean Governance base |
| Bootstrap reason | `not applicable` on a Lean Governance base |

## Validation

- _List commands and results._

## Known Risks

- _List residual risks or state none._
