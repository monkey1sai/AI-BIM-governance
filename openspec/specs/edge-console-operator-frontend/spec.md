# edge-console-operator-frontend Specification

## Purpose
落地端操作員（edge operator）SHALL 能在瀏覽器 `/console` 路徑，以誠實 provenance 標記的單一操作介面驗證 A1–A3 治理能力（rule-run / version-diff / federation）並檢視 A4–A10 願景藍圖。前端 SHALL 只經 `bim-review-coordinator`（`:8004`）proxy 操作後端、SHALL NOT 直連 governance-service（`:49102`），SHALL NOT 顯示任何願景假數字；掛載於 `/console` SHALL NOT 改變既有 viewer App 行為。
## Requirements
### Requirement: 落地端 SHALL 提供誠實的 Edge Console 操作員前端

`web-viewer-sample` SHALL 在 `/console` 路徑提供 Edge Console：兩段式導覽（Governance Platform 零 GPU / Omniverse Runtime 綁 GPU）視覺化雲地邊界；每個資料區塊與按鈕 SHALL 帶 provenance 標記（asbuilt / artifact / demo / p1 / p15）；SHALL NOT 顯示任何願景假數字。掛載 SHALL NOT 改變既有 viewer App 在其他路徑的行為。

#### Scenario: 兩段式導覽與 provenance 誠實標記

- **WHEN** 操作員開啟 `/console`
- **THEN** 前端 SHALL 顯示 Governance Platform 與 Omniverse Runtime 兩段導覽
- **AND** 每個資料 / 按鈕 SHALL 帶 provenance 標記
- **AND** SHALL NOT 顯示已被移除的願景假數字（如 127 rules / 99.1% GUID / 92.4% mapping）

#### Scenario: 不擾動既有 viewer

- **WHEN** 使用者開啟非 `/console` 路徑（既有 viewer 入口）
- **THEN** 前端 SHALL 渲染既有 `<App/>` viewer，行為不變
- **AND** SHALL NOT 因 Edge Console 而改變既有 `?session=` bootstrap

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

### Requirement: A1 SHALL 在介面可驗證；A2/A3 SHALL 為標示待建的骨架

Edge Console SHALL 讓 A1 在介面可驗證：顯示真實 IFC 實測 artifact 與規則集，並能觸發實時 rule-run。A2（模型版本差異）/ A3（跨專業 Federation）後端已落地，SHALL 以 as-built 操作頁呈現（Diff Builder / Federation Builder 經 coordinator proxy 操作），並誠實標示真實邊界（如 member USD immutable），SHALL NOT 顯示捏造的 diff / federation 數字。規則集中各項 SHALL 依其後端實際落地狀態標 provenance：已落地（rule-run / IDS 匯入 / BCF 匯出 / Issue 生命週期資料庫）標 `asbuilt`，僅待建項才標 `p1` / `p15`。

#### Scenario: A1 顯示真實實測 artifact

- **WHEN** 操作員開啟 A1 Rule Center
- **THEN** 前端 SHALL 顯示來自 committed evidence 的真實實測值（標 artifact，非 demo、非捏造）
- **AND** SHALL 顯示規則集，其中已落地項（IDS 匯入 / BCF 匯出 / Issue DB）SHALL 標 `asbuilt`，不誤標待建

#### Scenario: A2/A3 為 as-built 操作頁並誠實標邊界

- **WHEN** 操作員開啟 A2 或 A3 頁
- **THEN** 前端 SHALL 顯示經 coordinator proxy 操作後端的 as-built 操作頁（Diff Builder / Federation Builder）
- **AND** SHALL 誠實標示真實邊界（如 member USD immutable、3D overlay 走 client highlight）
- **AND** SHALL NOT 顯示任何捏造的版本差異或 federation 數字

### Requirement: provenance 型別 SHALL 接受後端權威值（含 artifact）

Edge Console 任何帶 provenance 的元件（含 `StubPage` 等頁面骨架）SHALL 以 `data.ts` 既有的單一真相 `Prov` 型別標註其 provenance 欄位，SHALL 接受全部權威值 `asbuilt | artifact | demo | p1 | p15`。SHALL NOT 在頁面層自行寫死缺漏值的窄化 union，以免合法的後端權威 provenance（如真實實測 `artifact`）無法標示而觸型別錯誤。

#### Scenario: 頁面骨架可標示 artifact provenance

- **WHEN** Model Intake / Semantic Viewer 等頁以 `StubPage` 標示來自 committed evidence 的真實實測項
- **THEN** 該項 SHALL 能以 `provenance="artifact"` 標示
- **AND** 型別檢查（`tsc --noEmit`）SHALL NOT 因 `'artifact'` 報 TS2322
- **AND** provenance 欄位型別 SHALL 等同 `data.ts` 的 `Prov`，不另寫死窄化 union

### Requirement: mediaPort 型別 SHALL 與串流 library 相容（number | undefined）

viewer 串流端點的 `mediaport` 流經處（`StreamEndpoint`、`AppProps`、`AppStreamProps` 及其建構與賦值點）SHALL 以 `number | undefined` 表示「未指定」，與串流 library `DirectConfig.mediaPort`（`number | undefined`）相容。SHALL NOT 讓 `null` 流入 `DirectConfig.mediaPort`；缺值時 SHALL 略過該欄，交由 library 套用預設。

#### Scenario: 缺 mediaPort 時不傳 null 給串流 library

- **WHEN** 串流端點未指定 media port（query / streamConfig / 本機 config 皆無）
- **THEN** `mediaport` SHALL 為 `undefined`（非 `null`）
- **AND** `AppStream` 建構 `DirectConfig` 時 SHALL 略過 `mediaPort` 欄，不指派 `null`
- **AND** 型別檢查（`tsc --noEmit`）SHALL NOT 因 `mediaPort` 型別不相容報 TS2322

#### Scenario: 有 mediaPort 時透傳數值

- **WHEN** 串流端點指定了有效的 media port（number）
- **THEN** 該數值 SHALL 經 `StreamEndpoint` → `AppStream` props → `DirectConfig.mediaPort` 透傳
- **AND** 端點顯示字串 SHALL 正確呈現該 port

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

Edge Console 的治理 client（A1 rule-run、A2 diff、A3 federation，以及 Issue / BCF 操作）SHALL 以與全站 viewer 及部署鏈一致的正規環境變數名 `VITE_COORDINATOR_API_BASE` 取得 coordinator base，使其 coordinator base 來源與 viewer（`config/env.ts` 的 `reviewEnv.coordinatorApiBase`、AppStream / Window）同源。SHALL NOT 僅讀任何非正規、未被部署腳本 / compose 設定的 env 名（如僅讀 `VITE_COORDINATOR_BASE`）而在部署指向非預設 coordinator 時讀不到值。MAY 保留舊名 `VITE_COORDINATOR_BASE` 為相容 fallback，但正規名 SHALL 優先；未設定任一名時的預設 base SHALL 與 viewer 一致（`http://127.0.0.1:8004`）。

#### Scenario: 部署指向非預設 coordinator 時治理 client 連對位址

- **WHEN** 部署經 `VITE_COORDINATOR_API_BASE`（compose build-arg / `deploy.ps1` 的 `WEB_VIEWER_COORDINATOR_API_BASE`）設定非預設 coordinator base
- **THEN** console 的 A1/A2/A3 + Issue + BCF client SHALL 以該值為 coordinator base
- **AND** SHALL NOT fallback 到寫死預設 `http://127.0.0.1:8004`
- **AND** 其 coordinator base SHALL 與 viewer（AppStream / Window）取得的值同源（同一 env 名）

#### Scenario: 未設定時預設與 viewer 一致

- **WHEN** 環境未設定 `VITE_COORDINATOR_API_BASE` 亦未設定舊名 `VITE_COORDINATOR_BASE`
- **THEN** console 治理 client 的 coordinator base SHALL 為 `http://127.0.0.1:8004`
- **AND** 該預設 SHALL 與 `config/env.ts` 的 viewer coordinator base 預設一致

#### Scenario: 舊名相容但正規名優先

- **WHEN** 環境同時設定 `VITE_COORDINATOR_API_BASE` 與舊名 `VITE_COORDINATOR_BASE`
- **THEN** console 治理 client SHALL 採用正規名 `VITE_COORDINATOR_API_BASE` 的值
- **AND** 僅在正規名未設定時 SHALL 採用舊名 `VITE_COORDINATOR_BASE` 作為 fallback

### Requirement: A1 Rule Center SHALL 提供真實 Excel 匯出與誠實標示的 3D 標示入口

A1 Rule Center（`IssuesRuleCenterPage`）SHALL 提供 [匯出 Excel] 入口，經 coordinator proxy `GET /api/governance/rule-runs/:id/export?fmt=excel` 觸發 governance-service 真實匯出並下載，標 `asbuilt`；成功 rule-run 前 SHALL `disabled`（無 run 不可匯出）。A1 SHALL 提供 [在 3D 中標示] 入口；因 Edge Console（`/console`）與 viewer（`<App/>`）互斥掛載、殼層無 WebRTC DataChannel，`highlightPrimsRequest` 鏈未接，該入口 SHALL 標 `p1` 並 `disabled` 且誠實說明「需 viewer DataChannel（後續整合）」，SHALL NOT 呈現為點了無回應的假按鈕；未對映 `usd_prim_path=null` SHALL 誠實顯示無法標示。

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

