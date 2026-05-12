# runtime-verification-evidence Specification

## Purpose
Define the evidence tiers and acceptance rules for runtime verification. This
spec separates contract checks, single-Kit render evidence, dedicated multi-Kit
routing evidence, stress evidence, and real IFC conversion quality metrics so
the roadmap can distinguish API success, geometry/render success, blocked
hardware prerequisites, and deferred capacity tiers.
## Requirements
### Requirement: Runtime verification evidence is tiered

The workspace SHALL record runtime verification evidence by tier instead of using a single ambiguous end-to-end status. Evidence tiers MUST distinguish non-GPU contract checks, single Kit GPU render checks, multi Kit routing checks, and stress checks.

#### Scenario: Non-GPU contract evidence is recorded

- **WHEN** `bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1` is run
- **THEN** the verification report records the command, result, and that it validates DataChannel stage-loading contract shape without claiming GPU viewport render success

#### Scenario: Hardware-dependent evidence is blocked

- **WHEN** a verification tier requires GPU, Kit SDK, valid geometry, multiple Kit instances, or load-test inputs that are unavailable
- **THEN** the verification report records `blocked` with the missing prerequisites and next runnable step instead of leaving the item as plain unverified

### Requirement: Single Kit render evidence uses valid geometry

The workspace SHALL only treat Kit viewport render as verified when the loaded model contains valid renderable geometry and browser evidence proves video readiness.

#### Scenario: Repo-local storage fixture is selected

- **WHEN** single Kit render evidence is prepared
- **THEN** the fixture MUST come from repo-local `storage/` unless the verification report explicitly records an approved exception and reason

#### Scenario: Header-only IFC fixture is rejected for render evidence

- **WHEN** a smoke fixture only contains IFC header / footer text and no renderable building geometry
- **THEN** the verification report MUST NOT classify the run as successful Kit GPU viewport render evidence

#### Scenario: Valid geometry renders in browser

- **WHEN** a valid IFC, USD, or USDC fixture is loaded through `_worker`, `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server`
- **THEN** the evidence records the fixture identity, artifact URLs, `review_request_id` or `session_id`, video readiness, non-zero video dimensions, `openedStageResult`, and a viewport screenshot or equivalent visual proof

### Requirement: Dedicated Kit routing evidence requires multiple Kit instances

The workspace SHALL only classify `dedicated_instance` routing as runtime-verified when the purchased and deployed GPU environment provides two or more distinct Kit instance endpoints. Dedicated multi-Kit runtime verification SHALL remain deferred until GPU purchase and deployment provide that capacity.

#### Scenario: GPU capacity purchase and deployment is pending

- **WHEN** no purchased and deployed GPU capacity tier provides at least two Kit endpoints
- **THEN** dedicated_instance runtime verification is recorded as deferred pending capacity
- **AND** the evidence MUST NOT classify the dedicated runtime tier as in-progress, passed, or failed

#### Scenario: Root scripts coordinate multi Kit startup

- **WHEN** GPU capacity has been purchased and deployed and multi Kit runtime verification needs to launch or check more than one service
- **THEN** the orchestration entrypoint MUST live under root `scripts/` while `bim-streaming-server/scripts/` may remain the low-level single-instance launcher

#### Scenario: Single local_fixed instance cannot verify dedicated routing

- **WHEN** the environment only has one `local_fixed` Kit instance on signaling port `49100`
- **THEN** a second viewer receiving GPU busy / already streaming is recorded as an environment capacity limit, not as a failed `dedicated_instance` routing verification

#### Scenario: Multiple dedicated instances stream concurrently

- **WHEN** coordinator registers two or more Kit instances with distinct signaling ports and a session requests `routing_policy=dedicated_instance`
- **THEN** evidence records distinct `kit_instance_bindings[]`, distinct stream configs, concurrent browser readiness for each assigned artifact group, and Socket.IO collaboration continuity across the shared `session_id`

### Requirement: Stress verification has explicit thresholds

The workspace SHALL define thresholds before claiming large IFC or Socket.IO concurrency stress verification.

#### Scenario: Large IFC stress is measured

- **WHEN** a large IFC fixture is used for conversion and review-session readiness
- **THEN** evidence records fixture size, conversion duration, memory or process observations when available, readiness state transitions, final status, and viewer behavior while conversion is `processing`

#### Scenario: Socket.IO concurrency stress is measured

- **WHEN** Socket.IO collaboration stress is run with more than two clients
- **THEN** evidence records client count, event types, broadcast success criteria, observed failures, and coordinator health after the run

#### Scenario: Socket.IO target load uses local sustainable capacity

- **WHEN** Socket.IO stress is prepared on the user's workstation
- **THEN** the verification MUST first determine the machine's maximum sustainable client count and use 90% of that count as the formal stress target

### Requirement: Real conversion evidence distinguishes API success from geometry success

Runtime verification evidence SHALL distinguish `_worker` API flow success from real IFC geometry conversion success. Evidence MUST NOT claim single Kit render readiness when the source artifact was converted by a placeholder path.

Current accepted real conversion evidence uses the worker adapter backed by
external `ifcopenshell` and `usd-core`; API-only success without those hard
quality gates is contract evidence only.

#### Scenario: API-only conversion smoke passes

- **WHEN** `_worker` accepts an IFC, creates a conversion job, and returns conversion result metadata
- **THEN** the evidence records API success separately and does not claim real geometry or Kit viewport success unless the derived USDC passed real conversion validation

#### Scenario: Placeholder output is detected

- **WHEN** `model.usdc` contains placeholder text, fake geometry, or a mock mapping marker
- **THEN** the verification report classifies the run as blocked for real render evidence and records the placeholder source

### Requirement: Real conversion evidence records quality metrics

The workspace SHALL record real conversion quality metrics before treating a conversion as accepted evidence. Metrics MUST include fixture identity, fixture size, converter identity, duration, USDC openability, source IFC entity count, USD prim count, mapped entity count, unmapped entity count, coverage ratio, coverage status, lineage API status, and whether a minimum coverage baseline is locked.

Evidence before threshold lock MUST use a measure-first policy: coverage report is required, but low coverage alone MUST NOT fail CI until the baseline threshold is established. Evidence after threshold lock MUST record `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, denominator policy for all source IFC entities, pass/warn/fail policy, and whether the current conversion satisfies issue-to-real-prim readiness.

#### Scenario: Large IFC fixture is converted

- **WHEN** a repo-local IFC fixture is converted by the real conversion path
- **THEN** the evidence records fixture path or identifier, file size, converter identity, duration, resulting artifact URLs, USDC openability, lineage API result, and mapping coverage metrics

#### Scenario: Mapping coverage is measured before threshold lock

- **WHEN** the real conversion path produces a coverage report before a minimum threshold is locked
- **THEN** the evidence records the observed coverage, keeps CI passing if the hard conversion checks passed, and does not classify minimum issue-to-real-prim coverage as verified

#### Scenario: Mapping coverage is evaluated after threshold lock

- **WHEN** the real conversion path produces a coverage report after a minimum threshold is locked
- **THEN** the evidence records `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status`, policy diagnostics, and whether the conversion is accepted, warned, or failed by the locked baseline

#### Scenario: Non-geometric entity coverage is recorded

- **WHEN** a fixture contains non-geometric IFC entities such as property sets, type objects, relationship entities, project, site, building, or storey containers
- **THEN** the evidence records whether those entities materialized as non-renderable USD prims and includes them in mapped/unmapped entity counts

#### Scenario: Warning coverage remains reviewable

- **WHEN** real conversion evidence records `coverage_status=warn`
- **THEN** the evidence may classify the artifact group as reviewable with degraded mapping quality, but MUST NOT classify issue-to-real-prim baseline as verified

#### Scenario: Lineage API is missing from conversion evidence

- **WHEN** real conversion succeeds but the lineage API cannot return the source -> derived -> mapping graph for the converted artifact
- **THEN** the evidence records conversion success separately and MUST NOT claim lineage visualization or traceability baseline passed

### Requirement: Single Kit render evidence uses real worker artifacts

Single Kit render evidence SHALL use `_worker` real conversion artifacts when validating the review-session path from IFC source to browser viewport. The evidence MUST include the conversion job ID and artifact group ID so the rendered stage can be traced back to the source IFC.

#### Scenario: Real worker artifact renders in browser

- **WHEN** a valid IFC is converted through `_worker`, routed through `bim-review-coordinator`, loaded by `bim-streaming-server`, and displayed in `web-viewer-sample`
- **THEN** the evidence records the source IFC identity, `conversion_job_id`, `artifact_group_id`, `model.usdc` URL, mapping URL, `openedStageResult`, non-zero video dimensions, and a viewport screenshot or equivalent visual proof

#### Scenario: Kit or GPU prerequisite is unavailable

- **WHEN** real conversion succeeds but Kit/GPU/browser verification cannot run in the current environment
- **THEN** the evidence records conversion success and marks single Kit render evidence as `blocked` with the missing runtime prerequisite

### Requirement: Batch storage IFC evidence calibrates mapping baseline

Runtime verification evidence SHALL include a batch conversion evidence tier for repo-local `storage/*.ifc` fixtures before declaring the mapping coverage baseline locked. The evidence MUST identify the fixture glob, resolved root, fixture count, per-fixture conversion job IDs, per-fixture artifact group IDs, USDC openability, source IFC entity count, mapped/unmapped entity counts, coverage ratio, `minimum_coverage_ratio=1.0`, coverage status, lineage API status, and whether all required fixtures passed.

The standard local Windows fixture glob is `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`. In worktrees and CI-like local runs, the same requirement MAY resolve through `_worker` `dev_storage_root` as repo-local `storage/*.ifc`, but the evidence MUST record the resolved path or approved exception.

#### Scenario: Full storage fixture batch passes

- **WHEN** all required `storage/*.ifc` fixtures complete real IFC->USDC conversion with openable USDC, truthful mapping output, lineage API success, and every source IFC entity mapped to at least one real USD prim path
- **THEN** the evidence records `minimum_coverage_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, per-fixture metrics, and the batch status as `passed`

#### Scenario: Storage fixture batch is incomplete

- **WHEN** the fixture root is unavailable, contains no IFC files, or only a subset was intentionally run
- **THEN** the evidence records `blocked` or `partial` with the missing prerequisite or subset reason and MUST NOT mark the production mapping baseline as locked

#### Scenario: One fixture fails baseline

- **WHEN** any required fixture fails conversion, USDC openability, truthful mapping checks, lineage API lookup, or locked coverage threshold
- **THEN** the batch evidence records the failed fixture and reason, and the overall batch status is not `passed`

### Requirement: Issue-to-real-prim evidence requires locked real mapping

Runtime verification evidence SHALL only classify issue-to-real-prim highlight baseline as verified when the worker mapping is real, coverage baseline is locked, and the highlighted prim path can be traced from an issue's IFC GUID through `element_mapping.json` to `primary_usd_prim_path` or `usd_prim_paths`.

#### Scenario: Issue highlight uses real mapping

- **WHEN** a reviewer or smoke test highlights an issue whose IFC GUID appears in real mapping output with a valid primary USD prim path
- **THEN** the evidence records the issue identifier, IFC GUID, mapped USD prim path, conversion job ID, artifact group ID, and `minimum_coverage_locked=true`

#### Scenario: Issue highlight uses fallback or missing mapping

- **WHEN** the highlighted issue path comes from fallback IDs, synthetic IDs, missing mapping, or an unlocked coverage baseline
- **THEN** the evidence MUST NOT classify issue-to-real-prim baseline as verified, even if the browser or Kit interaction itself succeeds
