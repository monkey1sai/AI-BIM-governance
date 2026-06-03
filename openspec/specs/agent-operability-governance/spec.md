# agent-operability-governance Specification

## Purpose
TBD - created by archiving change agent-entry-boundaries. Update Purpose after archive.
## Requirements
### Requirement: Agent boundary SHALL align A1-A10 product positioning

The repo agent contract SHALL identify `https://bim-docs.jackshappybot.com/` page「05 BIM治理與模型檢核」A1-A10 as the main product development items for this repo, and page「06 操作介面總覽」as the user-operation reference for UI routes, buttons, progress, and validation flows. The design site SHALL guide product positioning and operability semantics, while code and contracts remain the behavior source of truth.

#### Scenario: Agent starts user-facing governance work

- **GIVEN** an agent is asked to modify a user-facing governance capability
- **WHEN** the agent reads the repo contract
- **THEN** the agent SHALL map the work to the relevant A1-A10 product item
- **AND** the agent SHALL consult the frontend operability guidance before claiming done
- **AND** the agent SHALL NOT treat backend/API completion as full user-facing completion.

### Requirement: User-facing completion SHALL be frontend-operable

Every user-facing capability SHALL be verifiable from a frontend screen. Completion SHALL require a documented frontend route, visible controls/buttons, default fixture data, loading/success/failure/retry UI states, relevant runtime identifiers, and browser E2E evidence where applicable.

#### Scenario: User verifies a capability from browser UI

- **GIVEN** the development server is running
- **AND** default fixture data is available
- **WHEN** the user opens the documented frontend route
- **AND** clicks the documented action button
- **THEN** the system SHALL call the real backend API
- **AND** the frontend SHALL display loading, success, and failure states
- **AND** the resulting domain object SHALL be visible in the UI
- **AND** the PR SHALL include browser E2E command and screenshot or trace evidence when the capability is user-facing.

### Requirement: Deployment behavior SHALL flow through canonical scripts

`scripts/deploy.ps1` SHALL be the canonical one-click deploy / demo entrypoint. Runtime, Docker, Kit, viewer, env, port, conversion-service, or demo launch changes SHALL update or explicitly verify this deploy path. New root-level `scripts/start-*.ps1`, `scripts/smoke-*.ps1`, `scripts/check-*.ps1`, `scripts/*-docker.ps1`, or `scripts/deploy-*.ps1` SHALL be prohibited by default unless registered and justified in the script contract.

#### Scenario: PR changes runtime or deploy topology

- **GIVEN** a PR changes runtime, Docker, Kit, viewer, env, port, conversion-service, or demo launch behavior
- **WHEN** the PR is prepared
- **THEN** it SHALL update or explicitly verify `scripts/deploy.ps1`
- **AND** it SHALL report `.\scripts\deploy.ps1 -DryRun` or explain why it could not be run
- **AND** it SHALL update `scripts/script-registry.json` and `scripts/SCRIPT_CONTRACT.md` if a root-level script is added.

