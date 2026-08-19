# unified-governance-console Specification

## Purpose
統一治理控制台北極星：A1–A10 業務治理操作 SHALL 以 overlay 疊在 primary viewer 的 live 3D 之上（治理與 3D 同框），取代與 viewer 互斥掛載的獨立 `/console` 殼；治理失敗構件 SHALL 經 HighlightBridge 在 3D 標示、點 3D 構件 SHALL 反查 IFC GUID 帶進治理，前端 SHALL 只經 coordinator `:8004` 不直連內部服務，誠實標 provenance 且後端離線時誠實顯示 502。
## Requirements
### Requirement: A1–A10 治理操作 SHALL 疊在 primary viewer overlay，spectator SHALL 唯讀

統一治理控制台的 A1–A10 業務治理操作 SHALL 以 overlay 疊在 primary viewer 的 live 3D 之上（中央 live 3D + 右側治理清單 / 動作），SHALL NOT 退回為與 viewer 互斥掛載的獨立 `/console` 殼。spectator 角色 SHALL 唯讀：經 GovPanelState 將治理操作面板 `disabled`（面板可見但不可操作，誠實表態「唯讀」），SHALL NOT 對 spectator 隱藏面板而假裝該能力不存在，SHALL NOT 讓 spectator 觸發 A1–A10 治理動作。primary / spectator 拓樸沿用 `multi-artifact-kit-routing`（spectator 共享同一串流）。primary viewer 內部 MAY 提供「模型 / 問題」分頁（同一 viewer 內的版面狀態，見下方 issues-tab requirement）；問題分頁全幅呈現治理面板、暫隱中央 3D mock viewport SHALL NOT 視為退回獨立 `/console` 殼——其仍是同一 primary viewer + 同一 `GovernanceOverlay` + 同一 WebRTC DataChannel，非另一互斥掛載畫面。

#### Scenario: A1–A10 治理以 overlay 疊在 primary viewer 而非獨立殼

- **WHEN** primary viewer 載入並開啟 A1–A10 治理
- **THEN** A1–A10 治理面板 SHALL 以 overlay 呈現在同一個 primary viewer 的 live 3D 之上（治理與 3D 同框）
- **AND** SHALL NOT 以「與 viewer 互斥掛載的獨立 console 殼」呈現（不得是「另一個畫面」）

#### Scenario: spectator 看同串流但治理面板唯讀（disabled，非隱藏）

- **WHEN** 一個 spectator 角色加入同一 review session 並看到 A1–A10 overlay
- **THEN** GovPanelState SHALL 將治理操作面板標為 `disabled`（唯讀）
- **AND** spectator SHALL 仍看到與 primary 相同的串流與面板內容（不隱藏）
- **AND** spectator SHALL NOT 能觸發任何 A1–A10 治理動作（建立 / 派工 / 標示 / 匯出等）

### Requirement: operator console SHALL 由 coordinator :8004/ui 服務 EdgeConsole 產品操作台 shell，A1–A10 既為 console 頁亦為 viewer overlay 操作面

統一治理控制台的 operator 面 SHALL 以 coordinator `:8004/ui`（gated by `CONSOLE_DIST_DIR`，未設定或目錄無 `index.html` 時 SHALL 誠實回退既有 `dev-console.html`，SHALL NOT 因未產出 build 而中斷 `/ui`）服務 `EdgeConsole` 產品操作台 shell（分組左導航：Workspace / Core Governance / Omniverse Runtime / Coordinator-Edge Control / System），其下涵蓋 operator 路由 `#/coordinator`（Coordinator 控制台：sessions / control）、`#/intake`（模型進件 / 版本，A1）、`#/runtime`（Kit / WebRTC runtime 狀態）、`#/review`、`#/kit`（Kit forward-only 模型台）、`#/demo-control`（真實 IFC 進件）；路由判定 SHALL 同時相容 `#/<key>` 與 `#<key>`、coordinator `/ui` pathname 預設掛 console；`?session=` viewer 進件 SHALL 仍優先（不被 console 搶掛）。`/ui/console` SHALL 精確 301→`/ui`、`/ui/open?session=` SHALL 維持 302 凍結 handoff（逐字保留 query），且兩者 SHALL 於任何 `/ui` static 或 SPA fallback「之前」精確註冊、SHALL NOT 被 `/ui/*` 萬用路由吞掉（RK6），亦 SHALL NOT 引入後端 path router 的獨立子路徑。

A1–A10 業務治理 SHALL 同時存在於兩處且不矛盾：(a) 作為 EdgeConsole 內的 operator/launcher 頁（說明功能用途、預期 UI、後端依賴與誠實 provenance，並導向真實治理流程）；(b) 作為疊在 primary viewer live 3D 之上的**實際操作介面**——A1–A10 治理動作（rule-run / 失敗構件→3D 標示 / issue·BCF / Stage·Artifact Binding）的執行面仍是 primary viewer overlay。console 內的 A1–A10 頁 SHALL NOT 偽裝為已就緒的 live system evidence；待建能力 SHALL 誠實標 roadmap / `disabled`。`#/intake` 的 A1 進件 SHALL 讓操作員從現成模型清單選取，SHALL NOT 要求手填模型路徑。

> 歷史脈絡（convergence 2026-06-09）：本 requirement 原為「三個獨立 `/console` operator 頁（`#coordinator` / `#intake` / `#runtime`），A1–A10 僅疊 viewer overlay」（`unified-console-mvp` MVP 切片）。經 `unified-console-fe-redesign`（`:8004/ui` 六 hash 路由 + RK6 + `CONSOLE_DIST_DIR`）與 `product-governance-console-integration`（PR #194：`:8004/ui` 改掛 `EdgeConsole` 完整產品操作台、分組導航、A1–A10 頁）演進後，現況權威為 `/ui` EdgeConsole shell；原三頁為其子集（無行為回退）。舊「`/console` 三頁、A1–A10 overlay-only」措辭已 superseded。

#### Scenario: operator console 由 :8004/ui 的 EdgeConsole shell 服務並涵蓋 operator 路由

- **WHEN** 操作員開啟 `:8004/ui`（無 `?session=`）並導航 `#/coordinator` / `#/intake` / `#/runtime` / `#/kit` / `#/demo-control`
- **THEN** `/ui` SHALL 渲染 EdgeConsole 產品操作台 shell（頂部 runtime 狀態、分組左導航、中央工作區、Chat USD Agent 側欄）
- **AND** 各 operator 路由 SHALL 掛載對應頁（Coordinator 控制 / 進件版本 / runtime 狀態 / Kit 模型台 / 真實 IFC 進件）
- **AND** `?session=` 進件 SHALL 仍讓位給 viewer，SHALL NOT 掛 console

#### Scenario: A1–A10 既為 console 頁亦為 viewer overlay 操作面

- **WHEN** 操作員在 EdgeConsole 開啟 A1–A10 頁
- **THEN** 該頁 SHALL 說明功能用途 / 後端依賴 / 誠實 provenance 並導向真實治理流程
- **AND** A1–A10 治理動作的實際執行 SHALL 可於疊在 primary viewer live 3D 之上的 overlay 操作
- **AND** 待建能力 SHALL 標 roadmap / `disabled`，SHALL NOT 偽裝為 live system evidence

#### Scenario: A1 進件於現成模型清單選取，不手填路徑

- **WHEN** 操作員在 `#/intake` 進行 A1 進件
- **THEN** 介面 SHALL 提供現成模型 / 版本清單供選取
- **AND** SHALL NOT 要求操作員手動輸入模型檔案路徑

### Requirement: 點 3D 構件 ↔ IFC GUID 雙向 + 治理失敗構件 SHALL 經 client highlightPrimsRequest 在 3D 標示

統一治理控制台 SHALL 提供 3D 構件與 IFC GUID 的雙向打通（MappingCache 快取 `element_mapping` 的 `ifc_guid ↔ usd_prim_path`）：點 3D 構件 SHALL 經 `element_mapping` 反查得 IFC GUID 並帶進治理；治理失敗構件 SHALL 經其 `usd_prim_path` 由 HighlightBridge 組成 `highlightPrimsRequest`、透過 viewer 既有 WebRTC DataChannel（client 主動拉）在 3D 標示。3D 著色 SHALL 走 client `highlightPrimsRequest`，SHALL NOT 復活 2026-05-21 退役的 server-push highlight。未對映（`usd_prim_path=null`）的失敗構件 SHALL 誠實顯示「無法在 3D 標示」並顯示 coverage%，SHALL NOT 以捏造的 prim path 取代以假裝可標示。3D 端的視覺呈現方式 SHALL 誠實描述為現行 Kit handler 實際採用的 **USD selection 高亮**（回傳 `applied_mode: "selection"`）；client 雖仍依 severity 於協定 payload 帶 `color`，該欄位 SHALL NOT 被描述為已在 3D 生效的著色。

#### Scenario: 治理失敗構件經 client highlightPrimsRequest 在 3D 標紅

- **WHEN** 操作員在 A1–A10 overlay 對一個帶有效 `usd_prim_path` 的治理失敗構件按「在 3D 標示」
- **THEN** HighlightBridge SHALL 以該 `usd_prim_path` 組成 `highlightPrimsRequest`
- **AND** SHALL 經 primary viewer 既有的 WebRTC DataChannel（`web-viewer-sample/src/Window.tsx` React 元件的 private method `_sendStreamMessage`，client 主動拉，非 browser global `Window`）送至 Kit runtime
- **AND** Kit runtime SHALL 以 USD selection 呈現該構件（`clear_selected_prim_paths()` ＋ `set_selected_prim_paths(...)`）並回傳 `applied_mode: "selection"`
- **AND** client 依 severity 寫入 payload 的 `color` 欄位 SHALL 被視為協定攜帶值而非已生效的 3D 著色；spec SHALL NOT 宣稱該構件在 3D 中被標為紅色
- **AND** SHALL NOT 透過已退役的 server-push highlight 機制標示

#### Scenario: 點 3D 構件反查 IFC GUID 帶進治理

- **WHEN** 操作員在 primary viewer 的 3D 中點選一個構件
- **THEN** MappingCache SHALL 以該構件的 `usd_prim_path` 經 `element_mapping` 反查得對應 `ifc_guid`
- **AND** SHALL 將該 `ifc_guid` 帶進 A1–A10 治理（作為治理操作的目標構件）

#### Scenario: 未對映的失敗構件誠實標示無法 3D 標示，不捏造 prim path

- **WHEN** 一個治理失敗構件的 `usd_prim_path` 為 `null`（未對映）
- **THEN** overlay SHALL 誠實顯示「無法在 3D 標示」並顯示當前 coverage%
- **AND** SHALL NOT 以任意或捏造的 prim path 觸發 `highlightPrimsRequest` 假裝可標示

### Requirement: MVP 垂直切片 SHALL 強制 identity profile，coverage 不足 SHALL 依既有 spec 誠實降級

MVP 垂直切片（A1 進件 → A2 轉檔 / 語意映射 → A3 規則檢核 → A4 治理分 → 點 failed 構件在 3D 標紅 → A8 開 BCF issue）SHALL 強制 identity profile 為 `guid_exact` 且 coverage 為 `1.0`。<!-- 編號說明：此處 A1–A10 採 2026-06-04 使用者拍板的**新治理工作流編號**（A1 進件 / A2 轉檔語意 / A3 規則 IDS / A4 治理分 / A5 碰撞 / A6 圖模 / A7 版本差異 / A8 Issue·BCF / A9 AI / A10 報表稽核），與舊 `roadmap-data.jsx` RM_APPS 編號（A1 治理 / A2 version-diff / A3 federation / A4 語意搜尋 / A8 synthetic-data）**刻意不同**；以本 capability spec 為新編號的權威對映，`roadmap-data.jsx` RM_APPS 屬歷史參考，不適用於本 spec 的流程敘述。 -->當 coverage < 90%（低覆蓋 fallback 觸發）時，系統 SHALL 依既有 spec 誠實降級：依 `host-native-conversion-authority-service` 把未對映 entity 報為 `unmapped` / `sidecar-only` / `omitted` 且 SHALL NOT 建立假 GUID→prim mapping 灌水 coverage；依 `runtime-verification-evidence` 採 measure-first（誠實報 coverage、低覆蓋 warn 不 fail、threshold lock 後 `minimum_coverage_ratio=1.0`、`coverage_denominator=source_ifc_entity_count`）；依 `governance-rule-run-authority` SHALL NOT 把非 `guid_exact` 的 mapping 當作 `guid_exact`，且 fake / smoke mapping（`mock` / `allow_fake_mapping` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test`）SHALL NOT 被當作真實覆蓋率。MVP SHALL 只使用已驗證的 coordinator / governance 端點，SHALL NOT 引入新引擎以滿足 fallback。

#### Scenario: MVP 強制 guid_exact 且 coverage 1.0

- **WHEN** 啟動 MVP 垂直切片並進件一份真實 IFC 模型
- **THEN** MVP SHALL 要求 identity profile 為 `guid_exact` 且 coverage 為 `1.0`
- **AND** 在此條件下 failed 構件 SHALL 具備可標示的 `usd_prim_path`（低覆蓋 fallback 多半不觸發）

#### Scenario: coverage 不足時誠實降級，不捏造、不冒充 guid_exact

- **WHEN** 進件模型的 coverage < 90%（低覆蓋 fallback 觸發），部分 failed 構件未對映
- **THEN** 系統 SHALL 依 `host-native-conversion-authority-service` 把未對映 entity 報為 `unmapped` / `sidecar-only` / `omitted`，SHALL NOT 建立假 GUID→prim mapping 灌水
- **AND** SHALL 依 `runtime-verification-evidence` 誠實報出 coverage（measure-first；threshold lock 後 `minimum_coverage_ratio=1.0`、`coverage_denominator=source_ifc_entity_count`）
- **AND** SHALL 依 `governance-rule-run-authority` 不把非 `guid_exact` 的 mapping 當 `guid_exact`，且 fake / smoke mapping 不得當真實覆蓋率
- **AND** 未對映 failed 構件 SHALL 誠實顯示「無法在 3D 標示」+ coverage%，SHALL NOT 捏造 prim path

### Requirement: 前端 SHALL 只經 coordinator :8004，SHALL NOT 直連 :49102；誠實 provenance + 後端離線 502

統一治理控制台前端（含 A1–A10 overlay、三個 operator 頁、HighlightBridge / MappingCache 的**治理 / 資料 API** 存取）SHALL 只經 coordinator `:8004`（`/api/governance/*` proxy、`/api/external/ifc-ready`、`/api/review-sessions`、stream-config 等已驗證端點）取得治理資料，SHALL NOT 直連 `governance-service` 的 `127.0.0.1:49102`，亦 SHALL NOT 以治理 / 資料 API 目的直連 `bim-streaming-server` 的 `49100/47998`。**例外 carve-out（既有合法 runtime 通道）**：primary viewer（`web-viewer-sample`）與 Kit 之間的 WebRTC 視訊串流及 DataChannel JSON command（含 `highlightPrimsRequest` / `focusPrimRequest`）是既有的 client-主動 runtime 通道（`:49100` signaling / media），不在此禁令範圍內；HighlightBridge 透過此 DataChannel 推送高亮指令屬合法用途，與 AGENTS.md §3.5/§6 viewer↔streaming-server boundary 一致。前端 SHALL 對每塊資料與每顆動作標誠實 provenance（`asbuilt` / `artifact` / `demo` / `p1` / `p15` / `p3` / `p4`）；其中 `p3` / `p4` 為 RM phase 3/4 願景項，與 `edge-console-operator-frontend` spec 及 `web-viewer-sample/src/console/data.ts` 的 `Prov` 型別定義一致。待建項 SHALL 標 `p1` / `p15` 並 `disabled`。當 coordinator / 後端不可達時，前端 SHALL 誠實顯示 502（後端離線），SHALL NOT 偽裝成功、SHALL NOT 顯示捏造數值、SHALL NOT 殘留舊結果假裝成功。

#### Scenario: 治理請求經 coordinator proxy，不直連內部埠

- **WHEN** 前端（overlay 或 operator 頁）需要觸發或讀取 A1–A10 治理資料
- **THEN** 它 SHALL 呼叫 coordinator `:8004` 的 `/api/governance/*`（或其他已驗證 coordinator 端點）
- **AND** SHALL NOT 直接連線 `governance-service` 的 `127.0.0.1:49102` 或以治理 / 資料 API 目的直連 streaming 的 `49100/47998`（primary viewer↔Kit 的 WebRTC DataChannel 屬合法 runtime 通道、不在禁令內）

#### Scenario: 後端離線時誠實顯示 502，不偽裝成功

- **WHEN** 前端送出治理請求但 coordinator / 後端不可達
- **THEN** 前端 SHALL 誠實顯示 502（後端離線）的錯誤狀態
- **AND** SHALL NOT 偽裝成功、SHALL NOT 顯示捏造數值、SHALL NOT 殘留舊結果假裝成功

#### Scenario: 待建能力誠實標 p1 / p15 並 disabled，不做假按鈕

- **WHEN** 某 A1–A10 能力的後端鏈尚未接通（例如新引擎 A5/A6/A9/A10 或 server-push 類動作）
- **THEN** 對應入口 SHALL 標 `p1` 或 `p15` 並 `disabled`，並誠實說明待建原因
- **AND** SHALL NOT 呈現為「點了沒反應」的可點假按鈕，SHALL NOT 假裝該能力已 ready

### Requirement: MVP 垂直切片 SHALL frontend-operable，前端只經 coordinator :8004（後端僅限最小 session-scoped rule-run 端點）

統一治理控制台 MVP 垂直切片的實作主體 SHALL 落在 `web-viewer-sample` 瀏覽器 client（governance 模組 + A1–A10 overlay + operator 三頁 + viewer 整合），且 SHALL 為 frontend-operable（可從前端 route 操作並具 browser E2E 證據，對齊 `AGENTS.md §0.1`），SHALL NOT 以 backend-only 或僅單元測試宣稱完成。

為讓 overlay 從當前 review session 跑 A3 規則檢核（governance-service 的 rule-run 需 server 端 IFC 路徑、瀏覽器不持有也 SHALL NOT 手填），MAY 新增**一個最小 coordinator session-scoped rule-run 端點**（`POST /api/governance/rule-runs/for-session/:sessionId`：解析 `session → 進件下載的 server IFC 路徑` 後轉發 governance-service）。但：前端 SHALL 只經 coordinator `:8004`、SHALL NOT 以治理 / 資料 API 目的直連 `:49102` / `:49101` / `:49100`（primary viewer↔Kit 的 WebRTC video + DataChannel 為合法 runtime 通道、不在此禁令內，與本 capability『前端 SHALL 只經 coordinator :8004，SHALL NOT 直連 :49102；誠實 provenance + 後端離線 502』requirement 之 carve-out 一致；本 requirement 後句即明定 3D 著色經該 DataChannel）；coordinator SHALL 僅 resolve + forward（不執行 rule-run、不成為新資料權威）；SHALL NOT 改動 governance-service / `bim-streaming-server` 端點或 `element_mapping` / stream-config data shape；SHALL NOT 新增生產依賴。3D 著色 SHALL 重用既有 `buildHighlightPrimsRequest` 經既有 viewer WebRTC DataChannel，SHALL NOT 復活 2026-05-21 退役的 server-push highlight。

#### Scenario: MVP 元件邊界 + 最小 coordinator 端點，不改 data shape

- **WHEN** 交付 MVP 垂直切片實作
- **THEN** client 元件（MappingCache / GovPanelState / HighlightBridge / GovernanceOverlay / OperatorConsole / IntakeSelectPage / viewer glue）SHALL 僅存在於 `web-viewer-sample/src/`
- **AND** 新增的後端 SHALL 僅限 coordinator 的一個 session-scoped rule-run proxy 端點（resolve server IFC 路徑 + forward 至 governance-service），coordinator SHALL 僅 resolve+forward
- **AND** SHALL NOT 改動 governance-service / `bim-streaming-server` 端點或 `element_mapping` / stream-config data shape、SHALL NOT 新增生產依賴、SHALL NOT 復活退役 server-push（3D 著色一律 client `highlightPrimsRequest`）

#### Scenario: 三 operator 頁與治理 overlay 皆可從前端操作且有 E2E 證據

- **WHEN** 驗收 MVP 實作是否完成
- **THEN** `#coordinator` / `#intake` / `#runtime` 三頁 SHALL 可從前端 hash route 操作、各自獨立 render 且不含 A1–A10 治理 overlay，並具 browser E2E 截圖證據
- **AND** A1–A10 治理 overlay SHALL 可疊在 primary viewer 的 live 3D 上操作（從 session 跑 A3 規則檢核 → 失敗構件 → 在 3D 標示 → A8 開 BCF issue），其完整互動 E2E SHALL 於部署環境（`scripts/deploy.ps1` golden path）以真 IFC + 真 3D 截圖佐證
- **AND** 後端不可達時前端 SHALL 誠實顯示錯誤狀態（不偽裝成功、不顯示捏造數值）；3D 標示送出後 SHALL 等 Kit `highlightPrimsResult` 確認再表態，SHALL NOT 在送出當下假稱「已標示」

### Requirement: viewer 的 element_mapping 載入 SHALL 經 coordinator :8004 proxy，SHALL NOT HTTP 直連 :49101

統一治理控制台 overlay 的「在 3D 標示」依賴 viewer 端 `MappingCache`（`ifc_guid → usd_prim_path`）。該 `element_mapping` 文件的載入 SHALL 經 coordinator `:8004`（`GET /api/governance/element-mapping/for-session/:sessionId`），SHALL NOT 由瀏覽器 HTTP 直連 `bim-streaming-server` artifact 端點（`:49101`）。理由：(1) 對齊 `web-viewer-sample` 邊界「所有 file URL 查詢一律透過 coordinator」「與 streaming server 的互動限定於 WebRTC video + DataChannel」；(2) hybrid / LAN 部署下 viewer origin ≠ artifact origin 且 artifact 端點無 CORS，直連必 `Failed to fetch` 使 `MappingCache` 為空、標示恆誤判未對映。

coordinator 端點 SHALL 僅解析 `session → 該 session artifact binding 的 mapping_url` 後，於 server 端經 `config.conversionApiBase`（host 可達位址）抓取並原樣回傳，SHALL NOT 解讀 / 改寫 / 保存 mapping（非新資料權威）。誠實：session 或 mapping 無法解析 SHALL 回 404、conversion 不可達 SHALL 回 502，SHALL NOT 偽造空對映或成功。`element_mapping` JSON shape、governance-service / `bim-streaming-server` 端點、stream-config data shape SHALL NOT 改動；SHALL NOT 新增生產依賴；SHALL NOT 給 `:49101` 直接加 CORS（改走 coordinator proxy 才合邊界）。

#### Scenario: viewer 經 coordinator proxy 載入 element_mapping 並能解析有對映構件

- **WHEN** primary viewer 有當前 `reviewSessionId` 且 overlay 需要 `MappingCache`
- **THEN** viewer SHALL 經 `GET /api/governance/element-mapping/for-session/:sessionId`（coordinator `:8004`）載入 `element_mapping`，SHALL NOT 直接 `fetch` 指向 `:49101` 的 `mapping_url`
- **AND** coordinator SHALL 解析該 session 的 `mapping_url`、於 server 端抓取後原樣回傳（200 + 同一 JSON shape），使 viewer `MappingCache` 對「有有效 `usd_prim_path` 的失敗構件」能解析出 prim 並送出 `highlightPrimsRequest`
- **AND** 無 `reviewSessionId`（debug / 本機直開檔）時 viewer MAY fallback 直接抓 `mapping_url`，不影響合規部署路徑

#### Scenario: 誠實失敗 — session / mapping 無法解析或後端不可達

- **WHEN** 呼叫 `GET /api/governance/element-mapping/for-session/:sessionId`
- **THEN** sessionId 格式非法 SHALL 回 400；session 不存在或該 session 無帶 `mapping_url` 的 artifact binding SHALL 回 404
- **AND** conversion artifact 服務不可達時 SHALL 回 502（不偽造空對映、不假稱成功）
- **AND** coordinator SHALL 僅 resolve + forward，SHALL NOT 改動 `element_mapping` 內容或成為新資料權威

### Requirement: Kit 控制 SHALL 經 coordinator /api/kit/* forward-only proxy，瀏覽器禁直連 :8010

`#/kit` 模型台與所有 Kit 狀態查詢 SHALL 經 coordinator `:8004 /api/kit/*` forward-only reverse-proxy 至 kit-manager `:8010`（loopback）。瀏覽器 SHALL NOT 直連 `:8010`。Kit 控制權威 SHALL 留 kit-manager（coordinator 僅轉發，不成為 Kit 權威；守 RK1）；變更型 `/api/kit/*` 請求 SHALL 需 operator/dev 授權（無授權回 403）。

#### Scenario: forward 取得 kit-manager 資料、無直連 :8010、變更型需授權

- **WHEN** 真人於 `:8004/ui#/kit` 點「查 Kit 狀態」
- **THEN** 三個欄位 SHALL 由 coordinator `/api/kit/*` forward 回 kit-manager 並原樣顯示 HTTP 狀態，瀏覽器 SHALL NOT 對 `:8010` 發任何請求
- **AND** 變更型 `POST /api/kit/instances/current/open` 無 token SHALL 回 403、帶 dev token SHALL 被轉發（非 403）
- **AND** SHALL 具 browser E2E 證據（`kit-proxy`）

### Requirement: 真實 ./storage IFC 垂直切片 SHALL frontend-operable 且誠實 runtime，不偽造成功

`#/demo-control` SHALL 讓真人從前端選真實 `./storage/*.ifc`（清單由 `GET /api/dev/ifc-sources` 提供，回應 SHALL 為契約 shape：`source_id`/`filename`/`relative_path`/`size_bytes`/`modified_at`，SHALL NOT 洩漏絕對檔案系統路徑或 `source_ref`），按一顆按鈕觸發真實註冊與轉檔（`POST /api/dev/ifc-sources/:sourceId/register`：coordinator 內部 loopback self-fetch → 既有 `POST /api/external/ifc-ready` 真進件 → streaming-server 真轉檔派工）。runtime 狀態 SHALL 誠實顯示（`converting`/`ready`/`runtime_blocked`/`conversion_timeout`/`download_failed`），SHALL NOT 在轉檔慢 / 阻塞時偽造成功；IFC byte 取用 SHALL loopback-only（瀏覽器不可達）。畫面 SHALL 顯示完整 lineage（`source_id`/`model_version_id`/`conversion_job_id`/`artifact_id`/`usdc_url`/`mapping`），ready 後 SHALL 可經凍結 `/ui/open?session=` 進 viewer 並顯示來源 IFC lineage + USDC artifact。

#### Scenario: 從前端選真 IFC → 真轉檔派工 → 誠實 runtime + lineage

- **WHEN** 真人於 `:8004/ui#/demo-control` 選真實 `./storage/*.ifc` 並按「註冊並轉檔（真實）」
- **THEN** 下拉 SHALL 由真 coordinator `GET /api/dev/ifc-sources` 填出真實 `./storage *.ifc`（無絕對路徑），register 後 SHALL 出現真實 `download_status=downloaded` + streaming `conversion_job_id`（`stream_conv_*`）+ lineage 欄位
- **AND** runtime 狀態 SHALL 落在誠實值（`converting`/`ready`/`runtime_blocked`/`conversion_timeout`/`conversion_failed`），畫面 SHALL NOT 顯示絕對檔案系統路徑或 public ifc-file byte URL
- **AND** SHALL 具 browser E2E 證據（`real-ifc-storage-intake`；轉檔 ready 後 `real-ifc-conversion-lineage` / `real-ifc-viewer-lineage` 佐證真 `model.usdc` + `element_mapping.json` + `artifact_id`）

### Requirement: primary / spectator 角色權威 SHALL 三層縱深，Stage/Artifact Binding SHALL 交易式套用

控制台 SHALL 以三層縱深落實 primary/spectator 角色權威：(1) UI `disabled` + `aria-disabled` + 誠實 readonly banner；(2) 前端 command 層 spectator SHALL NOT 送 mutating 指令；(3) 後端 coordinator `POST /api/review-sessions/:id/stage-binding` SHALL 以 `source_client_id`/primary 判定授權（非 UI-only gate）。Stage/Artifact Binding SHALL 交易式：選 1..N 個 ready USDC → 指定唯一 primary → 設 load_order → production runtime 送 `loadArtifactGroupRequest` + `stage_composition`，SHALL 等 Kit `openedStageResult` / `loadArtifactGroupResult` 與 coordinator `stageBindingApplied` audit 確認才宣告 applied 並保留 last-good revision，SHALL NOT 在送出當下偽宣告成功。`composeStageRequest` / `bindingApplied` 僅可作為 harness/legacy fakeKit path，不得作為 production Kit runtime proof。

#### Scenario: spectator 唯讀且不送 mutating；primary binding 交易式套用

- **WHEN** spectator 開啟 viewer overlay、primary 套用 Stage/Artifact Binding
- **THEN** spectator SHALL 見控制為 `disabled` + `aria-disabled` + 誠實 banner 且 SHALL NOT 送出 mutating；primary 套用後 SHALL 於 production Kit `openedStageResult` / `loadArtifactGroupResult` 與 coordinator `stageBindingApplied` audit 確認後出現 active binding revision
- **AND** SHALL 具 browser E2E 證據（`primary-spectator-authority`、`stage-artifact-binding`）

### Requirement: primary 治理 viewer SHALL 採範本式全幅語意驗證版面，A1/A2/A3 operation 與 IFC 語意 metadata 清楚分區

primary 治理 viewer SHALL 以全幅多分區版面呈現（對齊使用者核可範本 6 面板：模型資訊、IFC 語意、結構樹、GUID⇔Prim 對構表、幾何定位、Pset/空間關係），SHALL NOT 沿用固定窄 overlay 把所有面板堆疊吃滿捲軸。A1/A2/A3 治理 operation（rule-run 觸發、失敗構件→3D 高亮、issue/BCF、Stage/Artifact Binding）SHALL 收進清楚的操作分頁/區段，IFC 語意 metadata SHALL 於語意視圖分區呈現；既有能力（rule-run/highlight/issue/BCF/BindingComposer、spectator 三層權威、MappingCache/HighlightBridge）SHALL 全保留。版面 SHALL 遵循 `docs/frontend/frontend-design-guidelines.md`（深色操作員風、語義色、無障礙 WCAG AA、無 AI-slop 紫漸層白底）。

#### Scenario: 全幅 6 分區版面 + 治理操作分頁，既有能力保留

- **WHEN** 真人開 primary 治理 viewer
- **THEN** SHALL 見全幅多分區版面（模型資訊卡 / 結構樹 / 中央視區+工具列 / 對構表 / IFC 語意 + 空間 inspector），SHALL NOT 是單一窄 overlay 堆疊捲軸
- **AND** A1/A2/A3 operation SHALL 可於操作分頁/區段觸發（rule-run、失敗構件→3D 高亮、issue/BCF、Binding），spectator SHALL 維持三層唯讀權威
- **AND** SHALL 具 browser E2E 截圖證據（`gov-viewer-layout`）

### Requirement: 中央 3D 視區 SHALL 誠實不空白（無 GPU 時資訊濃密 mock viewport，有 GPU 時真 Kit 幀）

中央視區 SHALL NOT 在無 GPU/harness 情境呈現「空白且無說明」的畫面。當無真實 WebRTC 視訊幀時（`harnessEnabled()` 或 `!_hasRemoteVideoFrame()`），SHALL 呈現資訊濃密 mock viewport 並明確標示為「deterministic · no-GPU」，使檢視者不致誤判為壞掉；當真實 Kit 視訊幀可用時，SHALL 自動切換為真實 `<video>` 串流。mock viewport 現行呈現的欄位為 **Stage URL、loaded prim 數、WebRTC 狀態、loaded layers、selected prim**；`camera 狀態` 與獨立的 `highlight echo` 欄位 SHALL NOT 被描述為已具備（`MockViewport.tsx` 全檔 `grep -n "camera"` 零命中）。mock viewport SHALL 為可決定性（同輸入同輸出）、不依賴 GPU、不引入新 3D 引擎生產依賴。

#### Scenario: harness/無 GPU 時中央視區顯示資訊而非空白

- **WHEN** 在 harness/無 GPU 情境開 viewer
- **THEN** 中央 SHALL 顯 mock viewport（Stage URL／loaded prims／WebRTC 狀態／loaded layers／selected），明標 no-GPU 決定性，SHALL NOT 全空白
- **AND** 點**對構表**元件 SHALL 在 mock viewport 產生可見 selection 回饋（`data-testid="mock-selected"`）
- **AND** 點**結構樹**目前 SHALL NOT 被描述為會產生回饋：`MockViewport.tsx` 未傳選取 callback 給 `StructureStats`，`StructureStats` 亦未接上 `StructureStatsView` 的 `onSelectClass`，`SpatialTreeView` 無點擊處理
- **AND** 有真實 Kit 視訊幀時 SHALL 自動切真 `<video>`；其 E2E 截圖證據屬部署驗證範圍，SHALL NOT 由本 spec 的措辭收斂視為已取得

### Requirement: IFC 語意/結構/空間面板 SHALL 經 coordinator resolve+forward 取真實 per-element 語意，缺資料誠實標示

② IFC 語意（Type/PredefinedType/ObjectType/Tag/Pset_*/Quantity_*）、③ 分層結構樹（IfcProject>Site>Building>Storey + type 計數）、⑥ 空間關係（Contained In/Building/Site）SHALL 由真實 IFC 語意提供：governance-service SHALL 以 `ifcopenshell`（`get_psets`/`get_container`）萃取 per-element 語意；前端 SHALL 只經 coordinator `:8004` 的 `GET /api/governance/elements/for-session/:sessionId/:guid`（coordinator resolve session→server IFC 路徑後 forward），SHALL NOT 直連 governance-service `:49102`。① 模型資訊與 ④ GUID⇔Prim 對構表 SHALL 用現有真實 artifact（`quality_metrics_summary`/`element_mapping.json`，含 fake-vs-real 隔離）。⑤ 幾何（Bounding Box/體積/材質）與分類碼（MasterFormat/OmniClass/Uniformat）目前無 pipeline 來源者，SHALL 誠實標示為 roadmap/N/A，SHALL NOT 捏造數值。coordinator SHALL 僅 resolve+forward（不執行語意萃取、不成為新資料權威），SHALL NOT 新增生產依賴。

#### Scenario: 點構件取真實 Pset/空間，缺資料誠實 roadmap

- **WHEN** 真人於 viewer 點選一個 IFC 構件
- **THEN** ② 面板 SHALL 顯該構件真實 IFC Type/PredefinedType/Tag + Pset/Quantity（經 coordinator forward 自 governance-service ifcopenshell 萃取），⑥ 面板 SHALL 顯真實空間容納關係
- **AND** ① 模型資訊與 ④ 對構表 SHALL 顯現有真實 artifact 值（fake mapping 時顯 fake banner、不冒充）
- **AND** ⑤ 幾何/分類碼無來源時 SHALL 顯 `—`/roadmap 標示，SHALL NOT 捏造；前端 SHALL 只打 :8004

### Requirement: primary viewer SHALL 提供「模型 / 問題」分頁，問題分頁以全幅呈現 A1/A2/A3 治理操作且無 GPU 亦可用

primary 治理 viewer SHALL 提供分頁切換：「模型」分頁呈現語意檢視（3D/mock viewport + ①②③④⑥ 面板），「問題」分頁以**全幅**呈現既有 `GovernanceOverlay` 的 A1/A2/A3 治理操作（rule-run 觸發、失敗構件清單→3D 高亮、issue/BCF、Stage/Artifact Binding）。分頁列 SHALL 位於 viewer 層（非 MockViewport 內），使「問題」分頁隱藏 MockViewport 後仍可切回「模型」。「問題」分頁的治理操作 SHALL 在無 live 3D 幀（無 GPU/Kit）時仍可用（rule-run 經 coordinator for-session、issue/BCF 經 governance proxy）；其中需 DataChannel 的 3D 高亮 SHALL 誠實降級（disabled + 理由），SHALL NOT 假裝可用。spectator 三層唯讀權威 SHALL 於兩分頁皆保留。

#### Scenario: 模型↔問題 分頁切換，問題分頁全幅治理且無 GPU 可操作

- **WHEN** 真人於 primary viewer 點「問題」分頁
- **THEN** SHALL 隱藏語意檢視、以全幅呈現 A1/A2/A3 治理面板（rule-run 控制可見可操作），SHALL NOT 仍擠在固定 340px 右側窄欄
- **AND** 在無 live 3D 幀時 rule-run/issue/BCF SHALL 仍可用，需 DataChannel 的 3D 高亮 SHALL 誠實 disabled（不假裝可用）
- **AND** 點「模型」分頁 SHALL 切回語意檢視（3D/mock viewport + ①②③④⑥）；spectator SHALL 維持唯讀權威
- **AND** SHALL 具 browser E2E 證據（分頁切換 live 驗 + harness 不空白回歸）

### Requirement: 取得真實 Kit 幀後語意面板 SHALL 與 live 3D 並存（不消失），且 banner 誠實表態

primary 治理 viewer 的「模型」分頁，於取得真實 WebRTC/Kit 視訊幀（`_hasRemoteVideoFrame()` 為真）後，語意檢視面板（①模型資訊 ②IFC語意 ③結構 ④對構表 ⑥空間）SHALL 持續存在並與中央 `<video>` live 3D **並存**（呈現為左側語意側欄，對齊 AI-BIM-Geo Viewer 範本：面板環繞中央 3D），SHALL NOT 因出幀而整片卸載/消失。側欄 SHALL NOT 覆蓋中央 live 3D，亦 SHALL NOT 與右側 A1–A10 治理 overlay 水平重疊。

出幀後語意側欄的 banner SHALL 誠實標示「live 3D 已出幀」狀態，SHALL NOT 仍宣稱「no-GPU / deterministic」（誠實鐵律：不得在 GPU 實際出畫面時謊稱無 GPU）。未出幀時 SHALL 維持中央 deterministic·no-GPU 資訊濃密佔位（非空白、非壞掉）。

②④⑥ 之資料 SHALL 仍經 coordinator `:8004` 的 for-session / element-mapping proxy 取得（不直連 :49101/:49102）；⑤幾何/材質與分類碼無 pipeline 來源時 SHALL 誠實標 roadmap/N/A，SHALL NOT 捏造。

#### Scenario: 真實 session 出 live 3D 後，點對構表構件仍可見 ②IFC語意 + ⑥空間

- **WHEN** 真人開啟有真實 Kit 幀的 session（GPU 出畫面）並停在「模型」分頁
- **THEN** 中央 SHALL 顯 live 3D `<video>`，左側 SHALL 同時呈現語意側欄（①③ + ④對構表 row），語意面板 SHALL NOT 因出幀而消失
- **AND** 側欄 banner SHALL 顯「live 3D 已出幀」（誠實），SHALL NOT 顯「no-GPU」
- **AND** 點④對構表第一列構件 SHALL 於 ②IFC語意 顯該構件真實 Type/Property（經 for-session proxy），⑥空間顯容納鏈，⑤幾何/分類碼誠實標 roadmap
- **AND** SHALL 具 browser E2E 證據（點構件 live 驗）+ 截圖（左側語意側欄 + 中央 live 3D + 右側治理 overlay 並存）

### Requirement: viewer 前端入口 SHALL 為 :5173 docker viewer，其前端改動 MUST 重建 viewer image 始生效

`coordinator :8004 /ui/open` SHALL 以 302 轉址至 `viewer :5173`（docker `web-viewer-sample` 服務，`vite dev` 跑 baked source、無 bind-mount）。因此 viewer 前端（Window/MockViewport/console 等）之改動 MUST 重建 docker `viewer` image 後始於 `/ui/open` 入口生效；僅重建 `:8004/ui/` dist-ui console（`npm run build:ui`）SHALL NOT 視為已部署 viewer 入口改動。`scripts/deploy.ps1` golden path SHALL 涵蓋 viewer image build，使 merge 後一鍵部署即反映。

#### Scenario: viewer 前端改動經重建 image 後在 /ui/open 入口生效

- **WHEN** 修改 viewer 前端碼並欲於 `/ui/open` 入口驗證
- **THEN** SHALL 重建 docker `viewer` image 並 `up -d viewer`，SHALL NOT 以「只 build dist-ui」當作已部署
- **AND** 驗證 SHALL 針對 `/ui/open` 實際轉址之 `:5173` 入口（或等價最新碼 dev server），SHALL NOT 誤針對陳舊 baked 容器而得「改了沒效」之假象

### Requirement: Product Governance Console Shell

The web frontend SHALL present `/ui` and `/console` as a complete AI-BIM Governance operator console with grouped left navigation. 現行分組為兩組——「工作台」（`navMain`）與「AI 應用模組」（`apps`），來源為 `unified/fixtures.ts`。本 requirement SHALL NOT 宣稱存在 Workspace / Core Governance / Omniverse Runtime / Coordinator-Edge Control / System 五組導覽。

#### Scenario: Operator opens the product console
- **WHEN** the operator opens `/ui` without a `session` query
- **THEN** the frontend renders the governance console shell composed of top runtime status（Coordinator／Governance／Kit Runtime chips）、grouped left navigation（「工作台」與「AI 應用模組」兩組）、central workspace、and a toast host
- **AND** the shell SHALL NOT be described as providing a Chat USD Agent side panel：`UnifiedShell.tsx` 全檔 `grep -rn "Chat USD"` 零命中，該面板僅存在於 `LegacyEdgeConsole`

#### Scenario: Viewer session attach remains separate
- **WHEN** the browser opens `/ui?session=review_session_x`
- **THEN** the frontend does not mount the operator console and preserves the existing viewer attach path

### Requirement: A1-A10 Pages Preserve Prototype Intent

The frontend SHALL provide an operator-facing page for A1 through A10, with each page explaining the function purpose, expected UI presentation, backend dependencies, and honest provenance. `a1`／`a2`／`a3` 三個 route 自 IA v2 起由 UnifiedConsole workspace 承接（`UNIFIED_WS_KEYS`），其 dock 互動為 fixture 語意；本 requirement SHALL NOT 以 `#issues` 底下 `IssuesRuleCenterPage` 的能力充作 A1 route 的交付面。

#### Scenario: Operator opens A1
- **WHEN** the operator navigates to A1 Governance & Rule Checker
- **THEN** the page mounts `WorkspacePage` with `initialDock="a1"`, showing rule selection, a run CTA, a result scoreboard, issue creation, and BCF export
- **AND** the A1 dock SHALL NOT be described as providing upload/select model or Excel delivery：`grep -rni "excel|xlsx" src/console/unified/` 零命中；`A1DockLive` 僅在 `/health` 探活成功時掛載並提供 library IFC 選取、rule-run 與歷史列表，亦無 Excel 匯出。Excel 交付面位於 `#issues`
- **AND** 該 dock 的互動 SHALL 誠實標示為 fixture 語意（不打 `/api`），SHALL NOT 呈現為 live system evidence

#### Scenario: Operator opens roadmap apps
- **WHEN** the operator navigates to A4, A5, A6, A7, A8, A9, or A10
- **THEN** the page labels backend capabilities as roadmap or not built and does not present them as live system evidence

### Requirement: Viewer Presentation Page
The frontend SHALL include a 3D Viewer presentation page that tells the operator what the live viewer can show and which operations are backed by existing WebRTC/DataChannel behavior.

#### Scenario: Operator opens 3D Viewer page
- **WHEN** the operator navigates to the 3D Viewer presentation page
- **THEN** the page lists stage loading, selection, focus, highlight, mapping table, semantic panel, first-frame evidence, and DataChannel limitations

### Requirement: Coordinator Edge Control Pages
The frontend SHALL include Coordinator pages for IFC→USD conversion scheduling, Session management, Kit/GPU fleet, and MinIO data relationships.

#### Scenario: Operator opens conversion scheduling
- **WHEN** the operator navigates to IFC→USD conversion scheduling
- **THEN** the page shows intake source, queue, conversion authority, mapping coverage, writeback, and Kit notification lifecycle using existing data when available

#### Scenario: Operator opens session management
- **WHEN** the operator navigates to Session management
- **THEN** the page shows primary/spectator endpoint states, first-frame evidence gate, heartbeat, stale reclaim policy, and controlled action rules

#### Scenario: Operator opens Kit/GPU fleet
- **WHEN** the operator navigates to Kit/GPU fleet
- **THEN** the page shows that 1 GPU maps to 1 Kit stream, draining prevents new sessions, and migration means terminate plus recreate rather than seamless movement

#### Scenario: Operator opens MinIO data
- **WHEN** the operator navigates to MinIO data
- **THEN** the page shows bucket, project/model/version structure, source files, parsed files, generated `model.usdc`, and pending gaps without pretending to be a real S3 browser

### Requirement: Honest Evidence and Provenance
Every user-facing capability shown in the product console SHALL mark whether the evidence is implemented, artifact-tested, demo data, backend pending, or roadmap.

#### Scenario: Operator inspects a not-built action
- **WHEN** a capability is not backed by current API/runtime behavior
- **THEN** the UI disables the action or labels it as pending/roadmap and explains the missing backend or evidence
