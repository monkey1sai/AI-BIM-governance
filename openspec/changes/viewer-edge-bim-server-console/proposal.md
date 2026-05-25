## Why

2026-05-25 fast MVP session/artifact binding 討論筆記(`docs/plans/TEMP-fast-mvp-session-artifact-binding-discussion-2026-05-25.md`)
明確指出:目前 viewer 把所有狀態都用 `ready` 表示容易讓使用者誤把「stage matched」
等同於「IFC 語意也正確」;主畫面仍偏向「fast MVP 審查 demo 操作面板」,但目前
目標應收斂為「落地端 BIM 重量資料伺服器的可信狀態面板」。

筆記同時宣告:不做審查問題時,Element mapping 資料能力仍應保留作為 IFC entity →
USD prim 的語意驗收入口;但 issue / multi-user / repo map / Interaction lab 等
collaboration 語境應從主畫面退役。

## What Changes

- 重新定位 `web-viewer-sample` 為 **Edge BIM Data Server Console**:
  - TopBar 顯示 `project_id` · `external_model_version_id` · session status
  - 主區維持 WebRTC 3D viewer + stage truth panel
  - 右側 Inspector 分四層:① 本機資料包、② 轉檔品質、③ BIM 語意對照、
    ④ 技術細節(debug 收納)
  - Bottom Evidence Strip:webhook · conversion · stage · WebRTC 四段證據
- 三段 ready 計算與顯示(取代單一 `ready`):
  - **File ready** = `stream_config.model.status === "ready"` + `model.url` 存在
  - **Runtime ready** = WebRTC `started` + `stageLoadStatus === "matched"`
  - **Semantic ready** = `quality_metrics_summary.semantic_mapping_fidelity` set
    + `mapping_has_ifc_type=true` + `mapping_has_ifc_name=true`(C1 提供)
- `?debug=1` URL flag 才顯示:USDAsset 下拉、USDStage tree、DataChannel /
  Socket.IO log、舊 DemoControlPanel debug 操作。主流程預設不渲染。
- 刪除以下 fast MVP 不需要的 viewer 元件 / 區段:
  - `ReviewLauncher` 元件(若 fast MVP 無對外用途)
  - `PresencePanel` 元件
  - `ArchitectureOverview` 元件(repo map)
  - `DemoControlPanel` 中 issue 試標 / Socket.IO event log / collaboration 區段
  - `reviewSocket.ts` 中殘留的 collaboration event handlers(若 `remove-conflict-review-from-fast-mvp` 後仍有)
- 擴 viewer schema 對齊 C1 / C4 contract:
  - `ConversionQualityMetricsSummary` 加 `semantic_mapping_fidelity` /
    `mapping_has_ifc_type` / `mapping_has_ifc_name`(來自 C1)
  - `ReviewLifecycleStatus` 加 `queued_for_conversion` / `dropped_on_restart`
    (來自 C4),viewer 對應顯示「等待轉檔輪到」/ runbook 提示

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `session-first-review-viewer`:
  - MODIFY 既有 requirement「Viewer bootstraps from review request or session」
    加 scenario:USDAsset picker 預設不渲染,僅 `?debug=1` 顯式啟用
  - MODIFY 既有 requirement「Viewer displays artifact and lifecycle state」
    要求 File / Runtime / Semantic 三段 ready 分層;加 scenario:
    `queued_for_conversion` lifecycle 不嘗試 WebRTC,顯示「等待轉檔輪到」+
    `queue_position`
  - MODIFY 既有 requirement「Viewer displays streaming-owned conversion and
    composition status」加 scenario:viewer 必須清楚分辨 primary HOOPS 失敗 +
    fallback 採用,顯示 `semantic_mapping_fidelity`
  - ADD requirement「Viewer is positioned as Edge BIM Data Server Console」
    描述 TopBar / 4 層 Inspector / Bottom Evidence Strip 結構
  - ADD requirement「Viewer uses element mapping as semantic verification entry」
    保留 mapping highlight/focus 作為 IFC entity → USD prim 驗收入口
  - REMOVE requirement「Viewer separates runtime commands from collaboration
    events」(collaboration Scenarios 已退役;DataChannel command 由新 Semantic
    verification entry 涵蓋)
  - REMOVE requirement「Viewer supports multi-artifact review controls」
    (fast MVP 不需 multi-artifact 切換 UI;`?debug=1` USDAsset picker 涵蓋
    debug 場景)

## Impact

- Owner repo / folder:
  - `web-viewer-sample/src/Window.tsx`、`web-viewer-sample/src/types/review.ts`、
    `web-viewer-sample/src/components/`、`web-viewer-sample/src/clients/`
  - `openspec/changes/viewer-edge-bim-server-console/`
- Runtime boundary:不改 streaming-server / coordinator runtime;viewer 端純前端 IA
  重排與 schema 擴充。
- API contract:viewer 消費的 `stream_config.quality_metrics_summary` 欄位為
  additive(C1 提供新欄位;舊欄位 backward compatible)。viewer 對
  `?debug=1` query param 為新行為(無 query 時舊預設 UI 不渲染 debug 區段)。
- Data:viewer 不保存資料,純前端 derived state。
- Dependencies:無新增。
- Non-goals:
  - 不還原 multi-user collaboration / issue / annotation workflow
  - 不引入新 production dependency
  - 不修 HOOPS A3D primary path
  - 不改 streaming-server / coordinator runtime 行為
  - C2 不負責 coordinator `/ui` 變化(屬於 C3 scope)
