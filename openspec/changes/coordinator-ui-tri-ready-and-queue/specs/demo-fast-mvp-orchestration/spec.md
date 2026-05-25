# demo-fast-mvp-orchestration — Spec Delta (coordinator-ui-tri-ready-and-queue)

> Delta against `openspec/specs/demo-fast-mvp-orchestration/spec.md`。
> 本 change 把 `bim-review-coordinator` `/ui` runtime dashboard 加三段 ready 分層
> 與 dispatch queue 可視化,並把 step 文案改為 Edge BIM Data Server Console 命名。

## ADDED Requirements

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

## MODIFIED Requirements

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
