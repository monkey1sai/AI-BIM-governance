## ADDED Requirements

### Requirement: Repository SHALL provide a single fast MVP demo runbook

The repository SHALL provide one canonical fast MVP demo runbook at `docs/demo/fast-mvp-demo-recap.md` that consolidates the launch order, port matrix, host vs container boundary, WSL Kit graphics constraint, sample-fixture selection rules, and acceptance criteria required to run a single-host demo of the coordinator + streaming-server + viewer closed loop using only repo-resident services and `tests/fakes` doubles.

#### Scenario: A new operator finds the demo runbook from the repo root

- **WHEN** a new operator looks for "how do I demo this" starting from the repo root
- **THEN** `CLAUDE.md` and `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` SHALL cross-link to `docs/demo/fast-mvp-demo-recap.md`
- **AND** `docs/demo/fast-mvp-demo-recap.md` SHALL be the single source for demo orchestration knowledge

#### Scenario: Runbook references existing verification entries rather than duplicating them

- **WHEN** the runbook lists service launch / verification / trigger commands
- **THEN** it SHALL reference the existing scripts under `scripts/` (e.g. `scripts/start-all.ps1`, `scripts/demo-health-check.ps1`, `scripts/smoke-bscheme-intake.ps1`) and the verification entries in `CLAUDE.md` §5 by relative path
- **AND** it SHALL NOT duplicate the canonical command strings in a way that would drift if the referenced scripts or `CLAUDE.md` §5 changes
- **AND** it SHALL NOT introduce a new `scripts/demo/` subdirectory or new orchestration scripts when an existing script already covers the step

### Requirement: Runbook SHALL declare host vs container boundary for each service

The runbook SHALL declare, for each of `bim-streaming-server`, `bim-review-coordinator`, and `web-viewer-sample`, whether the demo path requires Windows host-native execution or permits container / npm execution, and SHALL declare the port matrix used by the demo.

#### Scenario: Streaming-server boundary is host-native only

- **WHEN** the runbook describes how to start `bim-streaming-server`
- **THEN** it SHALL state that the demo path requires Windows host-native execution
- **AND** it SHALL reference the deferred status of capability `runtime-image-linux-kit-launcher-readiness` and the WSL2 Vulkan blocker recorded in `docs/runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md`
- **AND** it SHALL list port `49100` (WebRTC / Kit signaling) and port `49101` (internal-only conversion authority API) as the streaming-server demo ports

#### Scenario: Coordinator and viewer boundaries permit non-host execution

- **WHEN** the runbook describes how to start `bim-review-coordinator` and `web-viewer-sample`
- **THEN** it SHALL state that they MAY run on Windows host (via `scripts/start-all.ps1` or `CLAUDE.md` §5 `npm` entries), in Docker, or via `npm run` locally, as none of them require GPU graphics
- **AND** it SHALL list port `8004` for coordinator and port `5173` for viewer as the demo ports

### Requirement: Demo SHALL be triggered exclusively by repo-resident assets

The demo SHALL be triggered exclusively by repo-resident scripts (notably `scripts/smoke-bscheme-intake.ps1`) and `tests/fakes` doubles for both the customer-edge IFC Worker and the external company-cloud `bim-control` callback receiver. The runbook SHALL NOT instruct the operator to point the demo at any real external endpoint.

#### Scenario: Demo trigger uses the spec-correct ifc-ready payload

- **WHEN** the operator triggers the demo
- **THEN** the runbook SHALL direct the operator to `scripts/smoke-bscheme-intake.ps1`, which posts a payload matching `tests/contracts/ifc_ready_payload.json` (`event="ifc_ready"`, `correlation_id`, `idempotency_key`, `tenant_id`, `project_id`, `external_model_version_id`, `source_ifc`, `requested_outputs`) to `POST http://localhost:8004/api/external/ifc-ready`
- **AND** the runbook SHALL NOT suggest hand-crafting a different payload shape for the demo

#### Scenario: External cloud callback is absorbed by repo-resident assets

- **WHEN** `bim-review-coordinator` emits a metadata-only callback to the external company cloud
- **THEN** the runbook SHALL instruct the operator that the callback target is absorbed by the coordinator's existing outbox tests (covered by `npm run verify` and the `cloud_callback_outbox` tier in `scripts/smoke-bscheme-intake.ps1`), not pointed at a real `_bim-control` endpoint
- **AND** real cloud secrets / credentials SHALL NOT appear in any demo configuration

### Requirement: Runbook SHALL define a three-step demo story and explicit acceptance criteria

The runbook SHALL define a three-step demo story (start services → health check → trigger ifc-ready and observe viewer) and SHALL provide explicit pass / fail criteria so the demo outcome is judged objectively rather than by feel.

#### Scenario: Operator can determine demo success

- **WHEN** the demo finishes
- **THEN** the runbook SHALL list pass / fail criteria aligned with the tier status semantics already used by `scripts/smoke-bscheme-intake.ps1` (`passed` / `failed` / `blocked` / `deferred` / `not_observed`)
- **AND** the runbook SHALL identify which tier outcomes count as demo success (e.g. `external_ifc_ready_intake`, `coordinator_session_lifecycle`, `streaming_internal_conversion`, `real_ifc_intake_conversion` all `passed`) versus which outcomes are acceptable as honest deferral (e.g. `single_kit_render` / `usd_stage_composition` may remain `deferred` if GPU evidence is not collected by this pass)
- **AND** the runbook SHALL state that `recorded_only` / `blocked_runtime_control_unavailable` MUST NOT be reported as demo success (consistent with `docs/runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md` Evidence rules)

### Requirement: Demo path SHALL exclude long-roadmap Phase 1/2/5/6 components

The demo orchestration SHALL exclude every component listed under roadmap Phase 1 (MinIO / Gitea / Git LFS / Speckle), Phase 2 (IfcOpenShell / IfcTester / BCF / clash detection), Phase 5 (MQTT / InfluxDB / Brick Schema / Node-RED), and Phase 6 (DVC / MLflow / PyTorch training). The runbook SHALL state these exclusions explicitly so reviewers do not mistake `recap` for a partial roadmap implementation.

#### Scenario: Reviewer can verify scope exclusion

- **WHEN** a reviewer reads the runbook
- **THEN** it SHALL contain a "Non-goals" or equivalent section listing the excluded roadmap Phase components by name
- **AND** the section SHALL state that adding any of them is out of scope for `recap` and requires a separate OpenSpec change

### Requirement: Runbook content SHALL be grep-verifiable against repo state

Any concrete path, script name, port number, or capability name referenced in the runbook SHALL exist in the repository at the time of the change being merged. Reviewers SHALL be able to verify references by grep without manual interpretation.

#### Scenario: Every referenced script exists

- **WHEN** the runbook mentions a script under `scripts/` or `bim-*/scripts/`
- **THEN** that script SHALL exist on the branch being reviewed
- **AND** the runbook SHALL use the path that is actually committed (no aspirational or future scripts)

#### Scenario: Every referenced capability exists

- **WHEN** the runbook mentions an OpenSpec capability by name
- **THEN** that capability SHALL exist either under `openspec/specs/` or under an active `openspec/changes/<change-id>/specs/`
- **AND** retired or unreleased capabilities SHALL be clearly marked as such
