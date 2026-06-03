## Why

A2 model-version-diff 的對抗驗證找出三個會讓 diff 結果「靜默錯誤」的 finding，最危險的是治理場景無法接受的「漏報變更」：

- **A2-001（high/bug）**：第二級 Tag 對齊只用單純 Tag 當鍵，未檢查 `ifc_type`。當不同型別的構件共用同一 Tag（Revit re-export、family 改型別等情境並不罕見），一面被刪的牆與一扇新增的門會被誤配成「同一構件、0 變更」，把真實的 removed + added 靜默吞掉——這對「這版改了什麼」的治理問題是直接的可信度傷害。
- **A2-003（low/bug）**：第三級 type+name+loc 對齊在同鍵多構件時用 `zip` 直接配對，順序依 `by_type` 迭代序、非穩定，導致 property_changed 證據歸屬可能在重跑時漂移、不可重現。
- **A2-002（medium/test-gap）**：Tag 與 type+name+loc 兩條退階對齊路徑完全沒有測試，A2-001 的型別誤配在無測試下無法被回歸守住。

另有一項誠實文件清理：`diff_engine/` 內多處註解/docstring 仍宣稱「geometry_changed 為 p1 / MVP 不計算 / 未實作」，與已落地的 opt-in geometry_changed（PR #162）矛盾，需據實改述以維持誠實鐵律。

## What Changes

- **A2-001 型別護欄**：第二級 Tag 對齊的鍵從單純 `tag` 改為複合鍵 `(entity.is_a(), tag)`，與第一級 GlobalId（全域唯一）、第三級 type+name+loc 的型別一致性對齊。跨型別共用 Tag 不再成對，正確分類為 removed + added。
- **A2-003 穩定配對**：第三級同鍵簇內配對前，以穩定次鍵（GlobalId，缺則 entity id）排序 base / target 兩側再 `zip`，讓 property_changed 等證據歸屬穩定可重現。
- **A2-002 測試補洞**：在 `tests/test_diff_engine.py` 新增退階對齊測試——(a) 同型別同 Tag 以 tag 對齊、(b) GUID+Tag 皆異但 type+name+loc 同以 type_name_loc 對齊、(c) 跨型別同 Tag → removed+added 不誤配；另加一個同鍵多構件穩定配對測試固定 A2-003 行為。
- **誠實文件清理**：把 `engine.py`、`models.py`、`keys.py` 中與已落地 opt-in geometry_changed 矛盾的「p1 / 不計算」過時註解改述為「opt-in（預設關閉，需顯式啟用）已實作」；不動仍正確的誠實標示（如 issue-impact 啟發式、3D overlay p15）。

純內部對齊邏輯修正，不改 `run_diff` 簽章、`DiffResult` 結構、REST API 與計數一致性語意。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `model-version-diff-authority`：強化多級退階對齊的型別一致性（同 Tag 跨型別不得誤配），並要求同鍵簇配對穩定可重現。

## Impact

- Owner repo / folder：
  - `governance-service/diff_engine/engine.py`（第二級 Tag 複合鍵型別護欄、第三級同鍵簇穩定排序、docstring 誠實化）。
  - `governance-service/diff_engine/keys.py`、`diff_engine/models.py`（誠實文件清理）。
  - `governance-service/tests/test_diff_engine.py`（A2-002 新增退階對齊 + A2-003 穩定配對測試）。
- 不影響 coordinator proxy、前端 console、`run_diff` 簽章與 `DiffResult` schema。
- Risk：LOW（`gitnexus_impact run_diff upstream` = LOW；直接 caller 僅 `run_diff_on_paths`、`api._execute`，簽章與回傳契約不變）。
