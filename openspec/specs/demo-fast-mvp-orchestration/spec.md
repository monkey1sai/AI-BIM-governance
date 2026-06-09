# demo-fast-mvp-orchestration Specification

## Purpose
TBD - created by archiving change recap. Update Purpose after archive.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` ADD 2 個 requirements:`Coordinator /ui provides 3-card single-column fast-mvp happy path`(`fastIfcReadyCard` + `fastJobProgressCard` + `fastViewerLinkCard` 在 `dev-console.html` main 開頭)、`Postman collection mirrors external caller flow`(`docs/postman/fast-ifc-link-demo.postman_collection.json` + README 3 個 requests),並對既有 `Fast MVP demo runbook lives in repo and is grep-verifiable` requirement 加 implementation status note(coordinator `/ui` 3 卡 + Postman 作為主路徑,既有 PowerShell scripts 仍保留)。完整 ADD scenarios 見 `openspec/changes/archive/2026-05-21-fast-ifc-link-demo-loop/specs/demo-fast-mvp-orchestration/spec.md`。實作:`bim-review-coordinator/src/public/dev-console.html` + `docs/postman/`。
## Requirements
### Requirement: Repository SHALL provide a single fast MVP demo runbook

The repository SHALL provide one canonical fast MVP demo runbook at `docs/demo/fast-mvp-demo-recap.md` that consolidates the launch order, port matrix, host vs container boundary, WSL Kit graphics constraint, sample-fixture selection rules, and acceptance criteria required to run a single-host demo of the coordinator + streaming-server + viewer closed loop using only repo-resident services and `tests/fakes` doubles.

#### Scenario: A new operator finds the demo runbook from the repo root

- **WHEN** a new operator looks for "how do I demo this" starting from the repo root
- **THEN** `README.md` SHALL cross-link to `docs/demo/fast-mvp-demo-recap.md`
- **AND** product requirement docs (`docs/plans/ai-bim-governance-設計規格.md` / `docs/plans/ai-bim-governance-prototype.html`) SHALL NOT replace the demo runbook
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

### Requirement: Fast MVP runbook SHALL include hybrid Docker web-plane path

Fast MVP documentation and `/ui` runtime dashboard SHALL distinguish the Docker web-plane from the host-native Kit/WebRTC plane. The dashboard SHALL show that `8004` and `5173` may be containerized while `49100` / `47998` / `49101` remain host-native for this demo path.

#### Scenario: Dashboard shows hybrid boundary

- **WHEN** the hybrid Docker web-plane mode is running
- **THEN** `/ui` displays coordinator/viewer service reachability separately from Kit/WebRTC and conversion authority reachability
- **AND** it MUST NOT imply that a healthy Docker web-plane proves GPU/Kit viewport readiness

### Requirement: Coordinator /ui provides closed-loop runtime dashboard

`bim-review-coordinator` `/ui` SHALL continue to support the fast MVP happy
path for submitting an IFC-ready payload, polling the job, and opening the
viewer. In addition, `/ui` SHALL present a first-viewport runtime dashboard
that separates IFC-ready intake, IFC download, internal conversion job,
artifact readiness, review session binding, Kit/WebRTC endpoint state, and
viewer/session participation. The dashboard MUST NOT treat a stale
`/api/assets` demo entry as proof that the current session has loaded the
current conversion artifact, and MUST mark any legacy `/api/assets` rendering
with an explicit disclaimer.

#### Scenario: Operator sees IFC-ready and download state

- **WHEN** an operator opens `/ui` after or during a `POST /api/external/ifc-ready` run
- **THEN** the dashboard displays the current or recent `ifc_ready_job_id`, `source_ifc_ref`, `download_status`, `download_failure`, `local_path`, and `host_local_path`
- **AND** it distinguishes `pending`, `downloading`, `downloaded`, and `failed`

#### Scenario: Operator sees conversion job state

- **WHEN** an IFC-ready job has been dispatched to `bim-streaming-server`
- **THEN** the dashboard displays `conversion_job_id`, `conversion_status`, `conversion_authority`, `artifact_manifest_ref`, `model.usdc` URL, mapping URL, and quality summary when available
- **AND** it distinguishes conversion readiness from viewer/render readiness

#### Scenario: Operator sees review session and viewer state

- **WHEN** coordinator has created a local review session for a ready conversion
- **THEN** the dashboard displays `review_session_id`, `viewer_url`, participant count, configured Kit endpoint, and viewer/open status fields
- **AND** it makes clear which `model.usdc` URL is the expected stage for that session

#### Scenario: Stale demo asset is visible only as debug context with disclaimer

- **WHEN** `/api/assets` still contains legacy demo assets such as `許良宇圖書館建築_2026.usdc`
- **THEN** those assets MAY appear in a debug/details section or selector
- **AND** the section SHALL include an explicit disclaimer indicating these are
  legacy demo assets that DO NOT represent the current session model
- **AND** the dashboard MUST NOT mark the current closed-loop run as passed
  because a legacy demo asset is visible or rendered

### Requirement: Coordinator /ui dashboard surfaces three-tier readiness

`bim-review-coordinator` `/ui` dashboard SHALL display three discrete readiness
tiers — **File ready**, **Runtime ready**, and **Semantic ready** — instead of
a single conflated `ready` label, so operators cannot mistake a downloaded
conversion artifact for verified IFC semantics. The three-tier calculation
SHALL use the same field source as `session-first-review-viewer`
(`stream_config.quality_metrics_summary` 加 `semantic_mapping_fidelity` /
`mapping_has_ifc_type` / `mapping_has_ifc_name`,C1 提供),以確保 viewer 與
dashboard 對同一 job 永不顯示矛盾的 ready 狀態。

#### Scenario: Dashboard shows three-tier readiness badges

- **WHEN** an operator opens `/ui` for a running ifc-ready job
- **THEN** the dashboard SHALL display three independent badges:File ready
  (`yes` / `no`)、Runtime ready(`yes` / `incomplete` / `no`)、Semantic
  ready(`yes` / `incomplete` / `no`)
- **AND** the badges MUST NOT be merged into a single `ready` label
- **AND** Semantic ready SHALL derive from `quality_metrics_summary.semantic_mapping_fidelity`
  + `mapping_has_ifc_type` + `mapping_has_ifc_name`;若任一不存在 SHALL 顯示
  `incomplete`,不偽宣告為 `yes`

#### Scenario: Dashboard readiness aligns with viewer readiness on Semantic tier

- **WHEN** dashboard 與 viewer 對同一 session 觀察 Semantic ready
- **THEN** 兩端 SHALL 從同一份 `quality_metrics_summary` 欄位來源計算
  (`semantic_mapping_fidelity` / `mapping_has_ifc_type` / `mapping_has_ifc_name`,
  C1 提供;dashboard 透過 `/api/review-sessions/:id/stream-config` 取得,
  與 viewer `getStreamConfig` 相同 endpoint)
- **AND** terminal happy-path 狀態(conversion 已 ready、quality summary 已寫入)
  兩端 SHALL 顯示一致的 Semantic ready 值
- **AND** transient race(例如 conversion 剛 ready 但 dashboard 還沒 refresh)
  允許短暫不一致;不視為違反 spec
- **NOTE**:File ready 與 Runtime ready 屬於不同視角(dashboard 看 server-side
  proxy 狀態如 `download_status`、`viewer_url`;viewer 看 client-runtime
  evidence 如 WebRTC `started`、`stageLoadStatus="matched"`),terminal 狀態必然
  存在 timing gap。兩端對 server-side 角度的 happy-path 不衝突;但 Runtime tier
  允許 dashboard 在 viewer 連上前先標 `yes`(viewer_url 已產生),這屬於
  server-side proxy view 的正確語意,不視為兩端矛盾

### Requirement: Coordinator /ui dashboard renames demo steps

`bim-review-coordinator` `/ui` dashboard SHALL display the following four step
titles, in order, instead of the legacy 「審查 demo」字樣:

1. ① 接收 IFC-ready webhook
2. ② 產生本機 USDC 資料包
3. ③ 啟動 Kit / WebRTC 串流
4. ④ 驗證 BIM 語意對照

#### Scenario: Step titles use Edge BIM Data Server Console naming

- **WHEN** operator opens `/ui`
- **THEN** the dashboard SHALL contain literal substrings「① 接收 IFC-ready
  webhook」/「② 產生本機 USDC 資料包」/「③ 啟動 Kit / WebRTC 串流」/
  「④ 驗證 BIM 語意對照」
- **AND** dashboard MUST NOT use legacy 字樣「審查問題」/「標註」/「多人協作」/
  「issue」/「annotation」as primary step labels

### Requirement: Coordinator /ui dashboard shows conversion dispatch queue

`bim-review-coordinator` `/ui` dashboard SHALL surface the conversion dispatch
queue state introduced by `coordinator-serial-conversion-dispatch-queue`(C4):
it SHALL distinguish in-flight from queued ifc-ready jobs, show 1-based
`queue_position` for queued jobs, and clearly mark
`dropped_on_restart` jobs with a runbook hint that operator must re-POST.

#### Scenario: Dashboard distinguishes in-flight from queued

- **WHEN** multiple ifc-ready jobs are present and at least one is mid-dispatch
- **THEN** the dashboard SHALL render a queue section that lists the in-flight
  job separately from the queued list
- **AND** queued jobs SHALL each show their `queue_position`(1-based)

#### Scenario: Dropped-on-restart jobs are marked with runbook hint

- **WHEN** an ifc-ready job has `status="dropped_on_restart"`
- **THEN** the dashboard SHALL render that job with a visible disclaimer
  indicating coordinator restart dropped the in-memory queue and operator
  must re-POST
- **AND** the disclaimer SHALL reference the in-memory(non-persistent)nature
  of the queue

