# Tasks — conv-watch-toggle（IX-CV-04）

對應 plan `docs/superpowers/plans/2026-06-17-conv-watch-toggle.md`（7 tasks）。狀態於 PR 收尾時依實際實作勾選。

- [ ] 1. coordinator runtime enabled 狀態機改造（非 additive）：`minioWatchRuntimeEnabled`/`minioWatchToggleBusy`/`minioWatchConfigured()`；`startMinioWatcherIfEnabled` guard + config-immediate 改讀 runtime flag。回歸鎖 `config-minio-watch`/`minio-watch-status-route`/`minio-watcher-loop`（env on/off 啟動語意零退化）。
- [ ] 2. `PUT /api/conversion/watch {enabled}`：`rejectIfIpNotAllowed` 守門 + `resolveActor`/`parseReason` + audit（`conversion.watch.toggle`）；`enabled:true` 未配置→422、allowlist throw→500+flag 回滾；`enabled:false` 沿用 shutdown 安全 dispose；toggle 同步鎖防並發。spec §6.1 三條具名測試（啟用中 dispose / enabled:true 重建 / off→on 往返無雙 watcher，vi.mock fake watcher）+ 邊界（400/422/403/no-op/並發 409）。
- [ ] 3. `GET /api/external/minio-watch/status` 改讀 runtime flag + 抽 `currentMinioWatchStatusPayload()`；note 區分「env 未開」vs「runtime 被操作者關閉」；關閉態形狀回歸（不洩漏 credentials）。
- [ ] 4. 前端 `coordinatorClient` 補 `jsonPut` + `conversionWatchToggle`（回應重用 `MinioWatchStatus`）+ 單元測試。
- [ ] 5. 前端 `#conv` MinIO 自動偵測 Panel 加開關控制（沿用 `IntentDialog`，`pendingAction` union 擴 `watch-toggle` kind）+ 關閉態頁頂琥珀條（`conv-watch-off-banner`）；非樂觀（toggle 後 `load()` 重抓）。
- [ ] 6. 前端 component 測試（依 `mw.enabled` 渲染鈕 + 琥珀條 / confirm 呼叫 toggle + 證據型刷新 / 失敗誠實不改狀態）。
- [ ] 7. Browser E2E（Playwright，誠實可達框架）：開關往返切片（關→琥珀條→開→消失）或誠實 422 負向；render-surface + `notObserved` 揭露；evidence 落 `docs/evidence/conv-watch-toggle/`。
- [ ] 8. 全量回歸（coordinator `npm run verify` + web-viewer `npm test`/`build` 綠）+ scope 確認（只動 coordinator + web-viewer + docs，`bim-streaming-server`/MinIO/viewer 零改）。
