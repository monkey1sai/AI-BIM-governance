# Tasks — a1-rule-engine-honesty

## 1. 計分誠實化（A1-RE-01）
- [x] 1.1 `engine.run_rules` 分母改為 `passed + failed + errored`（errored 視同未通過）
- [x] 1.2 `ids_runner.run_ids` 同步採相同分母
- [x] 1.3 測試 `test_all_error_run_scores_zero_not_full`：全 error → score 0.0、非 100

## 2. 合成 key 防禦（A1-RE-04）
- [x] 2.1 `predicates` 新增 `_SYNTHETIC_PSET_KEYS`，any-pset 與指定-pset 查找排除 `id`
- [x] 2.2 測試 `test_any_pset_does_not_match_synthetic_id_key`：property:id → 不假性通過

## 3. IDS 彙總誠實（ids-001 / ids-002 / ids-003）
- [x] 3.1 `_spec_code` 以 identifier（否則名稱+索引）產生唯一彙總 key
- [x] 3.2 `errored` 由結果推導
- [x] 3.3 prohibited specification（status False、零 requirement）補逐構件 fail
- [x] 3.4 測試 `test_ids_target_summary_unique_for_same_named_specs` / `test_ids_errored_derived_from_results` / `test_ids_prohibited_spec_emits_fail_not_silent_pass`

## 4. IFC4X3 別名迴歸（A1-RE-02）
- [x] 4.1 測試 `test_ifc4x3_type_alias_resolves_and_warns`：IfcBuildingElement→IfcBuiltElement 別名萃取 + warning

## 5. 誠實文件（A1-RE-03）
- [x] 5.1 `excel_export.py` docstring 改述 BCF 已實作
- [x] 5.2 `engine.py` docstring 改述 ifctester 已安裝 / IDS 由 ids_runner 提供
- [x] 5.3 `default-governance.yaml` description 改述 IDS 已支援

## 6. Spec + 驗證
- [x] 6.1 `specs/governance-rule-run-authority/spec.md` delta（MODIFIED 計分 + ADDED IDS 彙總誠實）
- [x] 6.2 `"/c/Program Files/Python312/python.exe" -m pytest governance-service/tests -q` 全綠（53 passed）
- [x] 6.3 `npx openspec validate a1-rule-engine-honesty --strict` 通過
- [x] 6.4 多 agent 對抗複驗（refute-by-default）7/7 真閉合、critic overall_safe、零新誠實 regression

## 7. 外部 review（Copilot / Codex）追補
- [x] 7.1 A1-RE-03 擴及 `app.py` 模組 docstring + `/health` 註解（governance-service 主入口的 ifctester/BCF/IDS 過時敘述）
- [x] 7.2 P2：`_spec_code` 一律附索引，重複 @identifier 也不覆寫
- [x] 7.3 P2：prohibited（maxOccurs==0）在 requirement 迴圈前攔截，避免含 requirements 時過度計數
- [x] 7.4 `models.py` score docstring 同步 pass/(pass+fail+errored)
