# session-first-review-viewer Specification

## Purpose
Define the session-first browser review experience for `web-viewer-sample`.
The viewer bootstraps from review request/session state, respects lifecycle
transitions, sends USD runtime commands through the Kit DataChannel, sends
collaboration events through coordinator contracts, and exposes multi-artifact
review controls without becoming a data authority or GPU runtime manager.
## Requirements
### Requirement: Viewer bootstraps from review request or session

`web-viewer-sample` SHALL bootstrap from the coordinator review session and SHALL
treat `stream_config.stage_composition.primary.url` (or
`stream_config.model.url` when no primary composition exists) as the expected
stage URL for the session. The viewer MUST accept the coordinator handoff query
key `session` and legacy `sessionId`, and MUST NOT create a new default session
when a valid `session` query value is present. The viewer MUST NOT render the
`USDAsset` picker or `USDStage` tree by default; these debug surfaces SHALL be
gated behind the `?debug=1` query parameter.

When the coordinator handoff includes `coordinatorApiBase` and `coordinatorSocketUrl`, the viewer SHALL use those browser-visible endpoints before falling back to Vite environment variables or localhost defaults. A remote client opening a coordinator-provided viewer URL MUST NOT silently call its own `127.0.0.1:8004` for session or socket state.

The viewer MUST NOT expose a Vite environment override that lets the browser bypass the coordinator boundary toward a separate bim-control host; any review-metadata API base SHALL resolve to the coordinator API base. When stream config provides multiple Kit instance bindings, the viewer SHALL select the spectator endpoint by the explicit `viewport_sharing.primary_kit_instance_id` identity rather than by implicit transport-port difference.

#### Scenario: Coordinator handoff uses session query key

- **WHEN** a browser opens `http://<viewer-host>:5173/?session=<review_session_id>`
- **THEN** the viewer loads that coordinator session
- **AND** it MUST NOT ignore the query key and auto-create an unrelated session

#### Scenario: Handoff endpoint overrides localhost defaults

- **WHEN** a browser opens a coordinator-generated viewer URL with `coordinatorApiBase=http://192.168.10.105:8004` and `coordinatorSocketUrl=http://192.168.10.105:8004`
- **THEN** the viewer uses those endpoints for REST and Socket.IO calls
- **AND** it MUST NOT fall back to `http://127.0.0.1:8004` for that session

#### Scenario: Expected stage URL is derived from stream config

- **WHEN** stream config returns a ready model and stage composition primary
  binding
- **THEN** the viewer records the expected stage URL from the primary binding
- **AND** `openStageRequest` targets that URL
- **AND** the viewer displays the expected conversion job and model URL for
  operator inspection

#### Scenario: USDAsset picker is hidden without ?debug=1

- **WHEN** viewer 載入 `?session=<id>` 但沒有 `?debug=1`
- **THEN** USDAsset 下拉 / USDStage tree / DataChannel log 等 debug 區段
  SHALL NOT 渲染進主畫面 DOM
- **AND** Inspector 第四層「技術細節」標籤 SHALL 顯示「`?debug=1` 啟用以查看」

#### Scenario: USDAsset picker is visible with ?debug=1

- **WHEN** viewer 載入 `?session=<id>&debug=1`
- **THEN** Inspector 第四層「技術細節」SHALL 展開
- **AND** USDAsset 下拉 / USDStage tree / DataChannel log 等 debug 區段 SHALL
  渲染進主畫面 DOM(操作 legacy asset 仍視為 debug,與 session expected stage
  mismatch 時顯示警示)

#### Scenario: Spectator binding is selected by explicit primary identity

- **WHEN** stream config 提供多個 `KitInstanceBinding` 且 `viewport_sharing.primary_kit_instance_id` 指向其中一個
- **THEN** viewer SHALL 以 `kit_instance_id === viewport_sharing.primary_kit_instance_id` 顯式判定 primary,spectator endpoint 取非 primary 的 binding
- **AND** viewer MUST NOT 僅靠「transport port 與 primary 不同」的隱性挑選決定 spectator binding
- **AND** 當 `primary_kit_instance_id` 缺失時 SHALL 退回 port-diff fallback(向後相容)

#### Scenario: bim-control endpoint cannot bypass coordinator boundary

- **WHEN** viewer 解析 review-metadata / bim-control API base
- **THEN** 該 base SHALL 永遠等於 coordinator API base(query handoff 優先,其次 Vite env coordinator 值)
- **AND** 設定 `VITE_BIM_CONTROL_API_BASE` 指向獨立 host MUST NOT 讓前端繞過 coordinator boundary

### Requirement: Viewer displays artifact and lifecycle state

The review page SHALL present the current artifact readiness, mapping
readiness, session lifecycle, and Kit binding readiness needed for a reviewer
to understand whether streaming and issue highlighting are available.
Readiness SHALL be displayed in three discrete tiers — **File ready**,
**Runtime ready**, and **Semantic ready** — instead of a single conflated
`ready` label, so operators cannot mistake a matched stage URL for verified
IFC semantics.

#### Scenario: Artifact is ready for review

- **WHEN** artifact and mapping bindings are ready
- **THEN** the viewer enables review interactions using the session stream
  config

#### Scenario: Artifact is blocked by conversion

- **WHEN** the review request has `status=blocked_conversion`
- **THEN** the viewer shows a blocked state and does not attempt a WebRTC
  connection

#### Scenario: Session is queued for GPU

- **WHEN** the review request or session has `status=queued_for_instance`
- **THEN** the viewer shows capacity waiting state and does not claim streaming
  is ready

#### Scenario: Session is queued for conversion dispatch

- **WHEN** the review request or session has `status=queued_for_conversion`
  (C4 lifecycle:downloaded 後等待 in-flight dispatch slot)
- **THEN** the viewer 顯示「等待轉檔輪到」加上 `queue_position`(若可取得)
- **AND** viewer MUST NOT attempt a WebRTC connection
- **AND** viewer SHALL 持續 poll session 直到 lifecycle 轉成 `converting` /
  `dispatched` / `ready` / 任一 terminal status

#### Scenario: Tri-ready status displayed separately

- **WHEN** viewer 渲染主畫面 lifecycle / readiness UI
- **THEN** UI SHALL 顯示三個獨立 ready 標籤:File ready(`yes` / `no`)、
  Runtime ready(`yes` / `no`)、Semantic ready(`yes` / `incomplete` / `no`)
- **AND** UI MUST NOT 合併三段 ready 成單一 `ready` 字樣
- **AND** Semantic ready SHALL 來自 `quality_metrics_summary.semantic_mapping_fidelity`
  / `mapping_has_ifc_type` / `mapping_has_ifc_name`(C1 欄位);任一不存在
  SHALL 顯示 `incomplete`,不偽宣告為 `yes`

### Requirement: Viewer handles lifecycle transitions safely

`web-viewer-sample` SHALL handle WebRTC stream lifecycle transitions explicitly. AppStreamer `onStop`, `onTerminate`, and stream failure callbacks MUST update visible state and provide a controlled reconnect or remount path instead of only logging to the console. Background readiness polling SHALL be bounded and cancellable, stream teardown SHALL use the public SDK terminate API, and external streaming SDK loading SHALL fail safe without crashing the page.

#### Scenario: WebRTC stream disconnects

- **WHEN** AppStreamer stops or terminates after a stream was visible
- **THEN** the viewer displays `webrtc_disconnected` with the last known video diagnostics and Kit endpoint
- **AND** it offers a reconnect/remount action or records that a Kit runtime restart is required

#### Scenario: Reload does not require killing Chrome

- **WHEN** the user reloads the viewer after a disconnect
- **THEN** the viewer attempts to create a clean WebRTC client lifecycle for the same session
- **AND** if reconnect cannot succeed because Kit remains busy or disconnected, the viewer shows a deterministic blocker instead of silently hanging

#### Scenario: Session readiness polling is bounded

- **WHEN** viewer poll session readiness 連續收到非就緒回應或 transient 錯誤
- **THEN** viewer SHALL 在達 `MAX_POLL_RETRIES` 上限後停止重排,呼叫 reset 並顯示逾時錯誤狀態
- **AND** poll 的 catch 分支 MUST NOT 靜默殺死整條 poll 而無 UI 回饋
- **AND** viewer MUST NOT 無上限地持續重排 readiness poll

#### Scenario: Stream teardown uses the public SDK terminate API

- **WHEN** viewer 在 unmount 或 stop 時拆除 WebRTC stream
- **THEN** viewer SHALL 呼叫 AppStreamer 的公開 `terminate(false)` 釋放 client 端 stream
- **AND** viewer MUST NOT 透過存取私有成員(如 `(AppStreamer as any)._stream = null`)手動清流
- **AND** teardown MUST NOT 要求停止 server 端 Kit runtime(`terminate(false)` 不殺 Kit app)

#### Scenario: Background poll timers are cleared on unmount

- **WHEN** viewer component unmount 時仍有未完成的 Kit-ready poll timer
- **THEN** viewer SHALL 清除該 timer(存其 id 並於 `componentWillUnmount` clear)
- **AND** unmount 後 MUST NOT 再對已卸載 component setState 或產生並行 poll chain

#### Scenario: External streaming SDK load failure does not crash the page

- **WHEN** stream `source === 'gfn'` 且外部 GeForceNow SDK script 因 CSP 阻擋 / 離線 / 載入失敗無法取得
- **THEN** viewer SHALL 僅在 `source === 'gfn'` 時動態載入該 script,並以 `onerror` 走可控的失敗回饋
- **AND** 非 gfn source 時 MUST NOT 無條件注入外部 CDN script
- **AND** SDK 載入失敗 MUST NOT 以未定義全域(如 `GFN` ReferenceError)炸掉整個頁面

### Requirement: Viewer displays streaming-owned conversion and composition status

`web-viewer-sample` SHALL display streaming-owned conversion and composition
status, and SHALL classify the viewer as ready only when Kit stage-load
evidence matches the current session's expected stage URL. Metadata display
alone is not sufficient. When `materialization_strategy ==
"ifcopenshell_openusd_fallback"` (C1),viewer SHALL distinguish primary HOOPS
failure + fallback adoption,顯示 `semantic_mapping_fidelity` 欄位作為 Semantic
ready 判定依據;不得把 fallback 顯示成 primary HOOPS 成果。A spectator viewer that
connects to a coordinator-confirmed `spectator_ready` Kit SHALL trust the primary's
serving stage as `matched` instead of remaining permanently pending on its own
stage-load evidence.

#### Scenario: Kit loaded URL matches expected conversion artifact

- **WHEN** the viewer receives `openedStageResult` or `loadingStateResponse`
  from Kit after sending `openStageRequest`
- **THEN** it compares the Kit-reported URL with the expected stage URL
- **AND** it marks the viewer stage as ready only when the URL matches or when
  Kit echoes an accepted cached-path representation tied to the same requested
  URL

#### Scenario: Kit reports stale demo stage

- **WHEN** Kit reports a loaded stage URL such as
  `bim-models/許良宇圖書館建築_2026.usdc` while the expected stage URL is the
  current conversion job artifact
- **THEN** the viewer displays a `stale_stage_or_mismatch` blocker
- **AND** it MUST NOT claim that the current IFC-ready job has been visually
  loaded

#### Scenario: Stage load is not proven

- **WHEN** the viewer displays a ready conversion URL but no matching
  DataChannel or loading-state evidence has been observed
- **THEN** it displays a pending or unproven stage-load state
- **AND** Chrome E2E evidence MUST classify single-Kit render as non-passed

#### Scenario: Fallback adoption is surfaced separately from primary

- **WHEN** `stream_config.quality_metrics_summary.materialization_strategy`
  is `"ifcopenshell_openusd_fallback"`
- **THEN** Inspector ② 轉檔品質 SHALL clearly label converter source 為
  `fallback`,並顯示 `semantic_mapping_fidelity` 欄位
- **AND** UI MUST NOT 把 fallback 的 USDC 顯示為 primary HOOPS 成果
- **AND** 若 `mapping_has_ifc_type=true` + `mapping_has_ifc_name=true`
  Semantic ready SHALL 顯示 `yes`;否則 `incomplete`

#### Scenario: Spectator trusts primary stage composition

- **WHEN** viewer 以 spectator 角色連上 coordinator 且 `viewport_sharing.spectator_ready === true`
- **THEN** viewer SHALL 將 spectator 的 stage-load 狀態視為 `matched`(信任 primary 已在 serving stage),使 Runtime ready 能轉 `yes`
- **AND** spectator MUST NOT 在 `spectator_ready` 為真時仍因缺自身 stage-load 證據而停在 `pending`
- **AND** 當 `spectator_ready` 非真時 viewer SHALL 維持 `pending`,不偽宣告 Runtime ready

### Requirement: Viewer is positioned as Edge BIM Data Server Console

`web-viewer-sample` 的主畫面 SHALL 重新定位為「Edge BIM Data Server Console」,
而非「fast MVP 審查 demo 操作面板」。主畫面 layout SHALL 包含:TopBar(顯示
`project_id` / `external_model_version_id` / `review_session_id` / 三段 ready
摘要)、中央 WebRTC 3D viewer + stage truth panel、右側 Inspector(分四層:本機
資料包 / 轉檔品質 / BIM 語意對照 / 技術細節)、Bottom Evidence Strip(webhook /
conversion / stage / WebRTC 四段證據)。

#### Scenario: TopBar surfaces project / version / session identity

- **WHEN** viewer 載入一個合法 `?session=<review_session_id>` 並取得 stream config
- **THEN** TopBar SHALL 顯示 `project_id`、`external_model_version_id`、
  `review_session_id`,以及三段 ready 的 summary badge(File / Runtime /
  Semantic)
- **AND** 缺少任一識別欄位時 SHALL 顯示「未取得」或等價 placeholder,
  不偽宣告

#### Scenario: Right Inspector is partitioned into four sections

- **WHEN** viewer 渲染主畫面
- **THEN** Right Inspector SHALL 顯式分四層:本機資料包(① project / version /
  session / conversion job / artifact URL)、轉檔品質(② primary vs fallback /
  coverage / semantic_mapping_fidelity)、BIM 語意對照(③ mapping items 與
  highlight / focus 工具)、技術細節(④ debug 區,預設折疊;`?debug=1` 才展開)

#### Scenario: Bottom Evidence Strip shows four-segment runtime evidence

- **WHEN** viewer 主畫面渲染完成
- **THEN** 畫面底部 SHALL 顯示 Bottom Evidence Strip,包含 webhook(intake job /
  download status / queue position)、conversion(conversion job id / primary
  vs fallback)、stage(expected vs loaded URL / match status)、WebRTC
  (lifecycle / kit instance / video readyState)四段
- **AND** 任一段資料缺失 SHALL 標記「未觀察」或等價佔位符,不偽宣告

### Requirement: Viewer uses element mapping as semantic verification entry

`web-viewer-sample` SHALL 保留 element_mapping highlight / focus 操作,作為 IFC
entity → USD prim 的語意驗收入口,而不再以 issue workflow 語境呈現。Mapping
items 顯示 SHALL 利用 C1 提供的 `ifc_type` / `ifc_name` / `entity_id` 欄位,
讓 reviewer 確認顯示的是真正的 IFC 構件而非 shape-level USD prim。

#### Scenario: Reviewer verifies IFC entity by highlight

- **WHEN** reviewer 在 Inspector ③ BIM 語意對照 panel 點選一個 mapping item
  (帶 ifc_type / ifc_name)
- **THEN** viewer SHALL 發出 DataChannel `highlightPrimsRequest`,target
  `usd_prim_path`(C1 後為 `/World/<IfcClass>/<GUID>` 格式)
- **AND** Kit echo 回傳的 selected prim path SHALL 與 mapping item 的
  `usd_prim_path` 一致;mismatch 時 viewer SHALL 顯示 `fallback_paths` 警示

#### Scenario: Mapping verification is not framed as issue workflow

- **WHEN** viewer 主畫面渲染 Inspector ③
- **THEN** UI 字面 SHALL NOT 使用「審查問題」/「issue」/「標記問題」/「annotation」
  等 collaboration 語境用詞
- **AND** mapping 操作 SHALL 改稱「BIM 語意對照」/「元件驗收」/「定位元件」等
  data-plane 驗收用詞

