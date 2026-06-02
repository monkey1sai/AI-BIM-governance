## MODIFIED Requirements

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

- **WHEN** viewer 以 spectator 角色連上 coordinator 已標記 `spectator_ready` 的 Kit
- **THEN** viewer SHALL 將 spectator 的 stage-load 狀態視為 `matched`(信任 primary 已在 serving stage),使 Runtime ready 能轉 `yes`
- **AND** spectator MUST NOT 因缺自身 stage-load 證據而永久停在 `pending` / Runtime `incomplete`
