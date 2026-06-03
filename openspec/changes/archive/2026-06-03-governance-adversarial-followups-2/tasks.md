# Tasks — governance-adversarial-followups-2

## 1. F1 — A1-IDS-REUSE-FALSEPASS（跨 model 殘留假通過）

- [x] 1.1 真實 ifctester probe 證實：同一 specs 物件先對「有 FireRating 門」再對「缺 FireRating 門」，第二次 `facet.passed_entities` 殘留前一 model id，導致不合規門被誤判 pass、score=100。
- [x] 1.2 `rule_engine/ids_runner.py` 新增 `_reset_ids_residual_state`，於 `run_ids` 進入點、`validate` 前清 requirement facet 的 `passed_entities` 與 `failures`（只清 ifctester 不自行清理者，不覆寫 spec 級狀態以免破壞 fake-spec 測試）。
- [x] 1.3 `tests/test_ids.py` 新增 `test_ids_reused_specs_across_models_no_false_pass`（真實 ifctester，斷言第二次 failed>=1 且 score<100）。

## 2. F2 — Required IDS spec 零適用構件誤報 100% pass

- [x] 2.1 真實 ifctester probe 證實：`minOccurs=1` 的 required spec 在無門模型下回 `spec.status=False`、applicable 為空，`run_ids` 先前回 total=0/score=100。
- [x] 2.2 `rule_engine/ids_runner.py` 零-result fallback 擴充：applicable 為空且 `spec.status is False` 時補一筆 spec 級 `required_absent` fail（不捏造 guid），與 prohibited(maxOccurs==0) 分支互斥。
- [x] 2.3 `tests/test_ids.py` 新增 `test_ids_required_spec_zero_applicable_not_false_pass`（真實 ifctester，斷言 score<100 + required_absent fail）。

## 3. F3 — 同型別重複 Tag 幻影配對

- [x] 3.1 合成 IFC probe 證實：同型別 2 個相同 Tag、反向插入序 → `setdefault` 壓平 → 幻影 moved + 假 removed/added。
- [x] 3.2 `diff_engine/engine.py` 第二級以 `_tag_buckets` 取代 `setdefault`，只在兩側 `(is_a, tag)` 各恰 1 個時以 Tag 配對；歧義落第三級或 removed/added。
- [x] 3.3 `tests/test_diff_engine.py` 新增 `test_same_type_duplicate_tag_no_phantom_pairing`（斷言 matched=2、0 幻影、無 match==tag）。
- [x] 3.4 既有 `test_tag_alignment_same_type_different_guid`（唯一 Tag）仍綠，未退化。

## 4. F4 — from-rule-run 未守 model_version_id

- [x] 4.1 確認 `db.py` `rule_runs.model_version_id` 為 nullable、`create_run` 可傳 None。
- [x] 4.2 `issues/api.py` `issues_from_rule_run` 缺 `model_version_id` 時 raise 422（與 from-diff 對稱訊息），items 改用驗證後的 `mv`。
- [x] 4.3 `tests/test_issues.py` 新增 `test_from_rule_run_rejects_none_model_version_id`（None mv run → 422、不留 issue）。

## 5. F5 — BCF GPLv3 依賴敘述誠實校正

- [x] 5.1 查證：`pip show ifctester` → `Requires: bcf-client`；`pip show bcf-client` → license GPLv3、`Required-by: ifctester`；`grep import bcf governance-service/bcf/` → 0（本地模組只用 stdlib）。
- [x] 5.2 校正 `bcf/bcf_writer.py`、`bcf/__init__.py`、`app.py`、`rule_engine/excel_export.py`、`governance-service/CLAUDE.md` 敘述為「匯出模組執行期不 import bcf-client、產物不含其程式碼；惟 ifctester transitive 安裝 bcf-client(GPLv3)」。
- [x] 5.3 確認 `requirements.txt` 既有註解已誠實標示 ifctester 附帶 bcf-client（保留）。

## 6. F6 — test_api.py 過時 docstring

- [x] 6.1 `tests/test_api.py` 模組 docstring 改為 ifctester 已安裝（host 0.8.5）、/health 如實回報 true。

## 7. F7 — 死碼 + docstring 失準

- [x] 7.1 `rule_engine/engine.py` `load_rule_set` 死碼分支 `yaml.safe_load(fh) if False else json.load(fh)` 化簡為 `json.load(fh)`。
- [x] 7.2 `federation/coords.py` docstring 校正：只比 upAxis + metersPerUnit、defaultPrim 僅回報不參與判定、不驗 origin。

## 8. 自驗

- [x] 8.1 `"/c/Program Files/Python312/python.exe" -m pytest governance-service/tests -q -p no:cacheprovider` 全綠（78 passed，baseline 74 + 4 新測試）。
- [x] 8.2 F1/F2/F5 真實 ifctester/pip probe 結果逐項貼出。
- [x] 8.3 `npx openspec validate governance-adversarial-followups-2 --strict` 通過。
- [x] 8.4 `git add -A && git diff --cached --check` 無 whitespace 問題。
