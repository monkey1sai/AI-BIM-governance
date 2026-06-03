# a1-rule-engine-honesty

## Why

2026-06-03 全系統多 agent 交叉對抗驗證對 `governance-rule-run-authority`（A1）找到 7 個雙懷疑者強確認的 finding，集中在「假數字 / 假 pass」與彙總誠實，直接違反專案誠實鐵律：

- **A1-RE-01（high / honesty）**：`run_rules` 計分分母為 `passed + failed`，排除 `errored`。當規則對每個構件都 raise（壞模型 / 壞 predicate）時 `passed == failed == 0`，分母為 0 → score 回報 **100.0 假性滿分**，把「全部評估失敗」偽裝成「完全合規」。
- **A1-RE-04（low / bug）**：`eval_property_required` 的 any-pset 與指定-pset 分支查找屬性時，未排除 `ifcopenshell.util.element.get_psets()` 注入的合成 `id` key，`property: id` 規則會無條件假性通過。
- **ids-001（medium / bug）**：`run_ids` 以 `spec.name` 為 `target_summary` key，同名 / 未命名 specification 互相覆寫，對外彙總低報。
- **ids-002（low / honesty）**：prohibited applicability（零 requirement）的 specification 級違規不產生逐構件 result，違規模型被當乾淨 pass。
- **ids-003（low / honesty）**：IDS 路徑 `errored` 結構性硬寫 0，與 YAML 引擎語意不一致。
- **A1-RE-03（low / honesty）**：`excel_export.py`、`engine.py`、`default-governance.yaml` docstring / 註解仍宣稱「BCF 未實作 / ifctester 未安裝 / IDS 為後續 p1」，與已落地的 `bcf/`、`ids_runner` 及 `governance-service/CLAUDE.md` 矛盾。
- **A1-RE-02（medium / test-gap）**：IFC4X3 跨 schema 型別別名（`IfcBuildingElement → IfcBuiltElement`）零測試覆蓋，regression 無防護。

## What Changes

- **計分誠實化**：`run_rules` 與 `run_ids` 的 governance score 分母改為 `passed + failed + errored`，`errored` 視同未通過；`errored == 0` 時與舊式等價（真實模型 99.0 不受影響）。
- **合成 key 防禦**：`eval_property_required` 查找屬性時排除 `get_psets()` 合成 key（`id`）。
- **IDS 彙總唯一化**：`run_ids` 以 IDS identifier（否則名稱 + 索引）為彙總 key；`errored` 改為由結果推導；prohibited specification 級違規補逐構件 fail。
- **誠實文件**：修正 `excel_export.py` / `engine.py` / `default-governance.yaml` 過時敘述。
- **迴歸測試**：新增 all-error 計分、IFC4X3 別名、any-pset 合成 id、IDS 彙總唯一性 / errored 推導 / prohibited 共 6 條測試。
- **Spec**：`governance-rule-run-authority` 計分 requirement MODIFIED（分母含 errored + 全 error 不得滿分 + 排除合成 key），新增「IDS 彙總唯一可辨識且 error 計數誠實」requirement。

## Impact

- Affected specs: `governance-rule-run-authority`
- Affected code: `governance-service/rule_engine/{engine,predicates,ids_runner,excel_export}.py`、`governance-service/rules/default-governance.yaml`、`governance-service/tests/{test_rule_engine,test_ids}.py`
- 行為相容性：真實模型 99.0 / 既有 45 測試不受影響（errored 在現行規則集恆為 0）；僅修正錯誤路徑與彙總誠實。
- 邊界：純 `governance-service`（host py312 CPU），不動 coordinator / streaming / 前端。
