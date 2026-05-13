# worker-demo-upload-convert-ui Specification

## Purpose
Define the `_worker` demo UI boundary for local artifact intake and conversion
steps. The UI supports IFC source selection, conversion job progress, artifact
group readiness, and handoff toward review session creation without replacing
the browser review viewer, session control plane, or review metadata editor.
## Requirements
### Requirement: Worker Demo UI Entry

`_worker` SHALL serve a demo UI on port `8005` at `GET /` and `GET /ui` for demo steps ① 上傳建模 and ② 自動轉換.

#### Scenario: Worker UI loads

- **WHEN** a user opens `http://127.0.0.1:8005/`
- **THEN** the worker demo UI SHALL render without requiring `_s3_storage` or `_conversion-service`

#### Scenario: Stepbar routes to worker

- **WHEN** any current demo stepbar renders steps ① or ②
- **THEN** those steps SHALL point to the worker demo UI instead of ports `8002` or `8003`

### Requirement: IFC Selection Experience

The worker demo UI SHALL show the available dev IFC sources from `GET /api/dev/ifc-sources` and allow exactly one source to be selected for conversion at a time.

#### Scenario: Sources are visible

- **WHEN** `GET /api/dev/ifc-sources` returns IFC source items
- **THEN** the UI SHALL display selectable rows or controls that identify each source by filename and relative path

#### Scenario: Empty source list is clear

- **WHEN** no IFC files are available
- **THEN** the UI SHALL show a friendly empty state and SHALL NOT show an enabled conversion action

### Requirement: Conversion Job Interaction

The worker demo UI SHALL trigger the selected-source conversion API and display job progress through worker status/result endpoints.

#### Scenario: User starts conversion

- **WHEN** the user selects an IFC source and activates the conversion action
- **THEN** the UI SHALL call `POST /api/dev/ifc-sources/{source_id}/conversions` and show the returned `conversion_job_id` and initial status

#### Scenario: Job status is polled

- **WHEN** a selected-source conversion job is running
- **THEN** the UI SHALL poll `GET /api/conversions/{conversion_job_id}` or `GET /api/conversions/{conversion_job_id}/result` until success, failure, or timeout

#### Scenario: Job succeeds

- **WHEN** the conversion job succeeds
- **THEN** the UI SHALL show artifact group readiness, the worker object URL for the converted model, and a next-step route toward review session creation

#### Scenario: Job fails

- **WHEN** the conversion job fails or times out
- **THEN** the UI SHALL show the failure state with enough service/status detail to diagnose the worker job without exposing absolute local file paths

### Requirement: Demo UI Boundary

The worker demo UI SHALL remain scoped to artifact intake and conversion, and SHALL NOT replace the browser review viewer or session control plane.

#### Scenario: Review workflow continues outside worker

- **WHEN** an artifact group becomes ready
- **THEN** the next user action SHALL route to `bim-review-coordinator` or the existing review viewer flow for session creation and streaming review

#### Scenario: No review metadata editing

- **WHEN** the worker demo UI renders
- **THEN** it MUST NOT provide issue editing, annotation editing, session lifecycle management, or WebRTC streaming controls

### Requirement: Worker UI visualizes lineage and quality status

Worker demo UI MUST 提供 worker artifacts 的 lineage 與 conversion quality view。UI 必須透過 `_worker` API 取得資料，例如 `GET /api/artifacts/{artifact_id}/lineage`、`GET /api/conversions/{conversion_job_id}/result`、`GET /api/artifact-groups/{artifact_group_id}/readiness`，不得直接讀取 local files。

此 view 必須限制在 artifact intake、conversion observability、lineage、quality evidence 與 review viewer handoff 範圍內。它不得提供 review issue editing、annotation editing、session lifecycle management、WebRTC streaming controls，也不得直接 render USD/USDC。

當 conversion result 包含可開啟的 `model.usdc`、stable artifact IDs 與 readiness data 時，worker UI 必須提供足夠資訊或明確 action，讓使用者可以透過既有 review viewer flow 開啟轉檔成果。該 handoff 必須保留 `conversion_job_id`、`artifact_group_id`、source artifact ID、derived USDC artifact ID 或 URL、mapping artifact ID 或 URL，以及 quality status。

#### Scenario: 使用者開啟 converted artifact 的 lineage

- **WHEN** conversion job 成功，且使用者開啟它的 lineage view
- **THEN** UI 顯示 source IFC、derived USDC、index artifacts、mapping artifact、stable artifact IDs、conversion job ID、artifact group ID、object URLs、metadata URL 與 quality status

#### Scenario: Quality status 可見

- **WHEN** lineage API 或 conversion result 回傳 quality metrics
- **THEN** UI 顯示 coverage ratio、`minimum_coverage_ratio`、baseline lock status、`coverage_denominator=source_ifc_entity_count`、mapped/unmapped IFC entity counts、coverage status，以及 warnings 或 diagnostics

#### Scenario: Warning quality 仍可進入 review

- **WHEN** lineage API 或 conversion result 回報 `coverage_status=warn`
- **THEN** UI 保留 review handoff，同時清楚顯示 mapping quality degraded，且不得把 issue-to-real-prim readiness 標示為 verified

#### Scenario: Lineage 不完整

- **WHEN** lineage API 回報 missing mapping、missing derived artifact、legacy metadata gaps 或 unavailable quality metrics
- **THEN** UI 顯示 incomplete state，不得隱藏 source artifact，也不得暴露 absolute local filesystem paths

#### Scenario: Converted USDC 提供 review viewer handoff

- **WHEN** conversion result 提供可開啟的 worker-produced `model.usdc`、artifact group readiness 與 lineage data
- **THEN** UI 提供 preview/open action 或等效 handoff data，將使用者導向 `bim-review-coordinator` 或既有 review viewer flow，並帶上載入 USDC 所需的 stable artifact IDs 與 URLs

#### Scenario: Worker UI 不直接 render USDC

- **WHEN** 使用者想檢視 converted `model.usdc`
- **THEN** worker UI 將使用者導向 review viewer / Kit path，且不得在 `_worker` 內 parse USD、render USDC、開啟 WebRTC stream 或管理 review session lifecycle

#### Scenario: Review workflow 維持在 worker UI 外

- **WHEN** artifact group ready，且 lineage 已在 worker UI 可見
- **THEN** 下一個 review action 仍導向 `bim-review-coordinator` 或既有 review viewer flow，worker UI 不管理 review sessions
