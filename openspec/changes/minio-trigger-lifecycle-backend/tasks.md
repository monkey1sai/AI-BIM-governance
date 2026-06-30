# Tasks — minio-trigger-lifecycle-backend

對應 spec `docs/superpowers/specs/2026-06-24-minio-trigger-lifecycle-backend-design.md` + plan `docs/superpowers/plans/2026-06-24-minio-trigger-lifecycle-backend.md`（spec-to-done 自主驅動；指揮官手動修 task#0/#3 quality finding）。

- [x] 0. P0 presigned 遮蔽：`maskPresignedRef` 純函式 + `sanitizeJobForExternal` helper，套 GET list/:jobId/shadow + POST intake 200/202 + local-web-view session 共 6 出口；補誠實守衛測試。指揮官修補 POST intake spread-leak 盲點（commit d9133d4）。
- [x] 1. `conversion_lifecycle_status`：`deriveLifecycleStatus` 純函式（凍結映射、重用 `ConversionLedgerStatus`）+ summarize additive 曝光 + 映射表單元測試 + 列表端點整合斷言。
- [x] 2. OQ1：`IfcReadyIntakeJob` 加 `project_display_name`/`category`、`ExternalIfcReadyStore.create` 擷取 event 兩欄、summarize 曝光；補 OQ1 誠實 null 與 worker-compat fallback 回歸守衛。
- [x] 3. `POST /api/conversion/trigger`：`presignMinioObject` + 端點（守門/503/400 key 驗證/`|`/長度上限/presign/self-POST + AbortSignal.timeout/冪等）+ 測試。指揮官補 fetch timeout + key 長度上限（commit 26d4a8c）。
- [x] 4. P5 對抗複驗 critic 文件修正：`sanitizeJobForExternal` @security docstring 收斂為「瀏覽器可見/對外出口」+ internal-token carve-out；`types.ts` ExternalIfcReadyEvent 註解更新（OQ1 已落 store）。
- [ ] 5. follow-up（不在本 change）：完整 ifc-ready 欄位重設計其餘欄位（PR #257）、A1 前端 B2、internal-token 路徑 presigned defense-in-depth（須先確認下游契約）。
