# edge-console-operator-frontend（delta）

## MODIFIED Requirements

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
