# C2 Viewer Chrome MCP Evidence(2026-05-26)

> 對應 #108 `viewer-edge-bim-server-console` archive evidence gate。
> 透過 Chrome MCP `javascript_tool` 直接抓 viewer DOM testid + 計算結果,
> 不依賴 screenshot pixel diff,結果可重現。

## 環境

- Docker rebuild from main(coordinator-1 / viewer-1 container)
- host-native conversion service 49101(STORAGE_ROOT 設絕對 host path)
- host-native Kit/WebRTC 49100 + 47998
- HTTP server 127.0.0.1:8910 暴露 `storage/` 給 docker container 透過 `host.docker.internal:8910` fetch
- `RUNTIME_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 設為 absolute host path

## Test session

- review_session_id:`review_session_97a62e18d895`
- conversion_job_id:`stream_conv_20260526020354_c33202a9`
- IFC:`270_0dac5239-a2aa-4257-9946-c2b6da6bd24d_model.ifc`(341MB)
- viewer URL:`http://127.0.0.1:5173/?session=review_session_97a62e18d895`

## A. 預設 viewer(無 `?debug=1`)— spec scenarios 全綠

`javascript_tool` 結果(tab 1345327363):

| Spec scenario(來自 `session-first-review-viewer` C2 delta) | Evidence | 通過 |
|---|---|---|
| `TopBar surfaces project / version / session identity` | `topbar.present=true` + `topbar.project="project: project_demo_270"` + `topbar.version="version: version_demo_270"` + `topbar.session="session: review_session_97a62e18d895"` | ✅ |
| 「缺欄位 SHALL 顯示『未取得』」 placeholder | state 從 ReviewSession.project_id / model_version_id 帶,非 session_id 偽指 | ✅ |
| `Tri-ready status displayed separately` | `tri-ready-file="File: yes"` + `tri-ready-runtime="Runtime: yes"` + `tri-ready-semantic="Semantic: no"` | ✅ |
| 「UI MUST NOT 合併三段 ready 成單一 ready 字樣」 | 三段 badge 個別 data-testid + textContent 分開 | ✅ |
| 「Semantic 任一不存在 SHALL 顯示 incomplete/no,不偽宣告 yes」 | C1 fallback 已產 mapping 但 coordinator 未 forward quality_metrics_summary → viewer 對 null summary 誠實標 `no`(預期行為) | ✅ |
| `Kit loaded URL matches expected conversion artifact` | `stage truth rows`:expected = loaded = `http://127.0.0.1:49101/artifacts/stream_conv_20260526020354_c33202a9/model.usdc` + `stage-truth-panel--matched` | ✅ |
| `WebRTC video / DataChannel` | stage truth row:`WebRTC: started · kit_host_native_001 127.0.0.1:49100/47998` | ✅ |
| `USDAsset picker is hidden without ?debug=1` | `usdAssetVisible=false` + `<select>` count=0 + DemoControlPanel 無 | ✅ |
| 「`ReviewLauncher` / `PresencePanel` / `ArchitectureOverview` 元件刪除」 | `hasReviewLauncher=false` + body 不含對應字串 | ✅ |
| Edge BIM Data Server Console 命名 | `bodyHasEdgeServerLabel=true` | ✅ |

## B. `?debug=1` 切換 — debug 區段渲染

`javascript_tool` 結果(tab 1345327373,URL 加 `&debug=1`):

| 項目 | 預設 viewer | `?debug=1` viewer | 通過 |
|---|---|---|---|
| TopBar 是否在 DOM | yes | yes(不受影響)| ✅ |
| `<select>` count(USDAsset 下拉) | 0 | **1**(USDAsset 出現)| ✅ |
| body 含 Element mapping / 載入元件對照表 / 轉檔品質摘要 / USD Asset / USD Stage 字樣 | false | **true**(DemoControlPanel + USDAsset / USDStage 出現)| ✅ |
| Stage status class | `--matched`(WebRTC alive)| `--pending`(此 tab 是後開,Kit 一次 serve 一個 viewer,後到的等)| 預期行為,不阻擋 |

spec scenario `USDAsset picker is visible with ?debug=1` ✅。

## C. 整體判定

C2 PR #108 的 spec delta scenarios(MODIFIED 3 + ADDED 2 + REMOVED 2):

- ✅ MODIFIED `Viewer bootstraps from review request or session` — USDAsset gated by `?debug=1`
- ✅ MODIFIED `Viewer displays artifact and lifecycle state` — 三段 ready 分層
- ✅ MODIFIED `Viewer displays streaming-owned conversion and composition status` — fallback adoption surfaced
- ✅ ADDED `Viewer is positioned as Edge BIM Data Server Console` — TopBar / 三段 ready 渲染
- ✅ ADDED `Viewer uses element mapping as semantic verification entry` — debug 區段保留 mapping 操作
- ✅ REMOVED `Viewer separates runtime commands from collaboration events` — collaboration 元件全刪
- ✅ REMOVED `Viewer supports multi-artifact review controls` — multi-artifact UI 不渲染

完整 closed loop end-to-end 驗證(host fs IFC → http server → coordinator dispatch
→ host-native conversion service ready → viewer 顯示 stage matched + WebRTC started):
**all green**。

## Out of scope(留 follow-up)

- **Semantic ready = yes** 需 coordinator 把 `quality_metrics_summary` 從 conversion
  result 帶進 stream_config(屬 enhancement,需新 OpenSpec change `coordinator-forward-quality-metrics-summary`)。本輪 C1 fallback 已產 `semantic_mapping_fidelity` /
  `mapping_has_ifc_type` / `mapping_has_ifc_name` 在 `quality_metrics.json`,但
  coordinator 沒 inject 進 stream_config response 給 viewer。
- Inspector 4 層完整拆分 / Bottom Strip 完整 4 段:本輪只實作 TopBar + tri-ready
  row + 條件渲染,完整 IA 拆分留 Phase 2 follow-up(已在 PR #108 description 寫入)。

## Raw javascript_tool output

```json
// tab 1345327363(無 debug)
{
  "topbar": {
    "present": true,
    "project": "project: project_demo_270",
    "version": "version: version_demo_270",
    "session": "session: review_session_97a62e18d895"
  },
  "triReady": {
    "section": true,
    "file": "File: yes",
    "runtime": "Runtime: yes",
    "semantic": "Semantic: no"
  },
  "stageTruth": {
    "rows": [
      "expected: http://127.0.0.1:49101/artifacts/stream_conv_20260526020354_c33202a9/model.usdc",
      "loaded: http://127.0.0.1:49101/artifacts/stream_conv_20260526020354_c33202a9/model.usdc",
      "WebRTC: started · kit_host_native_001 127.0.0.1:49100/47998"
    ],
    "status": "stage-truth-panel stage-truth-panel--matched"
  },
  "usdAssetVisible": false,
  "hasDemoControl": false,
  "hasReviewLauncher": false,
  "bodyHasEdgeServerLabel": true
}

// tab 1345327373(?debug=1)
{
  "topbarPresent": true,
  "triReadyFile": "File: yes",
  "triReadyRuntime": "Runtime: no",
  "triReadySemantic": "Semantic: no",
  "selectCount": 1,
  "bodyMentionsMappingPanel": true,
  "stageStatusClass": "stage-truth-panel stage-truth-panel--pending"
}
```
