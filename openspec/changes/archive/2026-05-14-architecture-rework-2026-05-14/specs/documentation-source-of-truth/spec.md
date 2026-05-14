# documentation-source-of-truth Specification Delta

## ADDED Requirements

### Requirement: Source-of-truth documents reflect B-scheme architecture rework

`AGENTS.md`, `README.md`, `docs/PROJECT_DEVELOPMENT_WORKFLOW.md`, `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`, and OpenSpec specs SHALL reflect the B-scheme architecture: `_worker` is RVT→IFC bridge; `bim-streaming-server` is IFC→USDC conversion authority; `bim-review-platform` is a deployment boundary and not a nested repo.

#### Scenario: AGENTS and README disagree

- **WHEN** `AGENTS.md` and `README.md` describe different conversion authorities
- **THEN** the PR MUST be blocked until both are aligned or the conflict is explicitly documented in the OpenSpec change

#### Scenario: Roadmap HTML is regenerated

- **WHEN** the roadmap Markdown is updated after this architecture rework
- **THEN** the corresponding HTML view is regenerated from the Markdown
- **AND** the Markdown remains the source of truth

#### Scenario: bim-review-platform wording is ambiguous

- **WHEN** a document says `bim-review-platform`
- **THEN** it MUST state whether it means deployment boundary, compose profile, module folder, or actual service process
- **AND** it MUST NOT imply nested Git unless a separate approved governance change allows it
