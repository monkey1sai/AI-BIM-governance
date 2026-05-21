# Tasks

> **預設 verification rule**：所有 code task 必須先寫對應 RED test 再實作（TDD）。tests/contracts/ + bim-review-coordinator/tests/ 覆蓋 11 個 spec scenarios（intake 4 + auto-session 4 + webhook seam 3）。

## 0. Worktree & Impact Pre-flight

- [x] 0.1 開新 worktree `.worktrees/backfill-coordinator-webhook-and-auto-session/`（branch `codex/openspec/backfill-coordinator-webhook-and-auto-session`），不可在 main 上直接實作 — 已建於 propose PR branch base。
- [x] 0.2 對 affected symbols 跑 GitNexus impact analysis — GitNexus CLI 在 worktree 有 quoting bug（memory `opsx-skill-placeholder-bug` / `opsx-worktree-closeout-gotchas`），fallback 用 manual symbol read（grep + Read）。所有 affected symbols 均為 LOW risk（內部 helper / store / route handler）。
- [x] 0.3 對 `bim-review-coordinator/src/app.ts`（intake route + `ingestConversionReport`，舊行號 566-628）與 `bim-review-coordinator/src/services/{externalIfcReadyStore,sessionStore,kitPool}.ts` 做 baseline 讀取 — archive design D7（reuse existing session-create logic）確認可行：`SessionStore.create` / `allocateKitInstanceBindings` / `chooseReadyUsdc` signature 與 archive design 撰寫時一致。

## 1. Intake: Worker Compatibility Payload Normalization

- [x] 1.1 抽出 `normalizeIntakePayload(rawBody): NormalizeResult` helper（D9）於 `bim-review-coordinator/src/app.ts`，覆蓋 canonical payload pass-through 與 worker compatibility mapping：`status→event`、`ifc_path→source_ifc.ref`、`version→external_model_version_id`、`task_id→external_conversion_task_id`、`task_id→fallback correlation_id/idempotency_key`（採 `worker:project_id::version::task_id` 派生形式）、`project_id→project_id`、`tenant_id` 缺時 `tenant_demo_001` development fallback、`source_ifc.etag` 缺時 `worker:unknown:<task_id>` fallback marker（**不**宣告為真實 checksum）。
- [x] 1.2 加入 helper unit tests 於 `bim-review-coordinator/tests/external-ifc-ready.test.ts`（新 describe block `POST /api/external/ifc-ready (worker compatibility payload)`，共 7 個 cases）— RED → GREEN。
- [x] 1.3 在 `/api/external/ifc-ready` route handler 接 `normalizeIntakePayload` 之後再走既有 `ExternalIfcReadyStore.recordIntake`；service auth / explicit headers 仍優先（D11），worker compat 缺 header 時注入 derived 值到 headerMap 再呼叫 `authProvider.authenticate`。
- [x] 1.4 補 `tests/contracts/ifc_ready_payload.json` `worker_compatibility_example`（payload + field_mapping），保留 canonical example。
- [x] 1.5 更新 `tests/fakes/external_ifc_worker_client.py` 加 `build_worker_compatibility_payload(**overrides)`；root pytest 7 passed。
- [x] 1.6 若 auth fallback 需改 `IntranetDevAuthProvider`，同步更新 `bim-review-coordinator/tests/auth-provider.test.ts` — **N/A**：worker compat 不改 auth provider 行為（只在 route handler 派生 header fallback；provider 仍要求 secret + correlation/idempotency header）；既有 auth-provider.test.ts 全綠 (3 tests)。

## 2. Auto-session: Conversion-ready → Local Session Handoff

- [x] 2.1 抽出 `autoCreateOrActivateSession(job, artifacts, conversionJobId)` helper（D10）於 `bim-review-coordinator/src/app.ts` createCoordinatorApp closure 內，內部呼叫 `chooseReadyUsdc` 邏輯（從 `artifacts.usdc_ref` 直建 ArtifactBinding）+ `allocateKitInstanceBindings` + `SessionStore.create`；對 `job.review_session_id` idempotent（D11），重入回既有 session。新增 `IfcReadyIntakeJob.review_session_id` optional 欄位 + `ExternalIfcReadyStore.recordReviewSession()` 反向綁定 method。
- [x] 2.2 在 `ingestConversionReport` 的 `normalizedStatus === "ready"` 分支，於 `callbackOutbox.enqueue` + `recordConversionOutcome` 之後**並行**呼叫 `autoCreateOrActivateSession`；任一失敗不阻塞他者（outbox enqueue / session create 狀態獨立分類）；`ConversionIngestOutcome` type 加 `session` / `session_replay` / `session_reason` 欄位。
- [x] 2.3 確認 `normalizedStatus === "failed"` 分支不呼叫 `autoCreateOrActivateSession`（程式碼以 `if (normalizedStatus === "ready")` 包覆 auto-session call）；test 斷言 failed 路徑 `res.body.session` 為 `null`。
- [x] 2.4 確認 `autoCreateOrActivateSession` 在 GPU/Kit 無容量時回 `{ session: null, reason: "queued_for_instance" }`，不丟 review intent；不啟動 Kit 進程、不開 USD stage、不渲染（test「auto-creation 不啟動 Kit 進程、不開 USD stage、不渲染」斷言 metadata-only schema）。
- [x] 2.5 確認 `POST /api/review-sessions` route handler 仍走原本路徑、不被自動接線改動 — `autoCreateOrActivateSession` helper 為新增、`/api/review-sessions` 既有 route handler 一行未動；既有 sessions.test.ts 全綠 (37 tests)。

## 3. Auto-session Tests

- [x] 3.1 新增測試於 `bim-review-coordinator/tests/host-native-conversion-ingest.test.ts` 新 describe block `conversion-ready auto-session handoff`：「ready ingestion 自動建立綁 USDC + Kit binding 的 session」— GREEN。
- [x] 3.2 測 idempotency：「duplicate ready ingestion 不建重複 active session」— 同 `job.review_session_id` 回既有 session，`session_replay=true`；GREEN。
- [x] 3.3 測 non-ready / failed：「failed ingestion 不建可串流 session」`res.body.session === null`，callback outbox 仍記 `conversion_failed`；GREEN。
- [x] 3.4 測 callback outbox 與 session 接線狀態獨立分類：「pending cloud callback 不阻塞 local session handoff」session 仍 `active`，callback `status="pending"`，`callback.payload.session_id` 為 undefined（兩者狀態不互相洩漏）；GREEN。
- [x] 3.5 測 control-plane 邊界：「auto-creation 不啟動 Kit 進程、不開 USD stage、不渲染」斷言 session.kit_instance 與 kit_instance_bindings 無 `process_id` / `render_started_at` / `usd_stage_opened_at` 等 runtime 欄位；GREEN。
- [x] 3.6 測 lifecycle audit event 仍與 explicit caller 路徑等價：「lifecycle audit event 仍與 explicit /api/review-sessions caller 路徑等價」斷言 `GET /api/review-sessions/{id}/lifecycle-events` 包含 `sessionCreated` + `sessionActive` event types；GREEN。

## 4. Verification

- [x] 4.1 跑 `cd bim-review-coordinator && npm test -- external-ifc-ready.test.ts auth-provider.test.ts host-native-conversion-ingest.test.ts`（或等效範圍）綠 — 16 + 10 + 3 passed。
- [x] 4.2 跑 `cd bim-review-coordinator && npm run verify`（= `tsc + vitest 全套`）綠 — **11 files / 165 tests passed**；tsc clean。
- [x] 4.3 跑 `python -m pytest tests -p no:cacheprovider` 為 root contract baseline check，維持綠 — **7 passed**。
- [x] 4.4 跑 `git diff --check` 無 whitespace 錯誤 — clean。
- [x] 4.5 跑 `npx openspec validate backfill-coordinator-webhook-and-auto-session --strict` 綠 — **propose 階段已驗證**：Option A 不可行（OpenSpec strict 要求每個 change 帶 spec delta + Scenario）；改採 Option B，為三份 capability 寫 MODIFIED delta，每個既有 requirement 加 implementation status note，scenarios 保留不變。Validate 結果 `Change 'backfill-coordinator-webhook-and-auto-session' is valid`。Apply 階段仍需重跑 validate 確認落 implementation 後一致。
- [x] 4.6 跑 GitNexus `detect_changes`（CLI quoting bug 時 fallback `git diff --stat` + manual symbol read），確認 affected symbols/flows 符合 §0.2 預期 — fallback `git diff --stat` 顯示 7 files / +551 / -4；affected symbols（`ingestConversionReport` / `SessionStore.create` / `allocateKitInstanceBindings` / `chooseReadyUsdc` / `/api/external/ifc-ready` route / `ExternalIfcReadyStore` / `IfcReadyIntakeJob`）皆符合 §0.2 預期，無範圍擴張。
- [x] 4.7 Render tier 維持 `not_observed`：不跑 Kit/WebRTC/browser visual evidence，verification doc §4 明寫此 tier 不在本 change pass 範圍。

## 5. Evidence & Roadmap

- [x] 5.1 新增 `docs/verification/2026-05-21-backfill-coordinator-webhook-and-auto-session.md`，記錄 §4 evidence + 11 spec scenarios 對應 test 編號 + render tier `not_observed` rationale。
- [x] 5.2 在 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 加一段 2026-05-21 更新：archive `2026-05-21-coordinator-ifc-ready-worker-webhook` documentation lag 已透過本 change 補齊，spec drift 收斂；HTML 鏡像同步更新（`scripts/render-roadmap-html.py` 重生 207,470 bytes）。
- [x] 5.3 編輯 archive `2026-05-21-coordinator-ifc-ready-worker-webhook/tasks.md`，把 26 個 `[ ] — deferred` 升級為 `[x] — implemented by backfill-coordinator-webhook-and-auto-session (PR #85)`；不刪 retro-audited annotation — PR #83 merge 後（commit `e8e576d` 已在 main），本 branch rebase onto main 後一次性升級全部 26 個 deferred 標記為 `[x] — implemented by PR #85 (was: deferred: ...)`，原 retro-audit annotation 完整保留。

## 6. Commit & PR

- [ ] 6.1 Conventional Commits 訊息：`feat(coordinator): backfill worker compatibility intake + conversion-ready auto-session（spec drift 收斂）`。
- [ ] 6.2 push branch `codex/openspec/backfill-coordinator-webhook-and-auto-session`，開 implementation PR；PR body 標註：
      - predecessor archive: `2026-05-21-coordinator-ifc-ready-worker-webhook`（documentation lag）
      - 11 spec scenarios 對應 test
      - render tier 維持 `not_observed`，不升等
      - 不新增 production dependency
- [ ] 6.3 等使用者明確同意才 `gh pr merge`（Phase E review gate）。

## 7. Archive（Phase F，使用者觸發）

- [ ] 7.1 由使用者執行 `/archive-and-closeout backfill-coordinator-webhook-and-auto-session`；archive PR 同步 §5 證據與 archive `2026-05-21-coordinator-ifc-ready-worker-webhook` 的 tasks.md 收尾。
