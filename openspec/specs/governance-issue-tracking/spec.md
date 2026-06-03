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

issue SHALL 以 `ifc_guid` 為跨工具主鍵。版本溯源（`model_version_id`）綁定要求依來源而定，不是無條件：**diff-sourced issue SHALL 綁該 diff 的 target 模型版本（`target_model_version_id`）**，因 diff item 代表 target 模型相對 base 的變更；當該 diff 未帶 `target_model_version_id`（diff API 宣告該欄為 optional）時，from-diff SHALL 拒絕（不得建立無版本綁定 issue）。**rule-run-sourced issue 的版本綁定為 best-effort（`model_version_id` MAY 為空）**：rule-run 可能是對尚未指派版本的臨時 IFC 檢核，此類 issue 仍以 `source_type` / `source_ref` 與 run 提供溯源（詳見下方批次來源 Requirement，與 from-diff 刻意不對稱）。**無 `ifc_guid` 的條目 SHALL 標為 `kind=annotation`（視覺標註），SHALL NOT 視為正式可交換 issue**（BCF 原則 rule 10）。

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

由來源批次產生的 issue 對 `model_version_id` 的綁定要求刻意不對稱，反映兩種來源的本質差異：

- 從 rule-run 建 issue 時，版本綁定為 best-effort：rule-run 可能是對「尚未指派 model version」的臨時 IFC 檢核（console doRun 只傳 `ifc_source_path` / `ids_path`）。端點 SHALL 仍建出 issue 並以 `source_type=rule_result` + `source_ref` + run 提供溯源，`model_version_id` MAY 為空。
- 從 diff 建 issue 時，diff 天生是兩個 model_version 的比對；若該 diff 缺 `target_model_version_id`，端點 SHALL 回 422 並誠實說明，SHALL NOT 建出無版本綁定的 issue。

#### Scenario: 從 rule-run 失敗構件建 issue

- **WHEN** 對一個有失敗構件的 rule-run 呼叫 from-rule-run
- **THEN** SHALL 為每個失敗結果建立一個 issue
- **AND** 帶真實 `ifc_guid` 的失敗結果 SHALL `kind=issue`（正式、可交換）並帶 `source_type=rule_result`
- **AND** 無 `ifc_guid` 的 spec 級失敗（如 required IDS specification 零適用構件）SHALL `kind=annotation`，SHALL NOT 捏造 `ifc_guid`（誠實；仍以 `source_type` / `source_ref` 溯源）
- **AND** 若該 rule run 有 `model_version_id` 則綁定之；缺時 `model_version_id` MAY 為空（best-effort）

#### Scenario: rule-run 缺 model_version_id 時仍以 best-effort 建 issue

- **WHEN** 對一個缺 `model_version_id` 的 rule-run 呼叫 from-rule-run
- **THEN** 端點 SHALL 仍回 201 並為每個失敗構件建出 issue
- **AND** 該 issue 的 `model_version_id` MAY 為空（rule_result 來源可接受，仍以 source_ref + run 溯源）
- **AND** 此行為 SHALL 與 from-diff 缺 `target_model_version_id` 回 422 刻意不對稱（diff 天生需 target 版本）

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
