# edge-console-operator-frontend Specification

## Purpose
落地端操作員（edge operator）SHALL 能在瀏覽器 `/console` 路徑，以誠實 provenance 標記的單一操作介面驗證 A1–A3 治理能力（rule-run / version-diff / federation）並檢視 A4–A10 願景藍圖。前端 SHALL 只經 `bim-review-coordinator`（`:8004`）proxy 操作後端、SHALL NOT 直連 governance-service（`:49102`），SHALL NOT 顯示任何願景假數字；掛載於 `/console` SHALL NOT 改變既有 viewer App 行為。
## Requirements
### Requirement: 落地端 SHALL 提供誠實的 Edge Console 操作員前端

`web-viewer-sample` SHALL 在 `/console` 路徑提供 Edge Console；每個資料區塊與按鈕 SHALL 帶 provenance 標記（asbuilt / artifact / demo / p1 / p15）；SHALL NOT 顯示任何願景假數字。掛載 SHALL NOT 改變既有 viewer App 在其他路徑的行為。自 IA v2 起，無 hash 時的預設落地畫面為 `UnifiedShell`（`usePageHash()` 無 hash 回 `"home"` → `renderUnified` 的 `case "home"`），其側欄分組來自 `unified/fixtures.ts` 的 `navMain`／`apps`，標題為「工作台」與「AI 應用模組」；**兩段式導覽（Governance Platform 零 GPU / Omniverse Runtime 綁 GPU）僅存在於 `LegacyEdgeConsole`，且只在 legacy 深連結（`#overview`／`#issues`／`#minio` 等）才渲染**。本 requirement SHALL NOT 宣稱兩段式導覽是 `/console` 的預設落地畫面。

#### Scenario: 兩段式導覽與 provenance 誠實標記

- **WHEN** 操作員開啟 `/console`（無 legacy 深連結 hash）
- **THEN** 前端 SHALL 渲染 `UnifiedShell`，側欄分組為「工作台」與「AI 應用模組」
- **AND** 每個資料 / 按鈕 SHALL 帶 provenance 標記
- **AND** SHALL NOT 顯示已被移除的願景假數字（如 127 rules / 99.1% GUID / 92.4% mapping）
- **AND** 兩段式導覽 SHALL 僅在 legacy 深連結渲染 `LegacyEdgeConsole` 時出現，SHALL NOT 被描述為預設畫面

#### Scenario: 不擾動既有 viewer

- **WHEN** 使用者開啟非 `/console` 路徑（既有 viewer 入口）
- **THEN** 前端 SHALL 渲染既有 `<App/>` viewer，行為不變

### Requirement: Edge Console SHALL 經 coordinator proxy 操作 A1 rule-run

Edge Console SHALL 只透過 `bim-review-coordinator`（`:8004`）的 `/api/governance/*` proxy 觸發與讀取 A1 rule-run，SHALL NOT 直連 governance-service（`:49102`）。後端不可用時 SHALL 誠實顯示未連線，SHALL NOT 假裝成功或捏造結果。

#### Scenario: 經 proxy 觸發 rule-run

- **WHEN** 操作員在 Rule Center 點「執行規則檢核」
- **THEN** 前端 SHALL 呼叫 coordinator `/api/governance/rule-runs`
- **AND** SHALL NOT 直接連線 `127.0.0.1:49102`
- **AND** coordinator SHALL 以 loopback 透傳至 governance-service

#### Scenario: 後端未連線誠實顯示

- **WHEN** governance-service 未啟動
- **THEN** coordinator proxy SHALL 回傳 502（非 200）
- **AND** 前端 SHALL 顯示未連線提示，SHALL NOT 顯示捏造的 rule-run 結果

### Requirement: A1 SHALL 在介面可驗證；A2/A3 SHALL 以 as-built 操作頁呈現

Edge Console SHALL 讓 A1 在介面可驗證：顯示真實 IFC 實測 artifact 與規則集，並能觸發實時 rule-run。A2（模型版本差異）/ A3（跨專業 Federation）後端已落地，其 as-built 操作頁（Diff Builder / Federation Builder，經 coordinator proxy）**現位於 `#version-diff`／`#federation`**。nav 上標 `A2`／`A3` 的項目 route key 為 `a2`／`a3`，自 IA v2 起與 `a1` 同被 `UNIFIED_WS_KEYS` 攔下、掛載 fixture `WorkspacePage`。規則集中各項 SHALL 依其後端實際落地狀態標 provenance：已落地（rule-run / IDS 匯入 / BCF 匯出 / Issue 生命週期資料庫）標 `asbuilt`，僅待建項才標 `p1` / `p15`。

#### Scenario: A1 顯示真實實測 artifact

- **WHEN** 操作員開啟 A1 Rule Center
- **THEN** 前端 SHALL 顯示來自 committed evidence 的真實實測值（標 artifact，非 demo、非捏造）
- **AND** SHALL 顯示規則集，其中已落地項（IDS 匯入 / BCF 匯出 / Issue DB）SHALL 標 `asbuilt`，不誤標待建

#### Scenario: A2/A3 為 as-built 操作頁並誠實標邊界

- **WHEN** 操作員開啟 `#version-diff` 或 `#federation`
- **THEN** 前端 SHALL 顯示經 coordinator proxy 操作後端的 as-built 操作頁（Diff Builder / Federation Builder）
- **AND** SHALL 誠實標示真實邊界（如 member USD immutable、3D overlay 走 client highlight）
- **WHEN** 操作員改由 nav 點「A2 版本差異與責任」／「A3 跨專業疊合」（route key `a2`／`a3`）
- **THEN** 掛載的是 fixture `WorkspacePage`，其 dock 標 `data-prov="fixture"`、不打任何 `/api`
- **AND** 該 fixture dock 逐字渲染的版本差異數字與 API toast SHALL NOT 被當作真實後端結果；**此為已知缺口**：spec 原本要求的「SHALL NOT 顯示任何捏造的版本差異或 federation 數字」在 `a2`／`a3` route 上目前不成立，SHALL 以 known gap 揭露，SHALL NOT 由本次措辭收斂視為已解決

### Requirement: provenance 型別 SHALL 接受後端權威值（含 artifact）

Edge Console 任何帶 provenance 的元件（含 `StubPage` 等頁面骨架）SHALL 以 `data.ts` 既有的單一真相 `Prov` 型別標註其 provenance 欄位，SHALL 接受全部權威值 `asbuilt | artifact | demo | p1 | p15 | p3 | p4`（其中 `p3` = RM phase 3 願景、`p4` = RM phase 4 願景，與 `data.ts` Prov 型別及 A4–A10 roadmap prov 標示一致）。SHALL NOT 在頁面層自行寫死缺漏值的窄化 union，以免合法的後端權威 provenance（如真實實測 `artifact`、或願景標示 `p3`/`p4`）無法標示而觸型別錯誤。

#### Scenario: 頁面骨架可標示 artifact provenance

- **WHEN** Model Intake / Semantic Viewer 等頁以 `StubPage` 標示來自 committed evidence 的真實實測項
- **THEN** 該項 SHALL 能以 `provenance="artifact"` 標示
- **AND** 型別檢查（`tsc --noEmit`）SHALL NOT 因 `'artifact'` 報 TS2322
- **AND** provenance 欄位型別 SHALL 等同 `data.ts` 的 `Prov`（`asbuilt | artifact | demo | p1 | p15 | p3 | p4`），不另寫死窄化 union

### Requirement: mediaPort 型別 SHALL 與串流 library 相容（number | undefined）

viewer 串流端點的 `mediaport` 流經處（`StreamEndpoint`、`AppProps`、`AppStreamProps` 及其建構與賦值點）SHALL 與串流 library `DirectConfig.mediaPort`（`number | undefined`）相容。實作 SHALL 支援**兩種**「未指定」哨兵：`undefined` 與 `0`——standalone `App` 路徑逐字宣告 `mediaport: number` 並以 `0` 作為未指定值（`App.tsx:74,100,129`），其值直接餵進 `AppStreamProps`。SHALL NOT 讓 `null` 流入 `DirectConfig.mediaPort`；兩種哨兵下 SHALL 一律略過該欄，交由 library 套用預設。

#### Scenario: 缺 mediaPort 時不傳 null 給串流 library

- **WHEN** 串流端點未指定 media port（query / streamConfig / 本機 config 皆無）
- **THEN** `mediaport` SHALL 為 `undefined` 或 `0`（兩者皆為合法的未指定哨兵，SHALL NOT 為 `null`）
- **AND** `AppStream` 建構 `DirectConfig` 時 SHALL 以 `mediaport != null && mediaport !== 0` 條件展開，略過 `mediaPort` 欄，不指派 `null`
- **AND** 型別檢查（`tsc --noEmit`）SHALL NOT 因 `mediaPort` 型別不相容報 TS2322

#### Scenario: 有 mediaPort 時透傳數值

- **WHEN** 串流端點指定了非 0 的 media port
- **THEN** `AppStream` SHALL 將該數值指派給 `DirectConfig.mediaPort`

### Requirement: UI provenance 標示 SHALL 與實際落地一致（BCF 匯出為 asbuilt）

Edge Console 的 provenance 標示 SHALL 與後端實際落地狀態一致。BCF 2.1 匯出後端已落地（`governance-service/bcf/` 匯出模組純 stdlib、不 import GPLv3 `bcf-client`、產物不含其程式碼；惟 `ifctester` 會在環境 transitive 安裝 `bcf-client`，見 `governance-bcf-export` spec）且前端按鈕可用，故相關標示 SHALL 標為 `asbuilt`（已實作），SHALL NOT 標為 `p1` / `p15`（待建）。資料體與其說明註解 SHALL NOT 自相矛盾。

#### Scenario: BCF 匯出標已實作

- **WHEN** 操作員開啟 Overview 或 A1 Rule Center 規則集
- **THEN** BCF 匯出（issue→.bcfzip）項 SHALL 標 `asbuilt`（已實作）
- **AND** 說明 SHALL 誠實描述「匯出模組純 stdlib、不 import GPLv3 `bcf-client`」（SHALL NOT 宣稱整個環境不依賴 GPLv3——`ifctester` 會 transitive 安裝之）
- **AND** SHALL NOT 標為待建（p1 / p15）

#### Scenario: 資料註解與資料體一致

- **WHEN** 讀 `data.ts` 的 A1–A10 清單與其註解
- **THEN** 註解描述的落地狀態 SHALL 與資料體的 `prov` 值一致
- **AND** A2 / A3 SHALL NOT 在註解被描述為「前端骨架 + spec（p1）」而資料體已是 `asbuilt`

### Requirement: console A1/A2/A3 client SHALL 用與全站／部署一致的 coordinator base env 名

Edge Console 的治理 client（A1 rule-run、A2 diff、A3 federation，以及 Issue / BCF 操作）SHALL 以與全站 viewer 及部署鏈一致的正規環境變數名 `VITE_COORDINATOR_API_BASE` 取得 coordinator base。SHALL NOT 僅讀任何非正規、未被部署腳本 / compose 設定的 env 名（如僅讀 `VITE_COORDINATOR_BASE`）而在部署指向非預設 coordinator 時讀不到值。MAY 保留舊名 `VITE_COORDINATOR_BASE` 為相容 fallback，但正規名 SHALL 優先。未設定任一名時，預設 base 由 `defaultCoordinatorBase()` 決定，其**有兩個分支**：部署於 coordinator `/ui` 且非 dev port（5173／5174／5180）時回 `window.location.origin`（same-origin），否則回 `http://127.0.0.1:8004`。本 requirement SHALL NOT 宣稱該預設在所有情境下都等同 `config/env.ts` 的 viewer 預設——viewer 端恆為 `http://127.0.0.1:8004`，無 same-origin 分支。

#### Scenario: 部署指向非預設 coordinator 時治理 client 連對位址

- **WHEN** 部署經 `VITE_COORDINATOR_API_BASE`（compose build-arg / `deploy.ps1` 的 `WEB_VIEWER_COORDINATOR_API_BASE`）設定非預設 coordinator base
- **THEN** console 的 A1/A2/A3 + Issue + BCF client SHALL 以該值為 coordinator base
- **AND** SHALL NOT fallback 到寫死預設 `http://127.0.0.1:8004`
- **AND** 其 coordinator base SHALL 與 viewer（AppStream / Window）取得的值同源（同一 env 名）

#### Scenario: 未設定時預設與 viewer 一致

- **WHEN** 環境未設定 `VITE_COORDINATOR_API_BASE` 亦未設定舊名 `VITE_COORDINATOR_BASE`，且前端由 coordinator `/ui` 提供（非 dev port）
- **THEN** console 治理 client 的 coordinator base SHALL 為 `window.location.origin`（same-origin）
- **AND** 此為部署常態而非邊角：`infra/docker/coordinator-web-plane.Dockerfile` 的 `RUN npm run build:ui` 未帶任一 coordinator base build arg，故 `/ui` bundle 一律走此分支
- **WHEN** 前端由 dev port（5173／5174／5180）提供
- **THEN** 預設 SHALL 為 `http://127.0.0.1:8004`，與 `config/env.ts` 的 viewer 預設一致

#### Scenario: 舊名相容但正規名優先

- **WHEN** 同時設定 `VITE_COORDINATOR_API_BASE` 與舊名 `VITE_COORDINATOR_BASE`
- **THEN** SHALL 採用正規名 `VITE_COORDINATOR_API_BASE` 的值

### Requirement: A1 Rule Center SHALL 提供真實 Excel 匯出與誠實標示的 3D 標示入口

A1 Rule Center（`IssuesRuleCenterPage`）SHALL 提供 [匯出 Excel] 入口，經 coordinator proxy `GET /api/governance/rule-runs/:id/export?fmt=excel` 觸發 governance-service 真實匯出並下載，標 `asbuilt`；成功 rule-run 前 SHALL `disabled`（無 run 不可匯出）。A1 SHALL 提供 [在 3D 中標示] 入口；因 Edge Console（`/console`）與 viewer（`<App/>`）互斥掛載、殼層無 WebRTC DataChannel，`highlightPrimsRequest` 鏈未接，該入口 SHALL 標 `p1` 並 `disabled` 且誠實說明「需 viewer DataChannel（後續整合）」，SHALL NOT 呈現為點了無回應的假按鈕；當 failed 構件的 `usd_prim_path` 為 null（未對映到 USD prim）時，SHALL 誠實顯示其無法在 3D 標示。

#### Scenario: Excel 匯出為真實下載且成功 run 前 disabled

- **WHEN** 操作員開啟 A1 Rule Center 但尚未成功跑 rule-run
- **THEN** [匯出 Excel] 按鈕 SHALL 存在且 `disabled`
- **WHEN** rule-run 成功（取得 `runId` 且 `status === "succeeded"`）後點 [匯出 Excel]
- **THEN** 前端 SHALL 呼叫 `governanceClient.exportUrl(runId)`（coordinator proxy 透傳至 governance-service openpyxl 匯出）並下載 `.xlsx`
- **AND** 該入口 SHALL 標 `asbuilt`（已實作），SHALL NOT 標待建

#### Scenario: 3D 標示入口因無 DataChannel 而誠實標 p1（非假按鈕）

- **WHEN** 操作員開啟 A1 Rule Center
- **THEN** [在 3D 中標示] 按鈕 SHALL 標 `p1` 且 `disabled`
- **AND** SHALL 誠實說明需 viewer 的 WebRTC DataChannel（`highlightPrimsRequest`），console 殼層目前無此鏈
- **AND** SHALL NOT 呈現為「點了沒反應」的可點假按鈕

### Requirement: A2 VersionDiff SHALL 經 apply-overlay 端點誠實呈現後端狀態，SHALL NOT 偽裝成功

A2 VersionDiffPage SHALL 提供 [套用 3D Overlay] 入口，經 coordinator proxy `POST /api/governance/diffs/:id/apply-overlay` 呼叫 governance-service。該端點後端誠實回 501（3D 著色走 client `highlightPrimsRequest`，非後端 server-push），故前端 SHALL 標 `p15` 並顯示後端誠實回應（含狀態碼與說明），SHALL NOT 把 501 / 502 偽裝成成功，SHALL NOT 顯示捏造的 overlay 結果。該入口 SHALL 僅在 diff 真的成功（`status === "succeeded"`）時 enable；尚無 diff、diff `failed` 或無結果時 SHALL `disabled`。當 coordinator / base URL 不可達導致 `applyDiffOverlay` 的 fetch reject 時，前端 SHALL 誠實顯示錯誤（無法連線 coordinator / 套用失敗），SHALL NOT 靜默無回應。

#### Scenario: apply-overlay 回 501 時誠實顯示，不偽裝成功

- **WHEN** 操作員在成功 diff 後點 [套用 3D Overlay]
- **THEN** 前端 SHALL 呼叫 coordinator `/api/governance/diffs/:id/apply-overlay`（SHALL NOT 直連 `:49102`）
- **AND** 後端回 501 時前端 SHALL 顯示後端狀態碼（`501`）與誠實說明（走 client `highlightPrimsRequest`，需 viewer DataChannel；非 server-push）
- **AND** 該入口 SHALL 標 `p15`，SHALL NOT 顯示「成功套用 overlay」或任何捏造結果

#### Scenario: 成功 diff 前 apply-overlay 入口 disabled

- **WHEN** 尚未取得成功 diff（無 `diffId`，或 diff `status` 為 `queued` / `running` / `failed`，或尚無結果）
- **THEN** [套用 3D Overlay] 按鈕 SHALL `disabled`
- **AND** 僅在 diff `status === "succeeded"` 時 SHALL enable
- **AND** SHALL NOT 在無成功 diff 時送出 apply-overlay 請求

#### Scenario: coordinator 不可達時 apply-overlay 誠實顯示錯誤，不靜默

- **WHEN** 操作員在成功 diff 後點 [套用 3D Overlay]，但 coordinator / base URL 不可達導致 `applyDiffOverlay` 的 fetch reject
- **THEN** 前端 SHALL 攔截該 reject 並誠實顯示錯誤訊息（無法連線 coordinator / 套用失敗）
- **AND** SHALL NOT 靜默無回應或殘留舊的 overlay 結果

### Requirement: A3 Federation SHALL 提供 build 時 member visibility 並誠實標示須重新 Build

A3 FederationPage SHALL 在 member 表提供 `visible` 切換，於 build 前以 `visibility_default` 帶入 `POST /api/governance/federated-sets/:id/members`。因後端僅提供 build 時 visibility（隱藏 member 寫成 invisible 並於 build 回傳 `hidden[]`）、無「不重建即時切換」端點，前端 SHALL 誠實標示「改 visible 須重新 Build 才生效」，SHALL NOT 捏造即時切換能力。build 成功後 SHALL 顯示後端回傳的 `hidden` members 作為真實證據。

#### Scenario: member visibility 於 build 時帶入且誠實標示須重新 Build

- **WHEN** 操作員在 A3 Federation 取消某 member 的 `visible` 並 Build
- **THEN** 前端 SHALL 以 `visibility_default=false` 帶入該 member 後再 build
- **AND** build 成功後 SHALL 顯示後端回傳的 `hidden members`（visibility=false）
- **AND** 前端 SHALL 誠實標示「無不重建即時切換端點，改 visible 須重新 Build 才生效」，SHALL NOT 宣稱可即時切換 visibility

### Requirement: Overview SHALL 以真實拓樸呈現服務邊界、coordinator 路由與授權風險，SHALL NOT 宣稱零授權風險

OverviewPage SHALL 顯示 BoundaryDiagram，以 WEB-PLANE → CONTROL-PLANE BOUNDARY → INTERNAL 三欄視覺化「瀏覽器只與 coordinator :8004 對話、49100/49101/49102 為內部、瀏覽器永不直連」的邊界。OverviewPage SHALL 顯示 coordinator 已實作 HTTP 路由清單（ENDPOINTS），其內容 SHALL 為查證自 `bim-review-coordinator/src/app.ts` 的真實 route，SHALL NOT 列入查證不存在的幻覺端點。OverviewPage SHALL 顯示相依與授權風險表（DEPENDENCIES），對 LGPL / copyleft 元件 SHALL 明確標示 `copyleft`，SHALL NOT 出現「零授權風險」或「零相依」之宣稱。OverviewPage MAY 接 coordinator `GET /health` 探活；未連線時 SHALL 誠實顯示未取得，SHALL NOT 假裝 healthy。

#### Scenario: DEPENDENCIES 標 copyleft 且不宣稱零授權風險

- **WHEN** 操作員開啟 Overview
- **THEN** 授權風險表 SHALL 出現至少一個 `copyleft` 標示（如 IfcOpenShell / ifctester LGPL-3.0）
- **AND** 畫面 SHALL NOT 包含「零授權風險」「零相依」字串
- **AND** BoundaryDiagram SHALL 呈現「瀏覽器永不直連」之 INTERNAL 欄

#### Scenario: ENDPOINTS 僅列真實 coordinator route，不列幻覺端點

- **WHEN** 操作員開啟 Overview 的「已實作面 · Coordinator HTTP 介面」
- **THEN** 路由清單 SHALL 包含查證為真的 route（如 `/api/runtime/status`、`/api/external/ifc-ready`、`/api/review-sessions/:id/stream-config`）
- **AND** SHALL NOT 列入 `/api/governance/uploads` 或 `/api/governance/runtime/*` 等查證不存在的幻覺端點

### Requirement: Semantic Viewer SHALL 嚴守 mapping fake-vs-real 隔離，SHALL NOT 冒充真實 mapping

SemanticViewerPage SHALL 載入真實 `element_mapping.json`（URL 來自真實 session 或操作員貼入），並以既有 fake-vs-real 隔離規則判定：凡 `mock=true` / `allow_fake_mapping=true` / `summary.fake_mapping_count>0` / 任一 item `mapping_method=fake_for_smoke_test` 一律當 fake。偵測到 fake mapping 時，SemanticViewerPage SHALL 明確標示為示範資料（demo）並聲明「僅可做 smoke test、不列入正式 mapping 驗證」，SHALL NOT 覆蓋或冒充真實 mapping。點構件做 3D highlight 需 viewer 的 WebRTC DataChannel；因 console 殼層與 viewer 互斥掛載、無 DataChannel，該入口 SHALL 標 `p1` 且 `disabled`，SHALL NOT 呈現為點了無回應的假按鈕。

#### Scenario: fake mapping 被標 demo 且拒絕當正式 mapping

- **WHEN** 載入的 mapping 文件帶 `mock=true` / `allow_fake_mapping=true` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test` 任一旗標
- **THEN** SemanticViewerPage SHALL 顯示 fake / mock 警示並將該資料標為示範資料（demo）
- **AND** SHALL 聲明此資料僅可做 smoke test、不列入正式 mapping 驗證
- **AND** SHALL NOT 以該 fake 資料覆蓋或冒充真實 mapping

#### Scenario: 點構件 3D 標示因無 DataChannel 而誠實標 p1（非假按鈕）

- **WHEN** 操作員在 Semantic Viewer 檢視 mapping 列
- **THEN** 「在 3D 標示」入口 SHALL 標 `p1` 且 `disabled`
- **AND** SHALL 誠實說明需 viewer 的 WebRTC DataChannel（focusPrim / highlightPrims），console 殼層無此鏈

### Requirement: Coordinator/Intake/Runtime 頁 SHALL 只打 coordinator :8004 的真實端點，無遙測值 SHALL 標未取得

`coordinatorClient` SHALL 只打 coordinator `:8004` 的 coordinator-owned 端點（`GET /api/runtime/status`、`GET /api/external/ifc-ready`、`GET /api/review-sessions/:id/stream-config`、`GET /health`、`GET /ui/open?session=`），SHALL NOT 直連 `:49100` / `:49101` / `:49102`，SHALL NOT 呼叫查證不存在的幻覺端點。凡由 `coordinatorClient` 供資料的頁面，GPU / Kit 首幀 / conversion 秒數無真實遙測來源者 SHALL 標「未取得」（idle），SHALL NOT 畫成 fail、SHALL NOT 捏造秒數或首幀數。callback outbox 三態直查需 internal token（瀏覽器不可達），SHALL NOT 捏造投遞數。後端離線時 SHALL 誠實顯示未連線，SHALL NOT 假裝成功。**路由現況揭露（已知缺口，非追認）**：舊 `RuntimePage` 入口已刪，`#runtime` 現由 fixture `OpsPage` 承接（`unified/OpsPage.tsx` 檔頭自承「GPU/Kit 固定值照原型抄寫」「不打任何 `/api`」），其畫面渲染具體數字而非「未取得」；`UnifiedShell` 頂列亦帶固定 GPU chip。此與本 requirement 的誠實義務**牴觸**，SHALL 以 known gap 記錄並另行修復，SHALL NOT 因本次措辭收斂而被視為已符合。

#### Scenario: coordinatorClient 只打 :8004 且不含幻覺端點

- **WHEN** B/C/F 頁向後端取資料
- **THEN** 請求 base SHALL 為 coordinator `:8004`
- **AND** SHALL NOT 直連 `:49100` / `:49101` / `:49102`
- **AND** SHALL NOT 呼叫 `/api/governance/uploads` 或 `/api/governance/runtime/*` 等幻覺端點

#### Scenario: GPU / 首幀無遙測標未取得（非 fail，非捏造）

- **WHEN** 操作員開啟由 `coordinatorClient` 供資料的 Coordinator / Intake 頁
- **THEN** GPU / Kit 首幀 / conversion 秒數無真實遙測者 SHALL 標「未取得」（idle）
- **AND** SHALL NOT 畫成 fail，SHALL NOT 顯示捏造的秒數 / 首幀數
- **AND** 後端離線時 SHALL 誠實顯示未連線，SHALL NOT 假裝成功

#### Scenario: fixture Ops 面為已知缺口，SHALL NOT 充作 runtime 遙測

- **WHEN** 操作員開啟 `#runtime`
- **THEN** 掛載的是 fixture `OpsPage`，其數值 SHALL 標 `data-prov="fixture"`
- **AND** 該面 SHALL NOT 被引用為 runtime 遙測證據
- **AND** 「以固定值取代『未取得』」SHALL 記為未解決的誠實性缺口，SHALL NOT 由本 spec 的措辭收斂視為合規

### Requirement: A4–A10 vision 詳頁 SHALL 整段標願景，scenario SHALL 標範例情境且 SHALL NOT 當真實實測

AppsPage 的 A4–A10 roadmap 卡 SHALL 可點並導向泛用 vision 詳頁（`app/<slug>`）。每個 vision 詳頁 SHALL 顯示 DB schema / REST api / UI 面板 / MVP 驗收 / sprint steps / risks，且 SHALL 明確標示「後端未建」（願景，prov `p3`/`p4`：A5=p3、其餘 p4）。詳頁的 scenario SHALL 標示為「範例情境（願景敘事，非真實 run）」，SHALL NOT 將 RM_APPS 內具體數字呈現為本系統真實實測。詳頁的 api 區 SHALL 標示為「願景 API 設計（非已實作 route）」，SHALL NOT 呈現為可呼叫的真實端點。vision 詳頁 SHALL NOT 顯示任何捏造的成功數字（如 99.1% / 92.4%）。

#### Scenario: vision 詳頁明確標後端未建且 scenario 標範例情境

- **WHEN** 操作員從 Applications 點開任一 A4–A10 roadmap 卡
- **THEN** 詳頁 SHALL 顯示「後端未建」之願景標示（prov `p3` 或 `p4`）
- **AND** scenario 區 SHALL 標示為「範例情境」且「非真實 run」
- **AND** api 區 SHALL 標示為「願景 API 設計（非已實作 route）」
- **AND** SHALL NOT 顯示捏造的成功數字（99.1% / 92.4%）

#### Scenario: roadmap 卡可點且 prov 細分對齊 RM phase

- **WHEN** 載入 Applications 的 A4–A10 roadmap 卡
- **THEN** 每張卡 SHALL 帶 `app/<slug>` route（可點）
- **AND** A5 SHALL 標 `p3`（RM phase 3），A4/A6/A7/A8/A9/A10 SHALL 標 `p4`

### Requirement: Review Room v1 SHALL 連到既有 viewer 而不在 console 內嵌 3D，SHALL NOT 改動 viewer 主體

Review Room（G）v1 SHALL 維持殼層狀態並提供「在既有 viewer 開啟」連結，連到既有 viewer 入口（coordinator `GET /ui/open?session=` 之 server-side redirect，及本地 `/?session=`），SHALL NOT 在 console 殼層內嵌 WebRTC 3D viewport。session id 不符 `lwv_` / `review_session_` 前綴格式時連結 SHALL 停用，SHALL NOT 呈現為可點的假連結。Review Room SHALL NOT 改動 `App.tsx` / `Window.tsx`（守 console 邊界）。工具列 SHALL 誠實標 provenance：openStage / focusPrim / selectPrims / clearHighlight 標 `asbuilt`；highlight（client 主動拉）/ section / snapshot 標 `p15`，SHALL NOT 把待建工具標為已實作。

#### Scenario: 提供連到既有 viewer 的真實連結，不在 console 內嵌 3D

- **WHEN** 操作員在 Review Room 輸入合法 review_session_id
- **THEN** 頁面 SHALL 提供 coordinator `/ui/open?session=` 與本地 `/?session=` 連結
- **AND** SHALL 誠實標示 3D viewport 在既有 viewer（非 console 殼層）
- **AND** session id 格式不符時連結 SHALL 停用，SHALL NOT 呈現可點假連結

#### Scenario: 不改動 viewer 主體且工具列誠實標 provenance

- **WHEN** 操作員開啟 Review Room
- **THEN** 頁面 SHALL 誠實標示「不動 App.tsx / Window.tsx」
- **AND** 工具列 section / snapshot SHALL 標 `p15`（待建），SHALL NOT 標為已實作
