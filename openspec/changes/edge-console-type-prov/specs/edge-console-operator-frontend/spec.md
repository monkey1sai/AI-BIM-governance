# edge-console-operator-frontend — Spec Delta (edge-console-type-prov)

> 對抗驗證後的型別 / 誠實標示修復：provenance 型別接受後端權威值（含 artifact）、
> mediaPort 型別與串流 library 相容、UI 標示與實際落地一致（BCF 為 asbuilt），
> 並修正既有「A2/A3 為待建骨架」要求使其與後端已落地的事實一致。

## ADDED Requirements

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

Edge Console 的 provenance 標示 SHALL 與後端實際落地狀態一致。BCF 2.1 匯出後端已落地（`governance-service/bcf/`，純 stdlib，不依賴 GPLv3）且前端按鈕可用，故相關標示 SHALL 標為 `asbuilt`（已實作），SHALL NOT 標為 `p1` / `p15`（待建）。資料體與其說明註解 SHALL NOT 自相矛盾。

#### Scenario: BCF 匯出標已實作

- **WHEN** 操作員開啟 Overview 或 A1 Rule Center 規則集
- **THEN** BCF 匯出（issue→.bcfzip）項 SHALL 標 `asbuilt`（已實作）
- **AND** 說明 SHALL 保留「純 stdlib，不依賴 GPLv3」
- **AND** SHALL NOT 標為待建（p1 / p15）

#### Scenario: 資料註解與資料體一致

- **WHEN** 讀 `data.ts` 的 A1–A10 清單與其註解
- **THEN** 註解描述的落地狀態 SHALL 與資料體的 `prov` 值一致
- **AND** A2 / A3 SHALL NOT 在註解被描述為「前端骨架 + spec（p1）」而資料體已是 `asbuilt`

## MODIFIED Requirements

### Requirement: A1/A2/A3 SHALL 在介面可驗證並誠實標示落地狀態

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
