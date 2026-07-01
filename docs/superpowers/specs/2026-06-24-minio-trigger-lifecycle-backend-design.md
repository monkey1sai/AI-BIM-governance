# A1 後端地基 — MinIO 手動觸發 + 轉檔 lifecycle 可觀測性 + P0 遮蔽 設計文件

> 版本：2026-06-24 · userFacing：false（純 coordinator 後端 API；無 UI）
> 範圍來源：`2026-06-24-ifc-ready-api-field-redesign-design`（PR #257，完整欄位重設計）之 **A1 排序 B 地基子集**
> 相依 plan（參考實作）：`docs/superpowers/plans/2026-06-24-minio-trigger-lifecycle-backend.md`
> 對象程式碼：`bim-review-coordinator/src/`（`app.ts`、`services/externalIfcReadyStore.ts`、`services/minioClient.ts`、`services/minioWatcher.ts`、`services/conversionLedger.ts`、`types.ts`）

---

## 1. 目標與範圍

實作 A1 重構（排序 B）所需的後端地基，使 A1「排入 IFC→USD 轉檔排程」按鈕與誠實狀態顯示有後端可接，並修掉一個現役資安違規。**全部 additive**：既有 `IfcReadyIntakeJob` 28 欄與 `summarizeIfcReadyJob` 26 欄輸出零回退。

**In scope（四項）**：
- R1（P0 資安）：遮蔽對外 ifc-ready response 的 presigned 簽章。
- R2（可觀測）：新增單一權威 `conversion_lifecycle_status`。
- R3（溯源／OQ1）：`project_display_name`/`category` 落 store 並對外曝光。
- R4（觸發）：新增 `POST /api/conversion/trigger {key}` 手動觸發端點。

**Out of scope（明確不做）**：
- 完整欄位重設計的其餘欄位（各階段時戳、`usdc_role`、`usdc_key`、`coverage_report`、`is_baseline`、`data_volatility`、`watcher_liveness`、`failure_reason`/`failure_stage`、`source_object_key`/`source_bucket`/`key_segments`、`idempotency_key`/`idempotent_replay` 曝光）—— 留待後續增量。
- A1 前端（屬 `2026-06-24-a1-governance-3d-minio-redesign-design`，排序 B 之 B2）。
- callback outbox（`app.ts:1575`）的 presigned 處置 —— 須先確認雲端 consumer 契約，本 spec 不動（見 §6 開放問題）。
- MinIO watcher 自動偵測語意（零變更，AC7）。

---

## 2. R1：presigned 簽章遮蔽（P0 資安）

**現況違規**：`summarizeIfcReadyJob`（`app.ts:2357`）與 local-web-view session response（`app.ts:1848`）對外原樣回傳含 `X-Amz-Signature` 的 1 小時 presigned URL，洩漏短效憑證（違誠實鐵律與 coordinator 邊界）。

**需求**：
- 新增純函式 `maskPresignedRef(ref)`：若 ref 是含 `X-Amz-*` query 的 URL，剝除 query 只留 `origin+pathname`；非 URL 或無簽章參數者原樣返回。
- 套用於 `app.ts:2357`（list response）與 `app.ts:1848`（session response）兩個**瀏覽器可見**出口。
- `app.ts:1309` 僅 `Boolean(ref)`，不洩漏，不動。

**驗收**：
- `maskPresignedRef` 單元測試涵蓋：presigned URL 剝簽章、loopback URL 原樣、非 URL 原樣、空字串原樣。
- 誠實守衛整合測試：`GET /api/external/ifc-ready` response body JSON 不含 `X-Amz-Signature`。

---

## 3. R2：`conversion_lifecycle_status` 單一權威狀態

**需求**：
- 新增純函式 `deriveLifecycleStatus(job): ConversionLedgerStatus`，**重用既有 `ConversionLedgerStatus` 型別**（`detected|queued|converting|ready|failed`），禁另宣告同名 enum。
- 凍結映射（由上至下短路）：
  1. `status` ∈ {failed, dispatch_failed, dropped_on_restart} 或 `download_status==="failed"` → `failed`
  2. `conversion_status==="ready"` → `ready`
  3. `status==="dispatched"` → `converting`
  4. `status==="queued_for_conversion"` → `queued`
  5. 其餘 → `detected`
- `summarizeIfcReadyJob` additive 加 `conversion_lifecycle_status: deriveLifecycleStatus(job)`。

**驗收**：
- 映射表單元測試逐條覆蓋五個分支（含 `download_status=failed` 壓過 `accepted`）。
- 整合：既有 26 欄輸出逐字保留，新欄並存（既有測試不破）。
- 誠實：converter 落地前不會出現 `ready`（映射只在 `conversion_status==="ready"` 才回 ready）。

---

## 4. R3：`project_display_name`/`category` 落 store + 曝光（OQ1）

**背景**：`ExternalIfcReadyEvent` 帶 `project_display_name`/`model_category`，但 `externalIfcReadyStore.create()` 未存入 job → 對外只剩 `mv_<hash8>` 代號，溯源斷鏈。**OQ1 已裁決：放寬 key-structure R5，直接落 store。**

**需求**：
- `IfcReadyIntakeJob` 加 `project_display_name?: string | null`、`category?: string | null`（additive nullable）。
- `externalIfcReadyStore.create()` 擷取 `event.project_display_name` 與 `event.model_category`（對外命名統一 `category`）入 job。
- `summarizeIfcReadyJob` additive 曝光兩欄。

**驗收**：
- 整合測試：intake 帶 `project_display_name="許良宇圖書館"`+`model_category="main"` → `GET /api/external/ifc-ready` 列表項可見 `project_display_name`/`category`。
- 非 MinIO 來源（無此二欄）→ 誠實 `null`，不塞假值。

---

## 5. R4：`POST /api/conversion/trigger {key}` 手動觸發端點

**需求**：
- 前端只送 MinIO object `key`；coordinator server-side：
  1. `rejectIfIpNotAllowed` 守門（比照既有 `/api/conversion/*` 控制路由）。
  2. MinIO 未設定（`minioWatchEndpoint`/`Bucket` 缺）→ `503` 誠實回報。
  3. 缺 `key` → `400`；`deriveIntakeFromKey`（≥3 段、拒空段/`.`/`..`）不合法 → `400`。
  4. server-side presign（`presignMinioObject`，簽章不外洩瀏覽器）。
  5. 重用 watcher `idempotencyKeyFor`/`correlationIdFor` 派生鍵，self-POST loopback `/api/external/ifc-ready`（帶 webhook secret）。
  6. 冪等：同 key 重觸發回既有 job。
- = folderview spec `R-TRIGGER-ENDPOINT`，A1「排入轉檔排程」按鈕的後端。

**驗收**：
- 測試（presign 以 `vi.mock` 假打，不依賴真 MinIO）：malformed key → `400`；缺 key → `400`；合法 key → `200/202` + `ifc_ready_job_id`，且 response 不含 `X-Amz-Signature`。

---

## 6. 誠實 / 邊界 / 開放問題

- presigned 簽章 / secret 絕不入對外 response 與 log；`POST /api/conversion/trigger` 前端只送 key，presign 與 secret 一律 server-side。
- 轉檔未完成禁出現 `ready`；缺值用明確 `null`，不塞假字串。
- coordinator 邊界不變：只暴露讀視圖 / intake，不升格 metadata 權威。
- **OQ-IMPL-1（callback outbox ref，app.ts:1575）**：callback payload 的 `source_ifc.ref` 是否需保留 presigned 供雲端下游下載？需先確認雲端 consumer 契約，本 spec 不盲遮。
- **OQ-IMPL-2（idempotencyKeyFor 第三參數）**：手動觸發無 etag，用 `key` 當第三參數；若日後要「同 key 不同版本重觸發」須改帶真 etag（需先 HEAD object）。Phase 1 不做。

---

## 7. 驗證入口

於 `bim-review-coordinator/`：`npm run verify`（= `tsc -p tsconfig.json` + `vitest run`）。
