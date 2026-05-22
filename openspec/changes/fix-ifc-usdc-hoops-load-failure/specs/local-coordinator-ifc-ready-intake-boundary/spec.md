# local-coordinator-ifc-ready-intake-boundary — Spec Delta (fix-ifc-usdc-hoops-load-failure)

> Delta against `openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md`。本 change 補足 coordinator 對 IFC-ready job 列表與 runtime dashboard 的 read-only 可觀測 API，不改變 coordinator 非轉檔權威的邊界。

## MODIFIED Requirements

### Requirement: Coordinator GET job endpoint exposes download and viewer state

`bim-review-coordinator` SHALL expose IFC-ready job state sufficient for `/ui` and operators to understand the closed-loop progress. In addition to `GET /api/external/ifc-ready/{jobId}`, the coordinator MAY expose a read-only job listing endpoint for recent in-memory jobs. The listing MUST include download, dispatch, conversion, callback, and viewer/session references, but MUST NOT include IFC bytes or generated model bytes.

#### Scenario: Operator lists recent IFC-ready jobs

- **WHEN** `/ui` requests recent IFC-ready jobs
- **THEN** the coordinator returns recent jobs with `ifc_ready_job_id`, `download_status`, `conversion_job_id`, `conversion_status`, `artifact_manifest_ref`, `web_view_session_id`, `viewer_url`, and timestamps
- **AND** the response omits model bytes and secrets

#### Scenario: Job listing preserves intake boundary

- **WHEN** a job has `download_status="downloaded"` and `conversion_status="ready"`
- **THEN** the listing still treats source IFC bytes as external/data-plane artifacts and generated USDC as streaming-owned artifacts
- **AND** coordinator remains a metadata/control-plane observer, not a converter or renderer

### Requirement: Coordinator provides /ui/open redirect for viewer entry

The coordinator SHALL provide viewer entry URLs and runtime status that make the host/browser boundary explicit. `GET /ui/open?session=` MAY still redirect to the browser-visible viewer URL, but `/ui` MUST show the actual viewer URL, expected stage URL, and the current Kit endpoint before the operator opens the viewer.

#### Scenario: UI exposes expected viewer handoff

- **WHEN** a conversion-ready job has a review session
- **THEN** `/ui` displays the coordinator URL, the browser-visible viewer URL, the expected stage URL, and the Kit endpoint
- **AND** it warns when the expected stage URL has not yet been proven as loaded by Kit

### Requirement: Coordinator exposes read-only runtime status for dashboard observability

`bim-review-coordinator` MAY expose a read-only runtime status endpoint to support `/ui` dashboard observability. The endpoint SHALL summarize coordinator-visible sessions, participants, configured Kit endpoints, and optional host-native runtime observations. It SHALL NOT parse or render USD/USDC and SHALL NOT become the source of truth for Kit internal stage state.

#### Scenario: Runtime status summarizes sessions and Kit endpoints

- **WHEN** `/ui` requests runtime status
- **THEN** the response includes configured Kit endpoints, session count, active participant count, and known `kit_instance_bindings`
- **AND** any host port/log observations are labeled as observations, not authoritative Kit state

#### Scenario: Runtime status reports WebRTC evidence separately

- **WHEN** recent Kit/WebRTC evidence indicates disconnects or busy frame drops
- **THEN** the dashboard displays that as WebRTC evidence
- **AND** it does not change conversion job readiness

