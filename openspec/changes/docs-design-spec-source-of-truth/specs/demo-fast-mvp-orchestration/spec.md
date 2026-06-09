## MODIFIED Requirements

### Requirement: Repository SHALL provide a single fast MVP demo runbook

The repository SHALL provide one canonical fast MVP demo runbook at `docs/demo/fast-mvp-demo-recap.md` that consolidates the launch order, port matrix, host vs container boundary, WSL Kit graphics constraint, sample-fixture selection rules, and acceptance criteria required to run a single-host demo of the coordinator + streaming-server + viewer closed loop using only repo-resident services and `tests/fakes` doubles.

#### Scenario: A new operator finds the demo runbook from the repo root

- **WHEN** a new operator looks for "how do I demo this" starting from the repo root
- **THEN** `README.md` SHALL cross-link to `docs/demo/fast-mvp-demo-recap.md`
- **AND** product requirement docs (`docs/plans/ai-bim-governance-設計規格.md` / `docs/plans/ai-bim-governance-prototype.html`) SHALL NOT replace the demo runbook
- **AND** `docs/demo/fast-mvp-demo-recap.md` SHALL be the single source for demo orchestration knowledge
