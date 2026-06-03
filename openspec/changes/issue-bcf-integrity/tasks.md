## 1. Preflight

- [x] 1.1 baseline pytest 全綠（45 passed）後再動手。
- [x] 1.2 worktree `.worktrees/issue-bcf-integrity`（branch `codex/openspec/issue-bcf-integrity`，自 main 分出），不碰 main。

## 2. Tests First

- [x] 2.1 `test_from_rule_run_idempotent`：重複 from-rule-run → created=0、skipped=3、總數仍 3（ISS-002）。
- [x] 2.2 `test_from_diff_binds_target_model_version_id`：diff issue `model_version_id=="t"`（ISS-001/BCFUSD-1）。
- [x] 2.3 `test_from_diff_idempotent`：重複 from-diff → created=0、skipped=1（ISS-002）。
- [x] 2.4 `test_concurrent_transition_single_winner`：兩執行緒並發 transition → 恰一贏家、transition event 恰 1 筆（ISS-003）。
- [x] 2.5 `test_invalid_ifc_guid_excluded`：非 22 字元 IfcGuid → count=0、無 markup（bcf-002）。
- [x] 2.6 `test_none_model_version_renders_unbound`：缺版本 → comment 含 `model_version=unbound`、無 `None`（bcf-005）。
- [x] 2.7 `test_naive_timestamp_treated_as_utc`：`_iso("2026-06-01T10:00:00")` → `2026-06-01T10:00:00Z`（bcf-003）。

## 3. Core

- [x] 3.1 `issues/store.py`：`transition` 改 `BEGIN IMMEDIATE` + 條件式 UPDATE（ISS-003）。
- [x] 3.2 `issues/store.py`：新增 `create_issues_batch`（單一交易 + 來源冪等，ISS-002/004）。
- [x] 3.3 `issues/api.py`：`from-diff` 綁 `target_model_version_id`（ISS-001/BCFUSD-1）；兩端點改用 batch。
- [x] 3.4 `bcf/bcf_writer.py`：`_iso` naive→UTC（bcf-003）、`_disp` 缺值→unbound（bcf-005）、`_IFC_GUID_RE` 22 字元過濾（bcf-002）。

## 4. Verify

- [x] 4.1 `pytest tests -q -p no:cacheprovider` 全綠（52 passed）。
- [x] 4.2 `npx openspec validate issue-bcf-integrity --strict` 通過。
- [x] 4.3 `git diff --cached --check`（無 trailing whitespace）。
