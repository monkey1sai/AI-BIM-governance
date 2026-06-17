## Why

`#conv` 的「MinIO 自動偵測（O4）」面板目前只有唯讀 watcher 狀態，operator 無法在 runtime 開關輪詢。本提案為 IX-CV-04 自動偵測開關（`PUT /api/conversion/watch`），把既有「process-lifecycle 單次接線」的 MinIO watcher 啟停改造成「runtime 可重入」，沿用 IX 模式 3（intent→confirm→audited），補上 `#conv` M2 控制面的最後一張互動卡。

## What Changes

- coordinator 引入 mutable `minioWatchRuntimeEnabled` runtime flag（初值=env opt-in），`startMinioWatcherIfEnabled` guard 與 config-immediate 啟動改讀此 flag（非純 additive：既有啟動行為變更，回歸鎖）。
- 新增 `PUT /api/conversion/watch {enabled}`：沿用 `rejectIfIpNotAllowed` IP 守門 + `resolveActor`/`parseReason` + 結構化 audit（`conversion.watch.toggle`）。`enabled:true` 未配置連線參數誠實 422；toggle 同步鎖（`minioWatchToggleBusy`）防並發競態；`enabled:false` 沿用 shutdown 安全 dispose 模式。
- `GET /api/external/minio-watch/status` 改讀 runtime flag，抽共用 `currentMinioWatchStatusPayload()`；note 誠實區分「env 未開」vs「runtime 被操作者關閉」。
- 前端 `coordinatorClient` 補 `jsonPut` + `conversionWatchToggle`；`#conv` MinIO 自動偵測 Panel 加開關控制（沿用既有 `IntentDialog`）+ 關閉態頁頂琥珀條（規格 line 157）。
- 誠實鐵律：無樂觀更新（toggle 後 `load()` 重抓真 status）、未配置不給假成功、audit who best-effort、runtime flag in-memory 重啟回 env 初值（status note 誠實標、不偽稱持久）。

## Impact

- Affected specs: `conversion-control`（ADDED：watch toggle controlled action）；關聯 `minio-watch-auto-intake`（無 watcher 內部行為變更，僅新增 runtime 啟停編排）。
- Affected code: `bim-review-coordinator`（runtime flag + PUT route + GET status 改讀 + audit）、`web-viewer-sample`（client `jsonPut`/`conversionWatchToggle` + `#conv` UI 開關/琥珀條）。
- 不改 `bim-streaming-server` / MinIO server / viewer DataChannel；不引入新 production dependency。
- userFacing：true（`#conv` 控制動作，須 browser E2E 驗收）。
- 風險：runtime 接線改造為既有啟動行為變更（非純 additive），需回歸鎖（既有 `minio-watch-*` 測試）；toggle async dispose 競態以同步鎖緩解。
