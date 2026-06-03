# Design

## Context

A2 diff 引擎（`governance-service/diff_engine/engine.py` 的 `run_diff`）以三級鍵對齊兩份 IFC 的 `IfcElement`：

1. **第一級** GlobalId：全域唯一 ID，dict 直配。
2. **第二級** Tag（Revit ElementId 常存於此）：原本以單純 `tag` 字串為 dict 鍵。
3. **第三級** type+name+loc：`f"{is_a()}|{Name}|{rounded_xyz}"`，同鍵多構件以 list 收集後 `zip` 配對。

配對後分類 moved / property_changed / geometry_changed（opt-in），未配對則 removed / added。對抗驗證在第二、三級找到型別一致性與穩定性缺口。

## Goals / Non-Goals

- **Goals**：修掉 A2-001（Tag 跨型別誤配，high）、A2-003（同鍵簇配對不穩定，low）；補 A2-002 退階對齊測試；清理與已落地 geometry_changed 矛盾的過時文件。
- **Non-Goals**：不改 `run_diff` 簽章、`DiffResult` schema、REST API、計數一致性語意；不動 coordinator proxy 與前端；不重寫對齊演算法（最小可回復 diff）。

## Decisions

### D1：第二級 Tag 鍵改為複合鍵 `(is_a(), tag)`（A2-001）

採「複合鍵」而非「配對時再比 `is_a()`」，原因：

- 與第一級 GlobalId（型別隱含唯一）、第三級 type+name+loc（型別已在鍵內）的型別一致性對齊，三級語意一致、易讀。
- dict 鍵層級就排除跨型別碰撞，無須在配對迴圈額外加守衛判斷，diff 更小。
- 同型別同 Tag 仍正常命中；跨型別同 Tag 落在不同鍵 → base 端 unmatched → removed、target 端 unmatched → added，正確分類。

考慮過的替代：保留單純 tag 鍵、在 `for tag, be ...` 迴圈內加 `if be.is_a() == te.is_a()`。可行但把型別一致性散到配對邏輯、與另兩級不一致，且需處理「同 Tag 不同型別」時 dict 已只存一個 entity 的問題（`setdefault` 會丟掉同 Tag 的其他型別），複合鍵根本上更乾淨。

### D2：第三級同鍵簇配對前以穩定次鍵排序（A2-003）

同鍵簇 `zip(bes, tes)` 的結果取決於 `bes`/`tes` 的順序，而該順序來自 `by_type()` 迭代序——對同鍵多構件不保證穩定，導致 property_changed 證據歸屬可能漂移。

修法：配對前對兩側各 `sorted(key=_stable_key)`，`_stable_key = (GlobalId or "", entity.id())`。GlobalId 為主、缺則退到 entity id 保證 total order。這讓「哪個 base 構件配哪個 target 構件」在相同輸入下穩定可重現。注意這不改變「配幾對」（仍是 `min(len(bes), len(tes))` 對），只穩定「配哪幾對」。

### D3：誠實文件清理範圍

只改與已落地 opt-in geometry_changed（PR #162）**矛盾**的過時敘述：

- `engine.py` 模組 docstring「geometry_changed 為 p1（需 tessellation，MVP 不計算）」→ 改述為 opt-in 已實作。
- `models.py` CHANGE_TYPES 註解「geometry_changed 為 p1，MVP 不計算」→ 同上。
- `keys.py` docstring「geometry hash fallback 為 p1，MVP 不計算」→ 改述為 opt-in 已實作於 geometry.py；並把模組首行「不做幾何 tessellation」收斂為「本模組僅算對齊鍵與 pset hash，幾何 tessellation 由 geometry.py 負責」以免誤導。

**保留**仍正確的誠實標示：`engine.py` 第 145 行 `include_geometry=false` 的 warning（正確描述 opt-in）、`geometry.py` docstring（正確）、`api.py` issue-impact 啟發式與 3D overlay p15（與 geometry_changed 無關，且仍誠實）。

## Risks / Trade-offs

- **Risk（LOW）**：`gitnexus_impact run_diff upstream` = LOW，直接 caller 僅 `run_diff_on_paths` 與 `api._execute`，本次只動 `run_diff` 內部對齊邏輯、簽章與回傳契約不變，caller 不受影響。既有 9 個 diff 測試 + 全 suite 45 → 49 全綠。
- **Trade-off**：複合鍵讓第二級不再以「純 Tag」跨型別配對——這正是預期行為（治理場景寧可如實報 removed+added，也不要靜默吞變更）。若未來有「同構件 re-export 換了 ifc_type 又換 GUID 又換 Tag」的極端情境，三級皆不中而落到 removed+added，屬可接受的誠實降級。

## Migration / Verification

- pytest：`"/c/Program Files/Python312/python.exe" -m pytest governance-service/tests -q -p no:cacheprovider`（baseline 45 → 49 全綠）。
- OpenSpec：`npx openspec validate a2-diff-tag-typeguard --strict`。
- whitespace：`git add -A && git diff --cached --check`。
