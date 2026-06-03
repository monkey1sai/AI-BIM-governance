# governance-issue-tracking — Spec Delta (issue-bcf-integrity)

> 強化 issue 完整性：必綁 model_version（diff issue 綁 target 版本）、來源冪等、批次 atomic、transition 並發安全。

## MODIFIED Requirements

### Requirement: issue SHALL 以 ifc_guid 綁定；無 guid 僅為標註（BCF 對齊）

issue SHALL 以 `ifc_guid` 為跨工具主鍵並 SHALL 綁 `model_version_id` 以保留版本溯源。由 A2 diff 來源建立的 issue SHALL 綁該 diff 的 **target** 模型版本（`target_model_version_id`），因 diff item 代表 target 模型相對 base 的變更。**無 `ifc_guid` 的條目 SHALL 標為 `kind=annotation`（視覺標註），SHALL NOT 視為正式可交換 issue**（BCF 原則 rule 10）。

#### Scenario: 有/無 guid 的 kind 區分

- **WHEN** 建立 issue 時提供 `ifc_guid`
- **THEN** 其 `kind` SHALL 為 `issue`（正式、可交換）
- **WHEN** 建立時未提供 `ifc_guid`
- **THEN** 其 `kind` SHALL 為 `annotation`，SHALL NOT 當作正式 BCF issue

#### Scenario: diff issue 綁 target model version

- **WHEN** 從一個 base→target 的 diff 呼叫 from-diff 建立 issue
- **THEN** 每個 diff issue 的 `model_version_id` SHALL 等於該 diff 的 `target_model_version_id`
- **AND** SHALL NOT 留下 `model_version_id` 為空（缺版本綁定會讓 BCF 匯出與 diff-impact 統計斷裂）

### Requirement: issue SHALL 可由 rule-run / diff 來源批次產生並保留來源綁定

`governance-service` SHALL 能從 A1 rule-run 的失敗構件與 A2 diff 的變更構件批次建立 issue，並保留來源綁定（`source_type` / `source_ref` 與真實 `ifc_guid`）。批次建立 SHALL 在單一交易內完成（全有或全無）。對同一來源（相同 `source_type` 與 `source_ref`）重複呼叫 SHALL 為冪等：已存在者 SHALL NOT 重複建立，並 SHALL 在回應中以 `skipped` 計數揭露。

#### Scenario: 從 rule-run 失敗構件建 issue

- **WHEN** 對一個有失敗構件的 rule-run 呼叫 from-rule-run
- **THEN** SHALL 為每個失敗構件建立一個 issue
- **AND** 每個 issue SHALL 帶該構件真實的 `ifc_guid` 與 `source_type=rule_result`
- **AND** 因有 `ifc_guid`，`kind` SHALL 為 `issue`

#### Scenario: 重複來源呼叫為冪等

- **WHEN** 對同一 rule-run 或同一 diff 連續呼叫兩次批次建立
- **THEN** 第二次 SHALL NOT 重複建立任何 issue（`created` 為 0）
- **AND** 回應 SHALL 以 `skipped` 揭露被跳過的數量
- **AND** 該來源的 issue 總數 SHALL 維持與第一次相同

#### Scenario: 批次建立為單一交易

- **WHEN** 批次建立過程中任一筆寫入失敗
- **THEN** 整批 SHALL 回滾（SHALL NOT 留下半套已建 issue）

## ADDED Requirements

### Requirement: issue 狀態轉換 SHALL 並發安全（無 TOCTOU）

issue 的狀態轉換 SHALL 對並發呼叫安全：同一 issue 被兩個並發請求轉換時，SHALL 只有一個成功，另一個 SHALL 被拒（而非寫出兩筆互相矛盾的轉換）。實作 SHALL 以資料庫層交易序列化（非「先讀後寫」兩段式）保證此性質。

#### Scenario: 並發轉換只有單一贏家

- **WHEN** 兩個請求同時把同一個 `open` issue 分別轉為 `resolved` 與 `rejected`
- **THEN** SHALL 恰有一個轉換成功，另一個 SHALL 被拒
- **AND** 該 issue 最終狀態 SHALL 為兩者其一（`resolved` 或 `rejected`）
- **AND** audit 中 `event_type=transition` 的事件 SHALL 恰為一筆（無自相矛盾的雙轉換）
