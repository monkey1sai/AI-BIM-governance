# MinIO 輪詢自動 intake（O4 觸發機制落地）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > wiki；與實作衝突時以實作程式碼與 `openspec/specs/` capability spec 為準。
- 日期：2026-06-12
- Phase 對應：M2-R1（v3 §3.3：「觸發機制選型：MinIO bucket event vs 輪詢（解 O4）→ 官方文件核實後定案」）。M2 DoD 的前半（自動觸發）；後半（usdc writeback + coverage UI）拆下一輪。
- userFacing：true（`#/conv` watcher 狀態面板）

## 1. 背景與 O4 選型定案

現狀（2026-06-12 盤點實證）：轉檔鏈的唯一觸發是外部 IFC worker 手動 `POST /api/external/ifc-ready`（B-scheme webhook）；repo 內無任何 MinIO list/poll/event code，coordinator 不持有 MinIO credentials（intake 的 `source_ifc.ref` 由外部帶 presigned URL，#205 案例）。真 MinIO `192.168.20.234:9000`（S3 API）可達，bucket `bim-control/{projectId}/{modelId}/model.ifc`。

**O4 兩案比較（官方機制核實）**：

| | A：bucket event notification（push） | B：輪詢 ListObjectsV2（pull，**定案**） |
|---|---|---|
| 官方支援 | MinIO Bucket Notifications（webhook target，`s3:ObjectCreated:*`） | 標準 S3 API（MinIO 完全相容） |
| MinIO server 侵入 | 需管理端設定 event target（`mc admin config set notify_webhook` + `mc event add`），動使用者生產 MinIO 設定 | **零侵入**（唯讀 list） |
| credentials | webhook 不需，但設定需 admin 權限 | 唯讀 access key 即可 |
| 即時性 | 秒級 | 輪詢間隔（預設 60s，env 可調）— 轉檔本身分鐘級，可接受 |
| 契約面 | S3 event payload 需新轉換層 + 新公開 endpoint | **重用既有 intake 契約**（watcher 對 loopback 自打 `POST /api/external/ifc-ready`） |
| 失效模式 | event 丟失無重送保證（MinIO at-most-once 對 webhook target） | 每輪全量 list 對帳，漏一輪下輪補上 |

定案 B：邊界最乾淨（watcher 扮演「外部 IFC worker」的本地自動化角色，intake/去重/sanitize/dispatch 鏈零變動）、對生產 MinIO 零侵入、漏抓自癒。A 案留作未來低延遲需求的升級路（spec 記錄即可）。

## 2. 目標（成功標準）

1. coordinator 新增 **minioWatcher**（env opt-in，**預設關**）：定時 `ListObjectsV2` 指定 bucket/prefix，偵測新的 `*/model.ifc` 物件 → 自動組 B-scheme payload 對 loopback `POST /api/external/ifc-ready`（帶既有 webhook secret）→ 既有下載/sanitize/dispatch/poll/callback 鏈全自動走完。
2. **首掃 baseline 不觸發**：watcher 啟動後第一輪 list 只登記 seen（baseline），之後輪次的新物件（新 key 或同 key 新 etag）才觸發 intake — 防止對既有 bucket（867 objects）爆量誤觸發。
3. **重啟冪等**：intake 的 `X-Idempotency-Key` 採物件確定性導出（`minio-watch` 前綴 + bucket/key/etag hash），重啟後重掃同物件命中既有 `idempotencyIndex` 去重（202 idempotent_replay），不重複建 job。
4. `#/conv` 可見 watcher 真實狀態（enabled/bucket/最近一輪時間/seen 數/最近錯誤/觸發數），來自新 `GET /api/external/minio-watch/status`；watcher 關閉時誠實顯示「未啟用（env opt-in）」。
5. Browser E2E：以 fake S3 stub（回 ListObjectsV2 XML 的本機 http server）驗證「stub 出現新物件 → watcher 自動 intake → job 進入 dispatched（stub conversion）→ `#/conv` 列表可見該 job 與 watcher 狀態」— 全程不碰任何按鈕（M2 DoD 前半語意）。

## 3. 非目標（明確不做）

- 不做 usdc writeback 到 MinIO、不做 coverage UI 顯示（M2 收尾下一輪；callback 雲端 endpoint 屬 OQ1 外部依賴）。
- 不做 bucket event notification（A 案，記錄為升級路）。
- 不動既有 intake 契約 / 去重 / sanitize / dispatch / callback 任何行為（watcher 是純增量的前端自動化）。
- 不做 watcher 的多 bucket / 多 prefix 陣列（單 bucket 單 prefix，YAGNI）。
- 不把 MinIO credentials 寫進任何 tracked 檔（env only；`.env.example` 只加欄位名與空值）。

## 4. 設計

### 4.1 coordinator：minioWatcher 模組（新 `src/services/minioWatcher.ts`）

- **依賴**：新增 `@aws-sdk/client-s3`（業界標準 S3 client，MinIO 官方相容；僅用 `ListObjectsV2Command` 與 `GetObjectCommand` 的 presigner）。新增 production dependency 的理由：自寫 AWS SigV4 簽章易錯且難審，SDK 為 S3 互通的事實標準 — PR body 揭露。
- **config（`config.ts` 新欄位，全 env）**：
  - `MINIO_WATCH_ENABLED`（預設 `false`）
  - `MINIO_WATCH_ENDPOINT`（如 `http://192.168.20.234:9000`）、`MINIO_WATCH_BUCKET`（如 `bim-control`）、`MINIO_WATCH_PREFIX`（預設空）
  - `MINIO_WATCH_ACCESS_KEY` / `MINIO_WATCH_SECRET_KEY`（唯讀帳號；不落 tracked 檔）
  - `MINIO_WATCH_INTERVAL_SECONDS`（預設 60，下限 10）、`MINIO_WATCH_KEY_SUFFIX`（預設 `/model.ifc`，規約檔名）
- **迴圈**（比照既有 `pollConversionResult` 的 setTimeout 鏈模式，不用 setInterval）：
  - 每輪 `ListObjectsV2`（分頁全量）→ 過濾 key 以 `KEY_SUFFIX` 結尾 → 與 in-memory `seen: Map<key, etag>` 比對。
  - 首輪：全部寫入 seen，**不觸發**（baseline；log 記 baseline 數）。
  - 後續輪：新 key 或 etag 變更 → 觸發 intake → 更新 seen。
  - 觸發 = 對 `http://127.0.0.1:{port}/api/external/ifc-ready` POST B-scheme payload（loopback 自打，帶 `X-Webhook-Secret` = 既有 `externalIntakeWebhookSecret`、`X-Correlation-Id` = `minio-watch-<hash8>`、`X-Idempotency-Key` = `mw_<sha256(bucket|key|etag)[:16]>`）。
  - payload 導出：key `{prefix}{projectId}/{modelId}/model.ifc` → `project_id={projectId}`、`external_model_version_id={modelId}`、`external_conversion_task_id={modelId}_mw_<etag前8>`、`source_ifc.ref` = **presigned GET URL**（expiry 1h，SDK presigner）、`source_ifc.etag` = `sha256:<etag 去引號>` 形或原樣（對齊既有 intake schema 的 etag 欄位格式，以 schema 實際驗證規則為準）、`requested_outputs` 與 `callback_url` 比照契約 example。
  - 層級不符（key 去 prefix 後非恰兩層）→ 跳過並記 `skipped_malformed` 計數（誠實統計）。
- **狀態**：`getStatus()` 回 `{enabled, bucket, prefix, interval_seconds, last_poll_at, last_error, baseline_count, seen_count, triggered_total, skipped_malformed_total, last_triggered:[最近5筆 {key, job_id|error, at}]}`。
- **失效安全**：list/presign/POST 任一失敗 → 記 `last_error`、該輪放棄、下輪重試（不 crash app）；POST 回 409/4xx 同樣記入 last_triggered 的 error。
- 掛載：`app.ts` 啟動段 `if (config.minioWatchEnabled) startMinioWatcher(...)`（比照既有 conversionPoll 模式）；`GET /api/external/minio-watch/status` 公開唯讀（無 secret 洩漏 — status 不含 credentials）。

### 4.2 EdgeConsole：`#/conv` watcher 狀態

- `ConversionSchedulingPage` 新增「MinIO 自動偵測（O4）」小 Panel：呼叫 `coordinatorClient.minioWatchStatus()`（新 client 方法）。
  - enabled=false → 誠實顯示「未啟用 — env `MINIO_WATCH_ENABLED` opt-in」（`prov="asbuilt"`，狀態 API 是真的；不偽稱功能在跑）。
  - enabled=true → 顯示 bucket、last_poll、baseline/seen/triggered 計數、最近觸發清單與錯誤。
- pipeline 第一步「讀 MinIO / storage」的 prov 語意由本 Panel 補足（自動偵測=asbuilt with opt-in；不改 LifecycleStrip 本體）。

### 4.3 資料流（一句話版）

watcher（每 60s）`ListObjectsV2` → 新 `*/model.ifc` → presigned URL + 確定性 idempotency key → loopback `POST /api/external/ifc-ready` → 既有鏈（下載 → sanitize dispatch → conversion → poll → callback/session）→ `#/conv` 列表出現 job + watcher Panel 計數遞增 — 全程零人工。

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| MinIO 不可達 / credentials 錯 | 該輪記 last_error 放棄，下輪重試；watcher Panel 可見錯誤 |
| 同物件重複觸發（重啟重掃） | idempotency key 確定性 → 既有去重回 idempotent_replay，不重複建 job |
| key 層級不符規約 | skip + `skipped_malformed` 計數 |
| presigned URL 過期才被下載 | 既有 intake 下載失敗路徑（download_failure 欄位），watcher 不重送（下輪 etag 未變不再觸發；操作者可從 `#/conv` 看到失敗 job） |
| watcher 未啟用 | 一切如現狀；status API 回 enabled=false |

## 6. 測試與驗收

1. **coordinator 單元/整合測試**（vitest，supertest + 本機 fake S3 stub）：
   - fake S3 stub：http server 回 ListObjectsV2 XML（可程式化增刪物件）。
   - 首輪 baseline 不觸發（seen=N、triggered=0）。
   - 第二輪新增物件 → 觸發一筆 intake（斷言實送 payload：project_id/external_model_version_id 導出正確、idempotency key 形狀、presigned URL 含簽章參數）→ job 進 store。
   - 同物件第三輪不再觸發；模擬重啟（新 watcher 實例、同 store）→ baseline 後新增同 key 同 etag → intake 回 idempotent_replay 不建新 job。
   - 層級不符 key → skipped_malformed。
   - status endpoint 形狀。
2. **前端 vitest**：watcher Panel enabled=false 誠實文案；enabled=true 計數 render。
3. **Browser E2E（Playwright）**：隔離 stack（coordinator + fake S3 stub + stub conversion，`MINIO_WATCH_ENABLED=true`、interval 調短）→ stub 注入新物件 → **不碰任何按鈕** → `#/conv` 列表出現該 job（dispatched/queued 級）+ watcher Panel triggered ≥1；截圖 + summary 落 `artifacts/e2e/minio-watch-auto-intake-*` 與 tracked `docs/evidence/minio-watch-auto-intake/`。檔頭 skip 限制揭露比照先例。
4. **部署區驗證（P7）**：對真 MinIO（192.168.20.234:9000，唯讀 credentials 由使用者提供入 env）開 watch 觀察 baseline 正常、status Panel 真資料；真新檔觸發驗證視使用者丟檔配合，否則如實標 not observed。
5. **驗收基準**：全綠 + 四項回報；watcher 預設關 → 既有部署/E2E 零回歸。

## 7. 風險與緩解

- **新 production dependency（@aws-sdk/client-s3）**：理由如 §4.1；鎖唯讀兩 API 面，PR body 揭露。
- **in-memory seen 的記憶體上限**：bucket 867 objects 量級無虞；不做持久化（idempotency 鏈已保證重啟正確性）。
- **presigned URL 含簽章（敏感）**：不寫入 watcher status/log（last_triggered 只記 key 不記 URL）。
- **與外部 IFC worker 並存**：同物件若 worker 也 POST（不同 idempotency key）會建第二筆 job — 屬部署拓樸決策（要嘛 worker 退役要嘛 watcher 不開），spec 揭露不在 code 層擋。
- **credentials 安全**：env only；`.env.example` 加空欄位；deny 規則禁讀 .env 實值（agent 不碰）。
