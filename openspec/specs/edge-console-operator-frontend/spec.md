# edge-console-operator-frontend Specification

## Purpose
TBD - created by archiving change edge-console-shell. Update Purpose after archive.
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

Edge Console SHALL 讓 A1 在介面可驗證：顯示真實 IFC 實測 artifact 與規則集，並能觸發實時 rule-run。A2 / A3 SHALL 以骨架呈現（schema / API / 風險），並標記後端待建（p1），SHALL NOT 顯示捏造的 diff / federation 結果。

#### Scenario: A1 顯示真實實測 artifact

- **WHEN** 操作員開啟 A1 Rule Center
- **THEN** 前端 SHALL 顯示來自 committed evidence 的真實實測值（標 artifact，非 demo、非捏造）
- **AND** SHALL 顯示規則集，其中未實作項（IDS 匯入 / BCF 匯出 / Issue DB）SHALL 標 p1 / p15

#### Scenario: A2/A3 為誠實骨架

- **WHEN** 操作員開啟 A2 或 A3 頁
- **THEN** 前端 SHALL 顯示 schema / API / 風險骨架並標後端待建（p1）
- **AND** SHALL NOT 顯示任何捏造的版本差異或 federation 數字
