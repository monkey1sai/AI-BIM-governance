## MODIFIED Requirements

### Requirement: viewer SHALL 實作失敗態 visible-states 矩陣

Console內嵌viewport與viewer origin頁 SHALL各自實作下列失敗態，每態 SHALL有穩定測試錨點（`data-uc`／`data-testid`）、i18n文案鍵與明示可行動作；MUST NOT以空白畫面、holder資訊洩漏或假成功呈現任何一態：

> Task 5.6 partial progress（2026-07-31）：viewer origin 的 `runtime-command-rejection` review diagnostics、request-context mismatch、changed-unconfirmed binding reason與rejected stage-load已使用既有zh/en presentation，並由focused DOM驗證；既有runtime-command authority流程另由controlled browser回歸驗證。stage-load-timeout與其餘完整失敗態矩陣尚未逐態收斂與驗證，因此5.6維持OPEN，且本change不得宣稱production/full completion。
>
> Task 5.6 partial progress（2026-08-12）：stage-load-timeout已收斂並由RED→GREEN focused DOM tests驗證——45s排程deadline與90×1s busy-poll上限兩觸發路徑皆有可見overlay（zh/en title/target/diagnostic/guidance）、late-result不覆寫既有失敗terminal，並新增`data-stage-failure-reason="stage-load-timeout"`狀態專屬test anchor（與其他stage-load失敗共用的`data-testid="stage-load-failure"`區隔）。核心可見行為（overlay/診斷文案/late-result）實為2026-08-04 PR #463／#468既已落地但未同步勾選的doc-drift，本輪為獨立重驗+新增test anchor，詳見`tasks.md`同日期證據段落。no-session、session-preparing、viewer-origin-missing、lease-occupied、stream-disconnected、lease-expired、gpu-unavailable、first-frame-timeout共8態仍未逐態驗證，5.6維持OPEN，本change不得宣稱production/full completion。
>
> Task 5.6 partial progress（2026-08-17）：no-session、viewer-origin-missing、lease-occupied三態已收斂並由RED→GREEN focused DOM tests驗證——no-session有`data-testid`專屬錨點＋「尚未附掛 review session」zh/en文案＋session選擇器可行動作；viewer-origin-missing改為常駐條件render（role=alert）並新增「重新整理 runtime status」動作（`*-viewer-origin-refresh`）；lease-occupied驗證既有generic 409呈現並加入holder-privacy負向斷言（不得命中lease_/viewer_/nonce/stream/display_name/holder）。session-preparing、stream-disconnected、lease-expired、gpu-unavailable、first-frame-timeout共5態仍未逐態驗證（各需新行為：conversion status判定、WebRTC斷線偵測、heartbeat失效偵測、kit-manager查詢、啟動計時器），5.6維持OPEN，本change不得宣稱production/full completion。
>
> Task 5.6 partial progress（2026-08-17 slice-2）：session-preparing、gpu-unavailable、lease-expired、first-frame-timeout四態已收斂並由RED→GREEN focused DOM tests驗證（conversion_status非終態note＋#pipeline；instances查詢失敗誠實停用＋#runtime；heartbeat 404 lease拒絕→手動re-claim；90s首幀計時→重試＋診斷）。僅stream-disconnected一態未驗證（需viewer側WebRTC斷線postMessage協定，另切片），5.6維持OPEN，本change不得宣稱production/full completion。
>
> Task 5.6 partial progress（2026-08-17 slice-3）：stream-disconnected已收斂——viewer終態處理器發vg01 `stream_state`（schema＋contracts pytest fail-closed）、EmbeddedViewer守衛轉發、pane可見alert＋誠實回退全部streaming證據＋重掛iframe重連。**console內嵌側12/12態完成**；standalone viewer origin頁側逐態盤點為最後殘項（stage系列已在、其餘適用性需裁決），5.6維持OPEN。
>
> Task 5.6 closeout（2026-08-18 slice-4）：standalone viewer origin頁逐態盤點完成並收斂——**6態present**：authority-unavailable（`runtime-authority-unavailable`）、stage-unproven（`runtime-command-rejection-stage-unproven`）、stage-load-timeout（`data-stage-failure-reason`）、stage-mismatch（`stageLoadStatus="mismatch"`＋`stale_stage_or_mismatch`診斷，與其他stage-load失敗共用`stage-load-failure`錨點）為既有；stream-disconnected（`_handleStreamStopped`→`webrtc_disconnected`＋診斷＋`_reconnectStream`）與first-frame-timeout（`_handleStreamStartTimeout`→「WebRTC 串流未建立」診斷）本切片補齊spec要求的穩定錨點與i18n：新增`data-testid="stream-diagnostic-panel"`（兩態共用診斷面）、兩處診斷與loadingText以`t()`接上zh/en、MockViewport「重新連線 WebRTC」動作（`viewer-reconnect-stream`，webrtcStatus∈stopped/terminated/failed顯示）文案i18n化；三條RED→GREEN focused DOM tests（斷線／首幀逾時可見面＋en模式接線驗證）。**4態裁決不適用**（職責屬console parent）：no-session（session附掛/選擇器＝console工作台；standalone無session時顯示等待串流idle非失敗態）、session-preparing（conversion pipeline可見性＝console `#pipeline`）、viewer-origin-missing（結構性不可能——態定義為console判runtime/status缺`browser_url_base`，viewer頁自身即該origin）、gpu-unavailable（kit-manager instances查詢＝console；viewer觀察面＝串流未建立診斷，誠實不宣稱GPU狀態）。**2態lab-embed degraded（by design）**：lease-occupied（standalone直開不claim——`_ensurePrimaryViewerLease`於`window.parent===window`即return null；lab-embed claim 409走reviewEvents log＋後續stage-load失敗鏈，holder privacy由coordinator generic 409保障）、lease-expired（過期自癒drop＋重claim；heartbeat失敗drop＋log，統一政策helper `viewerLeaseHeartbeatDelayMs`已接）。Console內嵌側12/12＋standalone側盤點與收斂完成，**5.6關閉**；本change整體closeout（7.5）仍OPEN。

| 態 | 觸發條件（可判定） | 畫面/文案要點 | 可行動作 |
|---|---|---|---|
| no-session | 未附掛session | 離線示意＋「尚未附掛 review session」 | session選擇器 |
| session-preparing | session存在但conversion未ready | 顯示conversion status | 前往 `#pipeline` |
| viewer-origin-missing | runtime/status無 `viewer.browser_url_base` | 「viewer origin 未配置」 | 重新整理runtime status |
| lease-occupied | claim回generic 409 | 只顯示「editor lease 已被占用」，不得顯示holder user/viewer/display/nonce/stream detail | 手動重試claim（MUST NOT自動搶佔） |
| stream-disconnected | WebRTC連線中斷 | 「串流中斷」＋最後畫格靜態化標示 | 重新連線（重掛iframe） |
| lease-expired | heartbeat逾時／release失敗後過期 | 「lease 已過期」 | 手動重新claim |
| authority-unavailable | coordinator runtime authority timeout/network/invalid response | 「操作授權服務暫時不可用」，明示可重試且不把它說成lease expired | 重試原操作；readonly/video可維持 |
| stage-unproven | Kit已觀察stage改變但coordinator completion未證實，或parent收到unproven status | 「stage 已變更但尚未證實」，清除handoff-ready狀態 | authenticated status resync；禁止盲retry/handoff |
| gpu-unavailable | kit-manager instances查詢失敗或無可用instance | 「Kit runtime 不可用」誠實停用啟動鈕 | 前往 `#runtime` 檢視 |
| first-frame-timeout | 啟動後逾時未收first_frame | 「串流已建立但未收到首幀」 | 重試／診斷指引 |
| stage-load-timeout | loadingState busy輪詢達上限（90×1s） | 「模型載入逾時」＋目標URL | 取得新authorization後重試 |
| stage-mismatch | openedStageResult回報URL與expected不符 | 「stage 不符」，不得偽宣告applied | 重新preauthorize/openStage |

`commandRejected` SHALL形成persistent aria-live terminal state並以 `request_id`／`rejection_id`關聯。`retryable:true`只允許顯示安全重試選項；`runtime_state:"changed_unconfirmed"` SHALL優先轉入stage-unproven，直到authenticated self-only status證實同revision active。Raw credential、lease token、internal token與other-principal detail SHALL NOT進入DOM、toast、event panel或browser log。

#### Scenario: lease被占只顯示generic conflict

- **WHEN** 使用者按「啟動 3D Session」而coordinator回generic 409
- **THEN** UI SHALL顯示lease-occupied態，但 SHALL NOT顯示現任holder role、display name、viewer、lease或stream detail
- **AND** MUST NOT自動重試或強制接管

#### Scenario: 串流斷線

- **WHEN** 已建立的WebRTC連線中斷
- **THEN** UI SHALL於5秒內轉入stream-disconnected態並提供重連動作
- **AND** MUST NOT繼續顯示「● Streaming」活躍指示

#### Scenario: authority outage與expired lease不混淆

- **WHEN** viewer收到 `commandRejected {reason:"lease_invalid", retryable:true, detail_code:"authority_unavailable"}`
- **THEN** UI SHALL顯示authority-unavailable而不是lease-expired，且stage/selection狀態維持未變

#### Scenario: changed-unconfirmed阻擋A4 handoff

- **WHEN** viewer收到 `commandRejected {runtime_state:"changed_unconfirmed"}`
- **THEN** iframe與parent SHALL顯示stage-unproven、清除loaded/handoff-ready狀態並阻擋盲retry
- **AND** 只有authenticated status證實同revision active後才可解除
