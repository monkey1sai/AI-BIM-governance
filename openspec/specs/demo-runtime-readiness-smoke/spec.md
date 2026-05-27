# demo-runtime-readiness-smoke Specification

## Purpose
Define a deterministic local demo runtime smoke/readiness contract that
classifies every prerequisite tier (worker conversion, review request,
coordinator session lifecycle, Socket.IO collaboration, Kit/WebRTC, browser
visual evidence, single-Kit render) before any verification report or task
list claims demo runtime success. The contract standardizes blocker
classification, owner boundaries, rerunnable commands, and evidence artifacts
so missing IFC fixtures, invalid smoke inputs, missing Kit launchers, blocked
browser automation, and deferred multi-Kit capacity surface as actionable
prerequisites rather than ambiguous demo failures.
## Requirements
### Requirement: Demo runtime smoke classifies prerequisites before claiming runtime success

The workspace SHALL provide a local demo runtime smoke/readiness path that
classifies each tier as `passed`, `failed`, `blocked`, `deferred`, or
`not_observed` before any verification report or task list claims demo runtime
success. The classification MUST include the responsible owner boundary and the
next rerunnable command or prerequisite when the tier is not passed.

#### Scenario: Missing dev IFC fixtures are blocked

- **WHEN** the smoke resolves `WORKER_DEV_STORAGE_ROOT` and finds no `.ifc` or `.IFC` files
- **THEN** the worker conversion tier is classified as `blocked`
- **AND** the evidence records the resolved root, fixture count, expected fixture source, and next setup command or action

#### Scenario: Invalid smoke fixture is rejected before success claims

- **WHEN** a smoke input cannot be parsed as an IFC model by the configured worker converter
- **THEN** the smoke records conversion `failed` or input `blocked` with the converter diagnostic
- **AND** it MUST NOT claim worker conversion readiness, review artifact readiness, Kit render success, or browser visual success

#### Scenario: Deferred multi-Kit capacity remains explicit

- **WHEN** fewer than two live GPU-backed Kit endpoints are available
- **THEN** dedicated multi-Kit runtime verification is classified as `deferred` or `blocked`
- **AND** the evidence MUST NOT classify dedicated runtime routing as `passed`

### Requirement: Demo runtime smoke separates service tiers

The demo runtime smoke SHALL report worker conversion readiness, review request
state, coordinator session lifecycle, Socket.IO collaboration, Kit WebRTC
readiness, and browser visual evidence as separate tiers. A pass in one tier
MUST NOT imply pass in another tier.

#### Scenario: Coordinator lifecycle passes while model is missing

- **WHEN** coordinator creates, returns, and closes a review session whose stream config reports `model.status=missing`
- **THEN** coordinator lifecycle MAY be classified as `passed`
- **AND** worker artifact readiness, Kit render readiness, and browser visual evidence remain non-passed unless their own evidence exists

#### Scenario: Socket collaboration passes independently

- **WHEN** Socket.IO join, presence, selection, annotation, or broadcast smoke succeeds
- **THEN** Socket.IO collaboration MAY be classified as `passed`
- **AND** the evidence MUST NOT treat Socket.IO success as proof of WebRTC video or DataChannel stage loading

#### Scenario: Worker conversion success records artifact identities

- **WHEN** worker conversion readiness is classified as `passed`
- **THEN** evidence records `source_artifact_id`, `artifact_group_id`, `conversion_job_id`, derived `model.usdc` URL or artifact ID, mapping URL or artifact ID, and readiness state

### Requirement: Kit and browser readiness evidence is explicit

The demo runtime smoke SHALL only classify Kit/WebRTC or browser visual tiers
as `passed` when a live Kit endpoint and browser evidence prove the behavior.
Missing launchers, closed ports, unavailable GPU runtime, or blocked browser
automation MUST remain explicit blockers.

#### Scenario: Missing Kit launcher is blocked

- **WHEN** `bim-streaming-server` preflight cannot find the expected built Kit launcher
- **THEN** Kit/WebRTC readiness is classified as `blocked`
- **AND** evidence records the missing launcher path and build or preflight command needed to retry

#### Scenario: WebRTC port is not listening

- **WHEN** the expected Kit signaling endpoint such as `127.0.0.1:49100` is not listening
- **THEN** single Kit WebRTC readiness is classified as `blocked`
- **AND** browser visual evidence MUST remain non-passed

#### Scenario: Browser visual pass requires viewport proof

- **WHEN** browser visual readiness is classified as `passed`
- **THEN** evidence records browser URL, `session_id` or `review_request_id`, Kit endpoint, video readiness, non-zero video dimensions, DataChannel stage-load result when available, and a screenshot path or equivalent visual proof

#### Scenario: Browser automation is blocked by policy

- **WHEN** browser automation cannot open the local viewer route because of tool or policy restrictions
- **THEN** browser visual readiness is classified as `blocked` or `not_observed`
- **AND** evidence records the blocked URL, policy/tool diagnostic, and acceptable manual evidence fields for rerun

### Requirement: Demo runtime smoke emits reviewable evidence artifacts

The demo runtime smoke SHALL emit or update structured evidence artifacts that
can be referenced from verification reports and roadmap updates. Evidence MUST
be sufficient for reviewers to distinguish current live observations from
historical context.

#### Scenario: Command summary is written

- **WHEN** the demo runtime smoke completes or stops on a blocker
- **THEN** it writes a command summary artifact that records command, working directory, status, important IDs, blocker classification, and evidence paths for each tier that ran

#### Scenario: Historical evidence is not promoted to current pass

- **WHEN** a runtime tier did not run in the current pass
- **THEN** the evidence may link historical context
- **AND** it MUST classify the current tier as `not_observed`, `blocked`, or `deferred` rather than `passed`

#### Scenario: Reports cite evidence artifacts

- **WHEN** a verification report or roadmap update summarizes demo runtime readiness
- **THEN** it references the current evidence artifact paths and preserves the tier statuses without merging them into one ambiguous end-to-end status

### Requirement: Single-Kit demo runtime renders the optimized USDC and captures viewport proof

The demo runtime smoke SHALL drive a single-Kit happy-path that renders the
`model.usdc` produced by the completed
`optimize-worker-non-renderable-materialization` change in
`web-viewer-sample`. Kit MUST be launched with `-SkipAutoLoad`; the viewer
MUST issue `openStageRequest` via DataChannel using
`stream_config.model.url`. When the happy-path succeeds, a
`single_kit_render` evidence tier MUST be classified as `passed` with
viewport proof. Multi-Kit dedicated routing remains out of scope and MUST
NOT be claimed as `passed` by this tier.

#### Scenario: Kit launches in skip-auto-load and viewer drives stage load

- **WHEN** the single-Kit demo runtime starts and the viewer joins the review session
- **THEN** Kit is launched with `-SkipAutoLoad` and the viewer issues `openStageRequest` carrying `stream_config.model.url`
- **AND** Kit MUST NOT receive worker `model.usdc` URLs through `-UsdPath` or any other launch argument

#### Scenario: Single-Kit viewport proof is captured

- **WHEN** `single_kit_render` is classified as `passed`
- **THEN** evidence records the viewer URL, `session_id` or `review_request_id`, Kit endpoint, video width and height as non-zero values, DataChannel stage-load result, and a screenshot path (manual or automated)
- **AND** the screenshot MUST correspond to the canonical optimized `model.usdc` from the active worker conversion job

#### Scenario: Missing prerequisites keep single-Kit render blocked

- **WHEN** the Kit launcher is missing, the signaling port is not listening, GPU preflight fails, or the worker has no successful `model.usdc` available for the canonical fixture
- **THEN** `single_kit_render` is classified as `blocked` with the missing prerequisite, the resolved next command, and (when applicable) the missing artifact identity
- **AND** the tier MUST NOT be classified as `passed`

#### Scenario: Multi-Kit dedicated routing stays deferred

- **WHEN** only one GPU-backed Kit endpoint exists in the workspace
- **THEN** dedicated multi-Kit routing remains classified as `deferred`
- **AND** `stream_config.kit_instance_bindings` contains at most one binding, and a `single_kit_render=passed` evidence record MUST NOT be promoted to dedicated multi-Kit success

### Requirement: Web viewer surfaces a conversion summary card sourced from existing endpoints

The `web-viewer-sample` SHALL display a conversion summary card whenever
`stream_config.model.status == "ready"` and a successful conversion result
is available. The card MUST source data from existing coordinator or worker
endpoints only and MUST NOT cache, recompute, or persist quality metrics in
the viewer.

#### Scenario: Card renders when stream_config carries a ready model

- **WHEN** `stream_config.model.status == "ready"` and the coordinator forwards `quality_metrics_summary`
- **THEN** the viewer card displays fixture identity, `source_ifc_entity_count`, `sidecar_carrier_count`, `materialization_strategy`, `coverage_ratio`, `coverage_status`, and `conversion_duration_seconds`
- **AND** the displayed values match the corresponding fields in `GET /api/conversions/{conversion_job_id}/result`

#### Scenario: Card shows degraded state when conversion is not ready

- **WHEN** `stream_config.model.status` is not `"ready"`, or no successful conversion result exists for the active session
- **THEN** the viewer card displays a degraded state with the current `model.status`, the blocker classification surfaced from smoke evidence (when available), and the next rerunnable command or prerequisite
- **AND** the card MUST NOT display stale or fabricated quality values

#### Scenario: Card uses dev-only fallback fetch when coordinator did not forward summary

- **WHEN** the coordinator did not forward `quality_metrics_summary` and the viewer is running in dev mode (for example `import.meta.env.DEV` is true)
- **THEN** the viewer MAY fetch `GET /api/conversions/{conversion_job_id}/result` from `_worker` for read-only display
- **AND** in production builds, the fallback MUST be unreachable and the card MUST render the degraded state from the previous scenario
- **AND** the viewer MUST NOT write back, transform, or rebroadcast the fetched values

### Requirement: Demo runtime smoke includes B-scheme conversion tiers

Demo runtime smoke SHALL 獨立分類 B 方案各層級，且 SHALL NOT 依賴已刪除的
`_worker` / `_bim-control` 服務。預設 smoke SHALL 以 contract stub
（`tests/fakes` + `tests/contracts`）呼叫唯一外部入口 `bim-review-coordinator`
`POST /api/external/ifc-ready`，並分類：`external_ifc_ready_intake`、
`streaming_internal_conversion`、`mapping_quality`、`cloud_callback_outbox`、
`coordinator_session_lifecycle`、`runtime_image_kit_launcher`、`single_kit_render`、
`single_kit_multi_viewer`、`usd_stage_composition`。外部客戶落地端 IFC Worker 與
公司雲端 `bim-control` 皆為外部系統，只能由 test fixtures 模擬，不得作為服務啟動。

#### Scenario: External IFC-ready intake passes but streaming conversion is missing

- **WHEN** contract stub（test-only 外部 IFC Worker double）對 `bim-review-coordinator` `POST /api/external/ifc-ready` 送出符合規格的 `ifc_ready`，但 `bim-streaming-server` internal conversion 未監聽
- **THEN** `external_ifc_ready_intake` MAY 為 `passed`
- **AND** `streaming_internal_conversion` 為 `blocked` 或記錄為 `dispatch_failed`
- **AND** downstream render tiers 維持非 passed

#### Scenario: Streaming conversion passes without WebRTC

- **WHEN** `bim-streaming-server` internal conversion job 產生有效 USDC 與 mapping，但 Kit/WebRTC endpoint 未監聽
- **THEN** `streaming_internal_conversion` 與 `mapping_quality` MAY 為 `passed`
- **AND** `single_kit_render` 維持 `blocked` 或 `not_observed`

#### Scenario: Cloud callback outbox is classified independently of conversion

- **WHEN** internal conversion 成功，但公司雲端 callback endpoint 不可達（OQ1 pending：真實 endpoint 維持 `pending`）
- **THEN** `streaming_internal_conversion` MAY 為 `passed`
- **AND** `cloud_callback_outbox` 會記錄 retained-and-retried，重試耗盡後進入 `dead_letter`，不得 silent drop
- **AND** conversion result 仍可在本地查詢，不受 callback delivery 影響

#### Scenario: Kit launcher prerequisite missing is deferred, not passed

- **WHEN** runtime image 已驗證產出的 Linux Kit launcher，但 NVIDIA graphics / Vulkan / GPU / Kit license 前置條件不可用
- **THEN** `runtime_image_kit_launcher` 為 `deferred` 並記錄原因
- **AND** 它 MUST NOT 為 `passed`，且 host-local Kit MUST NOT 被當作替代 pass

#### Scenario: Historical mock evidence is not promoted

- **WHEN** 存在歷史 `_worker` / `_bim-control` evidence，但目前這次 pass 沒有執行 B 方案 contract-stub run
- **THEN** B 方案 tiers MUST 為 `not_observed`、`blocked` 或 `deferred`
- **AND** 它們 MUST NOT 為 `passed`

### Requirement: Demo smoke records authority boundary in evidence

Every evidence record for conversion readiness SHALL include the owning service boundary.

#### Scenario: Conversion result is streaming-owned

- **WHEN** streaming conversion job passes
- **THEN** evidence records `conversion_authority="bim-streaming-server"`, `conversion_job_id`, derived artifact IDs, mapping artifact ID, and quality metrics summary

### Requirement: Demo smoke classifies host-native conversion authority independently

Demo runtime smoke SHALL include a `host_native_conversion_authority` tier for the local `127.0.0.1:49101` conversion service. This tier SHALL be evaluated independently from coordinator health, callback outbox delivery, Kit/WebRTC `49100`, DataChannel stage loading, and browser visual evidence.

#### Scenario: Host-native conversion service passes while WebRTC is blocked

- **WHEN** `127.0.0.1:49101` is healthy and a contract-correct IFC-ready flow produces a streaming-owned conversion result
- **THEN** `host_native_conversion_authority` MAY be classified as `passed`
- **AND** `single_kit_render`, WebRTC, and browser visual tiers remain `blocked`, `deferred`, or `not_observed` unless their own evidence exists

#### Scenario: Conversion service is down

- **WHEN** coordinator and viewer are running but `127.0.0.1:49101` is not reachable
- **THEN** `host_native_conversion_authority` is classified as `blocked` or `failed`
- **AND** evidence records the target URL, expected start command, working directory, and diagnostic

#### Scenario: Viewer ready gate is preserved during smoke

- **WHEN** stream config reports `model.status` other than `"ready"`
- **THEN** viewer smoke MUST NOT count `openStageRequest` as expected behavior
- **AND** it records that the ready gate prevented stage loading

### Requirement: Smoke evidence records Windows host-native environment traps

Smoke and runbook output SHALL record the shell, working directory, port, PID or process command, and converter prerequisite status for host-native conversion service checks. Windows `.bat` / Kit tooling launch instructions SHALL prefer PowerShell when `.bat` execution is required.

#### Scenario: Git Bash is used for a batch launcher

- **WHEN** a smoke or manual validation attempts to run a `.bat` / Kit repo launcher from Git Bash and it fails before service startup
- **THEN** the evidence classifies the failure as an environment or shell blocker when appropriate
- **AND** the next rerunnable command uses PowerShell with the correct working directory

#### Scenario: Converter prerequisite is missing

- **WHEN** the host-native service starts but converter preflight fails
- **THEN** the conversion tier records `blocked` with the missing prerequisite
- **AND** it MUST NOT claim mapping quality or ready model evidence

### Requirement: Demo smoke verifies LAN handoff and same-session multi-viewer evidence

Demo runtime smoke SHALL include a same-session LAN multi-viewer tier that verifies both browser-visible handoff and concurrent viewer evidence for one ready review session. This tier SHALL be evaluated after the existing single-viewer closed loop has a ready session and Kit/WebRTC endpoint.

The smoke SHALL preserve separate statuses for `viewer_handoff_lan_url`, `single_kit_multi_viewer`, and `dedicated_multi_kit`. A pass in LAN handoff or single-Kit multi-viewer MUST NOT imply dedicated multi-Kit pass.

#### Scenario: LAN viewer URL is browser-visible

- **WHEN** a ready IFC-ready job exposes `viewer_url`
- **THEN** the smoke verifies that `/ui/open?session=<review_session_id>` redirects to the configured viewer host
- **AND** the redirect target does not use `127.0.0.1` unless the smoke explicitly runs in localhost-only mode

#### Scenario: Two viewers open one session

- **WHEN** the smoke opens two browser pages for the same coordinator-generated viewer URL
- **THEN** both pages use the same `review_session_id`
- **AND** both pages report non-error session bootstrap
- **AND** the evidence records participant/viewer count, Kit endpoint, expected stage URL, and per-page WebRTC readiness

#### Scenario: Webwright captures reviewable screenshots

- **WHEN** the same-session multi-viewer smoke is executed with Microsoft Webwright
- **THEN** the output artifact includes per-viewer screenshots, logs, target URLs, `review_session_id`, and pass/fail classification
- **AND** the screenshot paths are referenced from the change verification summary

#### Scenario: Single-Kit failure remains actionable

- **WHEN** the second viewer cannot obtain WebRTC video or stage match from the same Kit endpoint
- **THEN** the smoke classifies `single_kit_multi_viewer` as `failed` or `blocked`
- **AND** the evidence records the failure code, browser diagnostics, and whether the next fix is viewer handoff, coordinator session state, or Kit/WebRTC runtime behavior
