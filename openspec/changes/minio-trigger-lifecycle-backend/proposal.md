## Why

A1 重構（排序 B）需要的後端地基缺三塊、外加一個現役資安違規：(1) `summarizeIfcReadyJob` 與 local-web-view session response 對外原樣吐含 `X-Amz-Signature` 的 1 小時 presigned URL（洩漏短效憑證，違誠實鐵律）；(2) 轉檔狀態分裂三套（intake `status` / 自由字串 `conversion_status` / ledger status），#conv/#minio/job 三視圖無單一權威可對齊；(3) MinIO 中文專案原名與種類在 `ExternalIfcReadyEvent` 帶入卻不落 store，對外只剩 `mv_<hash8>` 代號（溯源斷鏈）；(4) MinIO→佇列只有 watcher 自動偵測一條，operator 無法手動把指定物件排進轉檔（A1「排入 IFC→USD 轉檔排程」按鈕無後端可接）。

對應 spec `docs/superpowers/specs/2026-06-24-minio-trigger-lifecycle-backend-design.md`、plan `docs/superpowers/plans/2026-06-24-minio-trigger-lifecycle-backend.md`（從完整 ifc-ready 欄位重設計 PR #257 切出 A1 地基子集）。

## What Changes

- **P0 presigned 遮蔽**：新增 `maskPresignedRef` 純函式（剝 `X-Amz-*` 簽章 query）+ `sanitizeJobForExternal` helper，套用於所有「瀏覽器可見/對外」spread 整個 job 的出口：GET list/:jobId/shadow、POST `/api/external/ifc-ready` 200 idempotent replay/202 進件、POST local-web-view session。補誠實守衛測試（GET/POST 回應不含 `X-Amz-Signature`）。internal-token callback/ingest 路徑刻意範圍外（pre-existing，下游可能需 presigned）。
- **conversion_lifecycle_status**：新增 `deriveLifecycleStatus(job)` 純函式（凍結映射、重用既有 `ConversionLedgerStatus` 型別，禁另宣告），`summarizeIfcReadyJob` additive 曝光。converter 落地前不會出現 `ready`（誠實）。
- **project_display_name/category 落 store（OQ1）**：`IfcReadyIntakeJob` 加兩 additive nullable 欄、`ExternalIfcReadyStore.create()` 擷取 event 兩欄、`summarizeIfcReadyJob` 對外曝光（命名統一 `category`）。放寬 key-structure R5 對此二欄的「不落 store」限制（維護者裁決）。
- **POST /api/conversion/trigger**：新增手動觸發端點（前端只送 MinIO object `key`，coordinator server-side `deriveIntakeFromKey` 驗證 + `presignMinioObject` server-side presign + 重用 watcher `idempotencyKeyFor`/`correlationIdFor` self-POST `/api/external/ifc-ready`）。守門比照 `/api/conversion/*`（`rejectIfIpNotAllowed`）、MinIO 未設定 503、key 缺/含`|`/超 1024 bytes/段數不符皆 400、self-POST 帶 `AbortSignal.timeout`、冪等同 key 回既有 job、回應不夾帶 presigned。

## Impact

- Affected code: `bim-review-coordinator`（additive；既有 26 欄 `summarizeIfcReadyJob` 輸出與 28 欄 `IfcReadyIntakeJob` 零回退；`npm run verify` 478 tests 綠）。新增 `presignedRef.ts`/`lifecycleStatus.ts`，`minioClient.ts` 加 `presignMinioObject`。
- 非目標（各自獨立增量）：完整 ifc-ready 欄位重設計其餘欄位（時戳/usdc_role/coverage/baseline/watcher_liveness…，見 PR #257 spec）；A1 前端（B2）；internal-token 路徑 presigned 處置（須先確認下游契約）。
- userFacing: false（純 coordinator 後端 API；無 UI）。P4 browser evidence 不適用。
- 流程誠實揭露：P3 自動 quality 迴圈在 task#0（POST intake spread-leak P0）與 task#3（fetch timeout + key 長度上限）各 2 輪未閉合，由指揮官手動修 + `npm run verify` 478 tests 綠；P5 對抗複驗 `overall_safe=true`、`not_closed=[]`/`new_issues=[]`，critic 三項 advisory（internal-path docstring 過述 + types 過時註解已修；trigger etag=key 已誠實註解）。GitNexus index stale 但 detect_changes 讀 live git diff（risk low）。
