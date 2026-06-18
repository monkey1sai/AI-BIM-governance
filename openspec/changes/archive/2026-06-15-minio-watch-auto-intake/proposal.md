## Why

M2 轉檔管線的唯一觸發是外部 IFC worker 手動 POST webhook — v3 §3.3 M2-R1 要求「觸發機制選型（解 O4）：MinIO bucket event vs 輪詢，官方文件核實後定案」、M2 DoD 要求「丟新檔不碰按鈕 → 自動轉檔」。盤點實證 repo 無任何 MinIO list/poll/event code，coordinator 不持有 MinIO credentials。

O4 定案**輪詢（ListObjectsV2）**：對生產 MinIO 零侵入（bucket event 需 `mc admin` 動 server 設定）、唯讀 credentials、每輪全量對帳漏抓自癒、watcher 對 loopback 自打既有 intake API 使下載/sanitize/dispatch/callback 鏈零變動。bucket event 留作未來低延遲升級路。

## What Changes

- **coordinator `minioWatcher` 服務**（新 `src/services/minioWatcher.ts`）：env opt-in（`MINIO_WATCH_ENABLED` 預設 **false**，既有部署零回歸）；setTimeout 鏈輪詢 `ListObjectsV2`（含分頁 continuation）；首輪 baseline 只登記不觸發（防 867 既有物件爆量）；新 key/新 etag → presigned GET URL + 確定性 idempotency key（`mw_<sha256(bucket|key|etag)>`）對 loopback `POST /api/external/ifc-ready`（重啟重掃命中既有去重）；`tenant_id` 可配置（未設回退 `tenant_demo_001`）。
- **安全**：`selfBaseUrl` loopback 白名單 fast-fail（防 SSRF 洩 webhook secret）；S3 credentials env-only（`.env.example` 空值欄位 + parity 測試含反向掃描防 key 漂移）；顯式 credentials 不落 IMDS chain（哨兵測試鎖）；interval 下限 floor 在 overrides 合併後夾值（防忙迴圈，mutation probe 驗證）。
- **新 production dependency `@aws-sdk/client-s3`**：S3 互通事實標準（MinIO 官方相容），僅用 ListObjectsV2 + presigner 兩 API 面；自寫 SigV4 易錯難審故採 SDK。
- **`GET /api/external/minio-watch/status`** + `#/conv`「MinIO 自動偵測（O4）」Panel：enabled/bucket/輪詢次數/baseline/seen/觸發/跳過/最近觸發與錯誤；未啟用時誠實顯示 opt-in 提示。
- **Browser E2E**：fake S3 stub 注入新物件 → **全程不碰按鈕** → job 自動 dispatched + Panel triggered≥1；tracked 證據 `docs/evidence/minio-watch-auto-intake/`。
- 非目標：usdc writeback 到 MinIO 與 coverage UI（M2 收尾下一輪）；bucket event（升級路）；多 bucket/prefix。

## Capabilities

### New Capabilities

- `minio-watch-auto-intake`: coordinator 可輪詢 MinIO bucket 自動偵測新 IFC 並觸發既有 intake→dispatch 鏈，operator 於 `#/conv` 可見 watcher 真實狀態。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder：`bim-review-coordinator/src/services/`、`bim-review-coordinator/src/config.ts`、`bim-review-coordinator/tests/`、`web-viewer-sample/src/console/`、`web-viewer-sample/e2e/`。
- API / data shape：新增唯讀 `GET /api/external/minio-watch/status`；既有 intake/dispatch/callback API 零變動；`CoordinatorConfig` 新增 11 個 `minioWatch*` optional 欄位（`dispose` 介面統一 `Promise<void>`）。
- Runtime boundary：watcher 預設關；啟用需 env credentials（唯讀）；不動 ports/服務拓樸。
