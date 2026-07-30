## MODIFIED Requirements

### Requirement: viewer SHALL 實作失敗態 visible-states 矩陣

Console內嵌viewport與viewer origin頁 SHALL各自實作下列失敗態，每態 SHALL有穩定測試錨點（`data-uc`／`data-testid`）、i18n文案鍵與明示可行動作；MUST NOT以空白畫面、holder資訊洩漏或假成功呈現任何一態：

> Task 5.6 partial progress（2026-07-31）：viewer origin 的 `runtime-command-rejection` review diagnostics、request-context mismatch、changed-unconfirmed binding reason與rejected stage-load已使用既有zh/en presentation，並由focused DOM驗證；既有runtime-command authority流程另由controlled browser回歸驗證。stage-load-timeout與其餘完整失敗態矩陣尚未逐態收斂與驗證，因此5.6維持OPEN，且本change不得宣稱production/full completion。

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
