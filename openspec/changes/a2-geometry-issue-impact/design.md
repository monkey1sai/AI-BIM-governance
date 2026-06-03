# Design — a2-geometry-issue-impact

## geometry_changed（opt-in）

- `diff_engine/geometry.py`：`ifcopenshell.geom.create_shape` → verts → bbox(min/max) + vertex_count + bbox_volume → sha1 hash。無 `Representation` 或 tessellate 失敗回 None（安全略過）。
- `run_diff(..., include_geometry=False)`：預設關閉（tessellation 對數千構件較重）。啟用時對已配對 pair 比 geometry_hash，不同 → `geometry_changed`。warnings 誠實標示是否計算。

## issue-impact（連動 Issue DB）

- `GET /api/diffs/{id}/issue-impact`：讀 base_model_version_id 的 issue（`governance-issue-tracking`，kind=issue）+ 本 diff 變更構件，依 `ifc_guid` 交叉比對：
  - `possibly_addressed`：issue 構件在本 diff 有變更（removed/moved/geometry/property）→ **啟發式**，可能已處理（不自動轉 resolved）。
  - `still_open`：issue 構件未變更。
  - `new`：有變更（含 added）但無既有 issue 的構件數。

## 邊界 / 誠實

- 瀏覽器只打 :8004；issue-impact 讀同一 governance.db 的 issues。
- possibly_addressed 明標啟發式，需人工確認；geometry 預設不算（誠實 warnings）。

## 驗證

- pytest：geometry signature（真實牆，決定性 + 區分性）+ 無 representation 安全略過 + issue-impact 分類（possibly_addressed/still_open/new）。
- 前端 build + vitest；coordinator tsc。
- host Python 3.12（ifcopenshell.geom + numpy）。
