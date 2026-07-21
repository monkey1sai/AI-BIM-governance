# viewer-viewport — 3D viewer 重設計規格（console 內嵌 + viewer origin 頁內）

## ADDED Requirements

### Requirement: Workspace SHALL 以單一持久 primary viewport 服務 #a1..#a4

unified Workspace（`#a1..#a4`）SHALL 共用「單一 IFC → 單一 review session → 單一內嵌 primary viewport」。viewport（EmbeddedViewer 跨-origin iframe）SHALL 在 dock/hash 於 a1..a4 之間切換時保持同一 DOM 節點不 unmount（WebRTC 連線與 DataChannel 不中斷）；切至非 workspace 路由鍵 SHALL 釋放 viewer lease。整個 Workspace 同時 MUST NOT 存在多於一個 primary viewport 實例（Kit 每 signaling endpoint 單 viewer + editor lease 單佔）。

#### Scenario: 分頁切換不斷流

- **WHEN** 使用者在已啟動 3D session 的狀態下由 `#a1` 切至 `#a4`
- **THEN** viewport iframe SHALL 不重載、串流 SHALL 不重新協商，Dock 面板 SHALL 換為 A4 內容
- **AND** lease SHALL 維持同一 lease_id（不重新 claim）

#### Scenario: 離開 workspace 釋放

- **WHEN** 使用者由 `#a2` 切至 `#pipeline`
- **THEN** 系統 SHALL release viewer lease 並中止串流
- **AND** 返回 `#a1..#a4` 時 SHALL 回到「未啟動」態，不自動重新 claim

### Requirement: viewport SHALL mount 不自動 claim、啟動一律手動

viewport 掛載 MUST NOT 自動呼叫 viewer-lease claim 或任何 mutating API。3D session SHALL 只由使用者按「啟動 3D Session」啟動；啟動前 viewport SHALL 顯示離線示意（fixture）與 session 附掛面板。spectator SHALL 不內嵌於 console——邀請一律以同 session_id + `streamRole=spectator` 的外開連結（`/ui/open` 凍結面）發出。

#### Scenario: 唯讀掛載

- **WHEN** WorkspacePage 掛載且無使用者互動
- **THEN** 系統 SHALL 不發出 claim/heartbeat/open 任何 API 呼叫（visual gate 的 offline preview 環境下零新 DOM）

### Requirement: viewer SHALL 實作失敗態 visible-states 矩陣

console 內嵌 viewport 與 viewer origin 頁 SHALL 各自實作下列失敗態，每態 SHALL 有穩定測試錨點（`data-uc` / `data-testid`）、i18n 文案鍵與明示的可行動作；MUST NOT 以空白畫面或假成功呈現任何一態：

| 態 | 觸發條件（可判定） | 畫面/文案要點 | 可行動作 |
|---|---|---|---|
| no-session | 未附掛 session | 離線示意 + 「尚未附掛 review session」 | session 選擇器 |
| session-preparing | session 存在但 conversion 未 ready | 顯示 conversion status（detected/queued/converting） | 前往 #pipeline |
| viewer-origin-missing | runtime/status 無 `viewer.browser_url_base` | 「viewer origin 未配置」 | 重新整理 runtime status |
| lease-occupied | claim 回 409 | 顯示佔用者 role/display_name + 「editor lease 被佔用」 | 重試 claim（MUST NOT 自動搶佔） |
| stream-disconnected | WebRTC 連線中斷（ICE/media 斷） | 「串流中斷」+ 最後畫格靜態化標示 | 重新連線（重掛 iframe） |
| lease-expired | heartbeat 逾時 / release 失敗後過期 | 「lease 已過期」 | 重新 claim（手動） |
| gpu-unavailable | kit-manager instances 查詢失敗或無可用 instance | 「Kit runtime 不可用」誠實停用啟動鈕 | 前往 #runtime 檢視 |
| first-frame-timeout | 啟動後逾時未收 first_frame（門檻見 SLO） | 「串流已建立但未收到首幀」 | 重試 / 診斷指引 |
| stage-load-timeout | loadingState busy 輪詢達上限（90×1s，沿用實碼） | 「模型載入逾時」+ 目標 URL | 重試 openStage |
| stage-mismatch | openedStageResult 回報 URL 與 expected 不符 | 「stage 不符」（誠實鐵律：不偽宣告 applied） | 重新 openStage |

#### Scenario: lease 被佔

- **WHEN** 使用者按「啟動 3D Session」而 coordinator 回 409（editor lease 已被他人持有）
- **THEN** UI SHALL 顯示 lease-occupied 態（含現任 lease 資訊）
- **AND** MUST NOT 自動重試或強制接管

#### Scenario: 串流斷線

- **WHEN** 已建立的 WebRTC 連線中斷
- **THEN** UI SHALL 於 5 秒內轉入 stream-disconnected 態並提供重連動作
- **AND** MUST NOT 繼續顯示「● Streaming」活躍指示

### Requirement: 鏡頭控制與 viewport 工具列 SHALL 有固定語意

viewport 鏡頭控制 SHALL 採 Omniverse Kit 預設繫結並在 UI 提供提示：左鍵拖曳=orbit、中鍵拖曳=pan、滾輪=zoom、雙擊 prim=focus（等效 `focusPrimRequest`）。工具列四鈕語意 SHALL 固定為：`⬒`=frame all（框取全景）、`✥`=pan 模式切換、`◫`=比對/剖切檢視（未接通前誠實 disabled 標 Roadmap）、`⟲`=reset view（等效 `selectPrimsRequest([])` + `resetStage`）。console 內嵌 viewport SHALL 另提供 fullscreen 切換（瀏覽器 Fullscreen API，作用於 viewport 容器，不影響 `/ui/open` 外開行為）。

#### Scenario: reset view

- **WHEN** 使用者按 `⟲`
- **THEN** 系統 SHALL 送出 `selectPrimsRequest {paths:[]}` 與 `resetStage`
- **AND** 選取狀態（含治理 selected guid）SHALL 一併清空

### Requirement: 串流效能 SHALL 以正式 SLO 量測並誠實顯示

系統 SHALL 量測並於 UI 顯示實測值：first_frame_ms（ReviewSession 既有欄位）、inbound 幀率（WebRTC getStats）、指令往返延遲（request_id 配對）。正式門檻（LAN 基準）：first_frame p95 ≤ 10s、幀率 ≥ 24 FPS @1080p、highlight 往返 p95 ≤ 300ms、stage 載入逾時 90s。超標 SHALL 顯示品質告警而非硬失敗；SLO 斷言 SHALL 進 E2E 報告、MUST NOT 進 CI 硬 gate。Hi-Fi 畫面的「60 FPS · 28 ms」SHALL 維持 fixture 示意（R3），MUST NOT 被當成門檻或實測值顯示。

#### Scenario: 幀率實測顯示

- **WHEN** 串流建立且 getStats 回報 framesPerSecond
- **THEN** streaming pill SHALL 顯示實測值（非 fixture 60 FPS）
- **AND** 實測值缺失時 SHALL 顯示「量測中」而非沿用 fixture 數字

### Requirement: ViewportLayer 元件職責 SHALL 對齊實碼命名

正本元件樹的理想命名 SHALL 落為下列職責表（命名遷移屬實作 PR）：`ViewportLayer`=viewport 疊層容器（持久 iframe + HUD 疊加）；`RemoteVideo`=viewer origin 內的 `<video id="remote-video">`（**只存在於 viewer origin，console 端無 video 元素**）；`OverlayHud`=stagePath pill、legend、streaming pill、方位塊、工具列；`SelectionCallout`=選取視覺回饋（框+標籤，資料源=`stageSelectionChanged`/`selected_guid`）。console 端 SHALL 經 vg01 橋間接觀測，MUST NOT 直接觸碰 viewer origin DOM。

#### Scenario: console 端無 video

- **WHEN** 檢視 console `#a1..#a4` 頁 DOM
- **THEN** top document SHALL 不存在 `<video>` 元素（WebRTC 播放留在跨-origin iframe 內）

### Requirement: viewer origin（:5173）頁內 UI SHALL 規格化（進場面不動）

`/ui/open?session=` 302 進場、參數白名單與 CI guard SHALL 維持凍結不變。viewer origin 頁內 SHALL 規格化：(1) 版面分區=全幅 `#remote-video` + 頂部狀態列 + 左側 USD 樹抽屜 + 治理 overlay；(2) primary/spectator 視覺差異=spectator SHALL 顯著顯示 readonly 徽章、所有 mutating 控制 SHALL disabled 並於嘗試操作時顯示拒絕回饋（對齊 `commandRejected`）；(3) embedded 模式=偵測 `window.parent !== window` 且 vg01 握手完成後 SHALL 隱藏 standalone chrome（頂部狀態列/樹抽屜開關保留最小化），握手前 SHALL 維持 standalone 呈現；(4) 失敗態沿用上方矩陣。

#### Scenario: spectator 嘗試寫入

- **WHEN** spectator 在 viewer origin 頁點選會觸發 mutating 指令的控制
- **THEN** UI SHALL 顯示 readonly 拒絕回饋（不送出指令，或送出後如實顯示 `commandRejected`）
- **AND** MUST NOT 靜默吞掉操作

#### Scenario: embedded 隱藏 chrome

- **WHEN** viewer 於 EmbeddedViewer iframe 內載入且完成 vg01 `viewer_ready` 握手
- **THEN** viewer SHALL 隱藏 standalone chrome、保留 video 與 overlay
- **AND** 無握手（直接分頁開啟）時 SHALL 維持完整 standalone UI
