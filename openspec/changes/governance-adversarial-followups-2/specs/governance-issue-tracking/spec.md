# governance-issue-tracking — Spec Delta (governance-adversarial-followups-2)

> from-rule-run 對稱守 model_version_id：rule run 缺版本綁定時拒絕（422），與 from-diff 一致，不建出無版本溯源 issue（F4 誠實鐵律）。

## MODIFIED Requirements

### Requirement: issue SHALL 可由 rule-run / diff 來源批次產生並保留來源綁定

`governance-service` SHALL 能從 A1 rule-run 的失敗構件與 A2 diff 的變更構件批次建立 issue，並保留來源綁定（`source_type` / `source_ref` 與真實 `ifc_guid`）。

由來源批次產生的 issue SHALL 綁定 `model_version_id`（誠實鐵律：所有正式 issue 綁版本，缺版本綁定會讓 BCF 匯出與跨工具溯源斷裂）。當來源缺少版本時，端點 SHALL 對稱拒絕而非建出無版本溯源 issue：

- 從 rule-run 建 issue 時，若該 rule run 缺 `model_version_id`，端點 SHALL 回 422 並誠實說明，SHALL NOT 建出 `model_version_id` 為空的 issue。
- 從 diff 建 issue 時，若該 diff 缺 `target_model_version_id`，端點 SHALL 回 422 並誠實說明，SHALL NOT 建出無版本綁定的 issue。

#### Scenario: 從 rule-run 失敗構件建 issue

- **WHEN** 對一個有失敗構件的 rule-run 呼叫 from-rule-run
- **THEN** SHALL 為每個失敗構件建立一個 issue
- **AND** 每個 issue SHALL 帶該構件真實的 `ifc_guid` 與 `source_type=rule_result`
- **AND** 因有 `ifc_guid`，`kind` SHALL 為 `issue`
- **AND** 每個 issue SHALL 綁定該 rule run 的 `model_version_id`

#### Scenario: rule-run 缺 model_version_id 時拒絕建 issue

- **WHEN** 對一個缺 `model_version_id` 的 rule-run 呼叫 from-rule-run
- **THEN** 端點 SHALL 回 422 並誠實說明缺版本綁定
- **AND** SHALL NOT 建出任何 `model_version_id` 為空的 issue（無 NULL-mv 洩漏）
- **AND** 此拒絕行為 SHALL 與 from-diff 缺 `target_model_version_id` 的拒絕對稱
