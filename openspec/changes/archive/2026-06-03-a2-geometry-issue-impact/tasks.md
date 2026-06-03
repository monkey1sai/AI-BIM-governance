## 1. Preflight

- [x] 1.1 確認 `ifcopenshell.geom` 在真實牆可 tessellate（verts/bbox）。
- [x] 1.2 branch `codex/openspec/a2-geometry-issue-impact`（stacked 於 governance-issue-db）。

## 2. Tests First

- [x] 2.1 geometry signature 真實幾何（決定性 + 區分性）+ 無 representation 安全略過。
- [x] 2.2 issue-impact 分類（possibly_addressed / still_open / new）。

## 3. Core

- [x] 3.1 `diff_engine/geometry.py`：geometry_signature / geometry_hash（ifcopenshell.geom）。
- [x] 3.2 `engine.run_diff(include_geometry)`：opt-in geometry_changed + 誠實 warnings。
- [x] 3.3 `diff_engine/api.py`：DiffRequest.include_geometry + `GET /api/diffs/{id}/issue-impact`。

## 4. Proxy + 前端

- [x] 4.1 coordinator additive `/api/governance/diffs/{id}/issue-impact` proxy。
- [x] 4.2 A2 Diff Builder：幾何比對選項 + geometry_changed 計數 + issue-impact 顯示 + from-diff 建 issue；誠實標示更新。

## 5. Validation

- [x] 5.1 `pytest tests/test_diff_geometry_impact.py`（3 passed）。
- [ ] 5.2 全套 pytest + 前端 build/test + coordinator tsc。
- [ ] 5.3 `npx openspec validate a2-geometry-issue-impact --strict`。

## 6. Closeout

- [ ] 6.1 commit + PR（stacked 於 #157 governance-issue-db）。
- [ ] 6.2 merge 後 archive。
