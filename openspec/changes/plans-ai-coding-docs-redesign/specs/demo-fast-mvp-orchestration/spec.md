## MODIFIED Requirements

### Requirement: Repository SHALL provide a single fast MVP demo runbook

The repository SHALL provide one canonical fast MVP demo runbook at `docs/demo/fast-mvp-demo-recap.md` that consolidates the launch order, port matrix, host vs container boundary, WSL Kit graphics constraint, sample-fixture selection rules, and acceptance criteria required to run a single-host demo of the coordinator + streaming-server + viewer closed loop using only repo-resident services and `tests/fakes` doubles.

#### Scenario: A new operator finds the demo runbook from the repo root

- **WHEN** a new operator looks for "how do I demo this" starting from the repo root
- **THEN** `README.md` SHALL cross-link to `docs/demo/fast-mvp-demo-recap.md`
- **AND** product requirement sources (`docs/plans/docs-plans-README.md` → TARGET/TRUTH/PROCESS plus the two tracked prototypes) SHALL NOT replace the demo runbook
- **AND** `docs/demo/fast-mvp-demo-recap.md` SHALL be the single source for demo orchestration knowledge

#### Scenario: Runbook references existing verification entries rather than duplicating them

- **WHEN** the runbook lists service launch / verification / trigger commands
- **THEN** it SHALL reference the existing scripts under `scripts/` (e.g. `scripts/start-all.ps1`, `scripts/demo-health-check.ps1`, `scripts/smoke-bscheme-intake.ps1`) and the verification entries in `CLAUDE.md` §5 by relative path
- **AND** it SHALL NOT duplicate the canonical command strings in a way that would drift if the referenced scripts or `CLAUDE.md` §5 changes
- **AND** it SHALL NOT introduce a new `scripts/demo/` subdirectory or new orchestration scripts when an existing script already covers the step
