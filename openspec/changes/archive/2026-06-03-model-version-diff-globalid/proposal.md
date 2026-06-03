## Why

A2「模型版本差異與責任追蹤」是管理層真正關心的問題：這版改了什麼？為什麼成本變了？之前的 issue 修掉了嗎？目前 repo 有 A1 治理 rule-run authority，但無法比對兩個 model version。A2 用 IFC GlobalId 多級對齊兩份 IFC，標記 added / removed / moved / property changed，純 CPU、不需 GPU。

## What Changes

- 擴充落地端 `governance-service`（:49102 loopback）新增 model-version diff 能力：
  - 多級對齊鍵（roadmap A2 S1·W1）：1) IFC GlobalId 2) Tag（source element id）3) ifc_type+Name+取整 placement 位置。（4) geometry hash fallback 為 p1，MVP 不做幾何 tessellation。）
  - 變更分類：added / removed（未配對）、moved（placement 平移 > tol）、property_changed（property_sets hash 改變，與幾何獨立）。geometry_changed 為 p1。
  - 持久化 `model_diffs` / `model_diff_items`（SQLite，沿用 governance.db）。
  - REST（內部 :49102）：`POST /api/diffs`、`GET /api/diffs/{id}`、`GET /api/diffs/{id}/items?change_type=`、`POST /api/diffs/{id}/apply-overlay`（p15，回 501）。
- coordinator additive `/api/governance/diffs*` proxy（loopback 透傳）。
- 前端 A2「Diff Builder」頁：經 proxy 觸發 diff、顯示 matched/added/removed/moved/property_changed 與變更清單。

## Capabilities

### New Capabilities

- `model-version-diff-authority`：落地端以 IFC GlobalId 多級對齊兩個 model version，誠實分類並持久化變更，維持 loopback / coordinator-proxy / 無捏造 邊界。

### Modified Capabilities

- None.（governance-service 內新增獨立 diff 模組；coordinator 為 additive proxy；console 既有頁升級。）

## Impact

- Owner repo / folder:
  - `governance-service/diff_engine/`（diff 引擎、store、REST router）；`app.py` 一行 include_router。
  - `bim-review-coordinator/src/routes/governanceProxy.ts`（additive diff proxy routes）。
  - `web-viewer-sample/src/console/`（VersionDiffPage 升級 + governanceClient diff 方法）。
- API / data shape:
  - 內部 :49102 新增 `/api/diffs*`；coordinator `/api/governance/diffs*`；外部契約不變。
- Runtime boundary:
  - 重 CPU diff 在 governance-service 獨立 process；瀏覽器只打 :8004；3D overlay 走 client highlight 不復活 server-push。
- Dependencies:
  - 無新增生產依賴（numpy 隨 ifcopenshell；placement 用 `ifcopenshell.util.placement`）。
- Non-goals:
  - 不做幾何 tessellation 比對（geometry_changed p1）、不做 issue impact（待 Issue DB）、不做 3D server-push overlay（p15）、不改 conversion authority / 雲端權威。
