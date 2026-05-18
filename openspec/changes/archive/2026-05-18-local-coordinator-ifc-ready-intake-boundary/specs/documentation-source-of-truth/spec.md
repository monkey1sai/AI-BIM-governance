## MODIFIED Requirements

### Requirement: Source-of-truth documents reflect B-scheme architecture rework

`AGENTS.md`, `README.md`, `docs/PROJECT_DEVELOPMENT_WORKFLOW.md`, `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`, and OpenSpec specs SHALL reflect the cloud-edge separation: the company cloud is the external control-plane; the customer-edge IFC Worker is the external IFC producer; this repo is the customer-edge data-plane runtime where `bim-review-coordinator` owns the external IFC-ready intake and `bim-streaming-server` is the internal IFC→USDC conversion engine. `_worker` and `_bim-control` SHALL be described as removed from product runtime (only test fixtures may simulate the external platform), not as degraded/offline fakes. `bim-review-platform` remains a deployment boundary and not a nested repo.

#### Scenario: AGENTS and README disagree

- **WHEN** `AGENTS.md` and `README.md` describe different conversion authorities or different intake boundaries
- **THEN** the PR MUST be blocked until both are aligned or the conflict is explicitly documented in the OpenSpec change

#### Scenario: Roadmap HTML is regenerated

- **WHEN** the roadmap Markdown is updated after this architecture rework
- **THEN** the corresponding HTML view is regenerated from the Markdown
- **AND** the Markdown remains the source of truth

#### Scenario: Mock services described as removed, not degraded

- **WHEN** a source-of-truth document describes `_worker` or `_bim-control`
- **THEN** it MUST state they are removed from product runtime and only simulated by test fixtures
- **AND** it MUST NOT describe them as a retained offline/optional runtime profile

#### Scenario: bim-review-platform wording is ambiguous

- **WHEN** a document says `bim-review-platform`
- **THEN** it MUST state whether it means deployment boundary, compose profile, module folder, or actual service process
- **AND** it MUST NOT imply nested Git unless a separate approved governance change allows it
