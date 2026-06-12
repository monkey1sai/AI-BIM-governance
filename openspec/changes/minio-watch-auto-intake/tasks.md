# Tasks — minio-watch-auto-intake

對應 plan：`docs/superpowers/plans/2026-06-12-minio-watch-auto-intake.md`；spec：`docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md`。

- [x] Task 0：config `MINIO_WATCH_*` env 欄位 + interval floor 夾值（overrides 合併後）+ `.env.example` 欄位（commits `61779fc` 等）
- [x] Task 1：`@aws-sdk/client-s3` 依賴 + credentials guard 哨兵測試（含 web-identity env 隔離）（commit `ab6b434` 等）
- [x] Task 2：watcher 純函式（key 解析 / idempotency 導出 / payload 組裝）（commit `c5de50d`）
- [x] Task 3：watcher loop（list 分頁 → baseline → 觸發 → status；tenant 可配置、dispose 等 tick settle、selfBaseUrl SSRF fast-fail、poll_count）（commit `66e5578` 等）
- [x] Task 4：app 掛載 + `GET /api/external/minio-watch/status` + dispose 介面 `Promise<void>` 統一（commits `19db646`、`aab9a2b`）
- [x] Task 5：端到端整合測試（watcher → 真 coordinator intake → 去重）（commit `b9fc96d` 等）
- [x] Task 6：前端 `minioWatchStatus` client + `#/conv` watcher Panel（含輪詢次數）（commit `0053e08` 等）
- [x] Task 7：Browser E2E（全程不碰按鈕）+ tracked 證據 + s3State 單例重置（commit `e13a461` 等）
- [x] Task 8：`.env.example` parity 測試（雙向掃描）+ 全套回歸（commit `c6f7114`）
- [x] P5 對抗複驗修復：兩頁分頁測試（mutation probe 驗證 load-bearing）+ tenant 措辭如實化（commit `7b7d682`）
