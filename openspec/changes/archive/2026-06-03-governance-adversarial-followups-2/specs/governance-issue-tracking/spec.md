# governance-issue-tracking — Spec Delta (governance-adversarial-followups-2)

> 版本綁定刻意不對稱：rule-run issue 的版本綁定為 best-effort（rule-run 可對未指派版本的臨時 IFC 檢核）；diff issue（from-diff）天生是兩個 model_version 的比對，SHALL 要求 target model version（缺則 422）（F4 誠實鐵律）。

## MODIFIED Requirements

### Requirement: issue SHALL 可由 rule-run / diff 來源批次產生並保留來源綁定

`governance-service` SHALL 能從 A1 rule-run 的失敗構件與 A2 diff 的變更構件批次建立 issue，並保留來源綁定（`source_type` / `source_ref` 與真實 `ifc_guid`）。批次建立 SHALL 在單一交易內完成（全有或全無）。對同一來源（相同 `source_type` 與 `source_ref`）重複呼叫 SHALL 為冪等：已存在者 SHALL NOT 重複建立，並 SHALL 在回應中以 `skipped` 計數揭露。

由來源批次產生的 issue 對 `model_version_id` 的綁定要求刻意不對稱，反映兩種來源的本質差異：

- 從 rule-run 建 issue 時，版本綁定為 best-effort：rule-run 可能是對「尚未指派 model version」的臨時 IFC 檢核（console doRun 只傳 `ifc_source_path` / `ids_path`）。端點 SHALL 仍建出 issue 並以 `source_type=rule_result` + `source_ref` + run 提供溯源，`model_version_id` MAY 為空。
- 從 diff 建 issue 時，diff 天生是兩個 model_version 的比對；若該 diff 缺 `target_model_version_id`，端點 SHALL 回 422 並誠實說明，SHALL NOT 建出無版本綁定的 issue。

#### Scenario: 從 rule-run 失敗構件建 issue

- **WHEN** 對一個有失敗構件的 rule-run 呼叫 from-rule-run
- **THEN** SHALL 為每個失敗構件建立一個 issue
- **AND** 每個 issue SHALL 帶該構件真實的 `ifc_guid` 與 `source_type=rule_result`
- **AND** 因有 `ifc_guid`，`kind` SHALL 為 `issue`
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
