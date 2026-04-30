# Review DataChannel Smoke

Use `web-viewer-sample` with `VITE_SHOW_DEMO_PANEL=true` or the default local config.

1. Open `http://127.0.0.1:5173`.
2. In `Demo 操作面板`, click `送出 loadingStateQuery 查詢載入狀態`.
3. Click `送出 openStageRequest 開啟模型` after a ready `model.usdc` artifact is selected.
4. Click `送出 getChildrenRequest /World 載入 stage tree`.
5. Click `送出 highlightPrimsRequest /World 高亮`.
6. Click `送出 focusPrimRequest /World 聚焦`.
7. Click `送出 clearHighlightRequest 清除高亮`.

Expected Kit responses:

```txt
loadingStateResponse
openedStageResult
getChildrenResponse
highlightPrimsResult
focusPrimResult or an explicit error result
clearHighlightResult or an explicit error result
```

`highlightPrimsRequest` must not crash when a prim is missing. It should return a result payload with `missing_paths` and an honest `applied_mode`, even if the current implementation uses selection fallback.

When the demo sends `/World` but the converted model is rooted at another prim such as `/model`, Kit may return:

```json
{
  "event_type": "highlightPrimsResult",
  "payload": {
    "result": "success",
    "applied_mode": "selection",
    "selected_paths": ["/model"],
    "missing_paths": [],
    "fallback_paths": [
      {
        "requested_path": "/World",
        "selected_path": "/model",
        "reason": "stage_root_fallback"
      }
    ]
  }
}
```
