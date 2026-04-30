# Review DataChannel Smoke

Use `web-viewer-sample` with `VITE_SHOW_DEMO_PANEL=true` or the default local config.

1. Open `http://127.0.0.1:5173`.
2. In `Demo Controls`, click `Send loadingStateQuery`.
3. Click `Send openStageRequest` after a ready `model.usdc` artifact is selected.
4. Click `Send getChildrenRequest /World`.
5. Click `Send highlightPrimsRequest /World`.
6. Click `Send focusPrimRequest /World`.
7. Click `Send clearHighlightRequest`.

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
