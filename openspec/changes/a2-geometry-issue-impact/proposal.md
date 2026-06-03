## Why

A2（model-version diff）原以 placement/pset 偵測 moved/property_changed，但 `geometry_changed` 與 `issue-impact`（resolved/reopened/new）原標 p1 未做。本 change 補上：geometry_changed 用 ifcopenshell.geom（opt-in，tessellation 較重），issue-impact 連動 Issue DB（`governance-issue-tracking`）做變更構件與既有 issue 的交叉比對。

## What Changes

- `governance-service/diff_engine` 擴充：
  - `geometry.py`：用 `ifcopenshell.geom` 算幾何 signature（bbox + vertex_count + bbox_volume）與 hash。
  - `run_diff(..., include_geometry=False)`：opt-in 啟用 geometry_changed（matched pair 幾何 hash 不同 → geometry_changed）。預設關閉（重）。
  - `GET /api/diffs/{id}/issue-impact`：把本 diff 的變更構件與 base model version 的 issue 交叉比對，回 `possibly_addressed`（啟發式）/ `still_open` / `new`。
- coordinator additive `/api/governance/diffs/{id}/issue-impact` proxy。
- 前端 A2 Diff Builder：含幾何比對選項、geometry_changed 計數、issue-impact 顯示、「變更構件建 issue」（from-diff）。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `model-version-diff-authority`：新增（1）opt-in geometry_changed 偵測（ifcopenshell.geom）與（2）issue-impact（與 Issue DB 交叉比對，啟發式誠實標示）。

## Impact

- Owner repo / folder:
  - `governance-service/diff_engine/`（geometry + api issue-impact）。
  - `bim-review-coordinator/src/routes/governanceProxy.ts`（additive issue-impact proxy）。
  - `web-viewer-sample/src/console/`（A2 頁 + governanceClient）。
- Runtime boundary:
  - geometry tessellation 為 CPU、opt-in；瀏覽器只打 :8004；issue-impact 讀 Issue DB（同 governance.db）。
- Dependencies:
  - 無新增生產依賴（ifcopenshell.geom + numpy 隨 ifcopenshell）。
- Non-goals:
  - geometry_changed 不自動全模型啟用（預設關閉，避免重 tessellation）；issue-impact 的 possibly_addressed 為**啟發式**，不自動轉 resolved（需人工確認）；不做 3D server-push overlay（p15）。
