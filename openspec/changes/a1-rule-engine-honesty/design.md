# Design — a1-rule-engine-honesty

## 計分語意（A1-RE-01）

選 **errored 計入分母** 而非「score=None / 標記未完整」：

- 相容性最高：`score` 維持 `float`，不破壞 API / 前端 / Excel 消費端型別。
- 語意正確：`error`（評估失敗 / 未取得）即「未通過」，計入分母讓 score 真實下修。
- 不動 headline：現行規則集對真實模型 `errored == 0`，分母 `passed+failed+errored == passed+failed`，score 99.0 完全不變；only 錯誤路徑（全 / 部分 error）被修正。
- `denom == 0`（無任何適用構件）維持 `100.0`：此為 vacuous truth（沒有可違反的構件），與「全 error」是不同情境——後者 `denom == errored > 0` → 0.0。

YAML 與 IDS 兩路徑採同一公式，維持對外契約一致。

## 合成 key 防禦（A1-RE-04）

`ifcopenshell.util.element.get_psets()` 在每個 Pset bucket 注入 `id`（該 Pset 的 STEP id）。以模組常數 `_SYNTHETIC_PSET_KEYS = {"id"}` 在兩個查找分支前判斷 `synthetic`：

- 指定-pset：`pset_found` 仍依 bucket 是否存在設定（誠實反映「Pset 存在但該屬性不可信」），但 `value` 不取合成 key → `ok=False`。
- any-pset：合成 key 直接跳過所有 bucket。

代價：使用者無法以 `property: id` 檢核真實名為 `id` 的屬性——IFC 屬性實務上不會命名為 `id`，此風險可忽略，換得不假性通過。

## IDS 彙總（ids-001/002/003）

- **唯一 key**：`_spec_code(spec, index)` 優先 IDS `@identifier`，否則 `f"{name or 'IDS-SPEC'}#{index}"`。索引後綴保證確定性唯一，且不影響既有逐構件分類（測試僅斷言 guid/status，不依賴 rule_code 字面）。
- **errored 推導**：`sum(status=="error")`；IDS 路徑目前不產生 error，故恆 0，但語意正確、與 YAML 一致。
- **prohibited 防禦**：guard 僅當 `spec.status is False`、該 spec 未產生任何逐構件 result、applicable 非空 三條同時成立時，補逐構件 fail。已用**真實 ifctester 0.8.5 端對端驗證**：schema-valid 的 `maxOccurs=0` prohibited spec 經 `ids.open` 載入 → `specs.validate` 後 `spec.status=False`、零 requirement（ifctester ids.py:304 prohibited 跳過 requirement、ids.py:325-327 有 applicable 才設 status False）→ guard 觸發、`run_ids_file` 回 `failed=N / score=0.0`（修復前為 0 result → score 100 假乾淨 pass）。三組反例皆不誤觸發：正常全 pass（status True）、prohibited 乾淨模型（applicable 空）、正常部分 fail（已產生 result，`len(results)==produced_before` 為 False）。測試含 fake spec 單測與真實 ifctester 端對端。

## 驗證

- `"/c/Program Files/Python312/python.exe" -m pytest governance-service/tests -q`（host py312 內建 ifcopenshell 0.8.5 + ifctester）。
- baseline 45 passed → 預期 45 + 6 新測試 = 51 passed。
- 真實 IFC 測試（`test_engine_on_real_ifc`）需 storage 絕對路徑 fixture；worktree 無 storage，會 skip（不影響 PR 綠燈，main 上有 fixture）。

## 風險

- prohibited guard 依賴 ifctester 對 prohibited spec 設 `spec.status=False`；ifctester 0.8.5 已確認此行為（ids.py:325-327），fake spec 單測 + 真實 ifctester 端對端皆驗證 guard。殘留缺口（記錄、未 regress）：required spec 零 applicable 時 ifctester 亦設 status=False，但 applicable 空被 guard 第三條排除 → 不在本 prohibited scope。
- A1-RE-03 誠實文件範圍涵蓋 `app.py` 模組 docstring 與 `/health` 註解（governance-service 主入口），非僅 `rule_engine/`；本 change 一併修正 ifctester/BCF/IDS 過時敘述。
