# governance-issue-tracking Specification

## Purpose
TBD - created by archiving change governance-issue-db. Update Purpose after archive.
## Requirements
### Requirement: 落地端 SHALL 提供 issue 生命週期與 audit

`governance-service` SHALL 提供 issue，其狀態 SHALL 在 open / assigned / in_progress / resolved / rejected / reopened 間依受控狀態機轉換。每次建立與狀態轉換 SHALL 寫入 audit event（可重播、可驗證）。

#### Scenario: issue 狀態機與 audit

- **WHEN** 建立一個 issue 並做狀態轉換
- **THEN** 新 issue SHALL 起始於 open
- **AND** 合法轉換（如 open → assigned → resolved）SHALL 成功
- **AND** 非法轉換（如 resolved → open）SHALL 被拒（4xx）
- **AND** 每次建立與轉換 SHALL 各留一筆 audit event（含 from/to status 與時間）

### Requirement: issue SHALL 以 ifc_guid 綁定；無 guid 僅為標註（BCF 對齊）

issue SHALL 以 `ifc_guid`（IFC GlobalId）為跨工具主鍵。每個 `kind=issue` 的正式 issue SHALL 同時具有非空 `ifc_guid` 與 `model_version_id`，不因來源為 rule-run 或 diff 而例外。diff-sourced issue SHALL 綁該 diff 的 `target_model_version_id`；rule-run-sourced issue SHALL 綁該 run 的 `model_version_id`。來源缺少所需版本時，建立端點 SHALL 以 `422` 拒絕，SHALL NOT 建立無版本綁定的正式 issue。無 `ifc_guid` 的條目 SHALL 標為 `kind=annotation`（視覺標註），SHALL NOT 視為正式可交換 issue（BCF 原則 rule 10）。

#### Scenario: 有/無 guid 的 kind 區分

- **WHEN** 建立 issue 時提供 `ifc_guid`
- **THEN** 其 `kind` SHALL 為 `issue`（正式、可交換）
- **WHEN** 建立時未提供 `ifc_guid`
- **THEN** 其 `kind` SHALL 為 `annotation`，SHALL NOT 當作正式 BCF issue

#### Scenario: diff issue 綁 target model version

- **WHEN** 從一個 base→target 的 diff 呼叫 from-diff 建立 issue
- **THEN** 每個 diff issue 的 `model_version_id` SHALL 等於該 diff 的 `target_model_version_id`
- **AND** SHALL NOT 留下 `model_version_id` 為空（缺版本綁定會讓 BCF 匯出與 diff-impact 統計斷裂）

#### Scenario: from-diff 在 diff 缺 target model version 時拒絕

- **WHEN** 對一個 `target_model_version_id` 為空（diff API 宣告 optional）的 diff 呼叫 from-diff
- **THEN** SHALL 以 `422` 拒絕，並 SHALL NOT 建立任何 issue
- **AND** SHALL NOT 留下 `model_version_id` 為空的無版本綁定 issue（避免 NULL 版本洩漏破壞溯源）

### Requirement: issue SHALL 可由 rule-run / diff 來源批次產生並保留來源綁定

`governance-service` SHALL 能從 A1 rule-run 的失敗構件與 A2 diff 的變更構件批次建立 issue，並保留來源綁定（`source_type` / `source_ref` 與真實 `ifc_guid`）。批次建立 SHALL 在單一交易內完成（全有或全無）。對同一來源（相同 `source_type` 與 `source_ref`）重複呼叫 SHALL 為冪等：已存在者 SHALL NOT 重複建立，並 SHALL 在回應中以 `skipped` 計數揭露。

由來源批次產生的正式 issue 對 `model_version_id` 採相同 fail-closed 原則：

- 從 rule-run 建 issue 時，每筆正式 issue SHALL 綁該 run 的 `model_version_id`；缺少時端點 SHALL 回 422，且整批不得建立。
- 從 diff 建 issue 時，diff 天生是兩個 model_version 的比對；若該 diff 缺 `target_model_version_id`，端點 SHALL 回 422 並誠實說明，SHALL NOT 建出無版本綁定的 issue。

#### Scenario: 從 rule-run 失敗構件建 issue

- **WHEN** 對一個有失敗構件的 rule-run 呼叫 from-rule-run
- **THEN** SHALL 為每個失敗結果建立一個 issue
- **AND** 帶真實 `ifc_guid` 的失敗結果 SHALL `kind=issue`（正式、可交換）並帶 `source_type=rule_result`
- **AND** 無 `ifc_guid` 的 spec 級失敗（如 required IDS specification 零適用構件）SHALL `kind=annotation`，SHALL NOT 捏造 `ifc_guid`（誠實；仍以 `source_type` / `source_ref` 溯源）
- **AND** 每個正式 issue 的 `model_version_id` SHALL 等於該 rule run 的 `model_version_id`

#### Scenario: rule-run 缺 model_version_id 時拒絕建立

- **WHEN** 對一個缺 `model_version_id` 的 rule-run 呼叫 from-rule-run
- **THEN** 端點 SHALL 回 422，並 SHALL NOT 建立任何 issue 或 annotation
- **AND** SHALL NOT 以 `source_ref` 取代正式的 model-version 綁定

#### Scenario: 啟動時處理歷史缺綁定正式 issue

- **GIVEN** 舊版資料庫含 `kind=issue` 且 `ifc_guid` 或 `model_version_id` 為空的歷史列
- **WHEN** IssueStore 初始化 schema
- **THEN** 該列 SHALL 原地降級為 `kind=annotation`，保留 ID、`ifc_guid`、來源、狀態與既有 evidence
- **AND** SHALL 新增一筆 `binding_migration` audit event，不得捏造 `ifc_guid`／`model_version_id` 或刪除資料
- **AND** 重複初始化 SHALL 為冪等，不得重複新增 migration event

#### Scenario: 重複來源呼叫為冪等

- **WHEN** 對同一 rule-run 或同一 diff 連續呼叫兩次批次建立
- **THEN** 第二次 SHALL NOT 重複建立任何 issue（`created` 為 0）
- **AND** 回應 SHALL 以 `skipped` 揭露被跳過的數量
- **AND** 該來源的 issue 總數 SHALL 維持與第一次相同

#### Scenario: 批次建立為單一交易

- **WHEN** 批次建立過程中任一筆寫入失敗
- **THEN** 整批 SHALL 回滾（SHALL NOT 留下半套已建 issue）

### Requirement: issue 操作 SHALL 經 coordinator proxy，且不復活退役的 socket push

瀏覽器 SHALL 只經 `bim-review-coordinator`（:8004）的 `/api/governance/issues*` 操作 issue（HTTP 請求/回應），SHALL NOT 直連 `governance-service`（:49102），SHALL NOT 復活 2026-05-21 退役的 socket collaboration server-push（`getReviewIssues` / `createAnnotation` / 即時廣播）。

#### Scenario: 經 proxy 操作 issue

- **WHEN** 瀏覽器建立或轉換 issue
- **THEN** 它 SHALL 呼叫 coordinator `/api/governance/issues*`
- **AND** issue 權威 SHALL 在 `governance-service`，coordinator 僅 HTTP 透傳
- **AND** SHALL NOT 透過已退役的 socket server-push 機制推送 issue

### Requirement: issue 狀態轉換 SHALL 並發安全（無 TOCTOU）

issue 的狀態轉換 SHALL 對並發呼叫安全：同一 issue 被兩個並發請求轉換時，SHALL 只有一個成功，另一個 SHALL 被拒（而非寫出兩筆互相矛盾的轉換）。實作 SHALL 以資料庫層交易序列化（非「先讀後寫」兩段式）保證此性質。

#### Scenario: 並發轉換只有單一贏家

- **WHEN** 兩個請求同時把同一個 `open` issue 分別轉為 `resolved` 與 `rejected`
- **THEN** SHALL 恰有一個轉換成功，另一個 SHALL 被拒
- **AND** 該 issue 最終狀態 SHALL 為兩者其一（`resolved` 或 `rejected`）
- **AND** audit 中 `event_type=transition` 的事件 SHALL 恰為一筆（無自相矛盾的雙轉換）
