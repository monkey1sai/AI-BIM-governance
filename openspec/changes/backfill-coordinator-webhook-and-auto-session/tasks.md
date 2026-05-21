# Tasks

> **預設 verification rule**：所有 code task 必須先寫對應 RED test 再實作（TDD）。tests/contracts/ + bim-review-coordinator/tests/ 覆蓋 11 個 spec scenarios（intake 4 + auto-session 4 + webhook seam 3）。

## 0. Worktree & Impact Pre-flight

- [ ] 0.1 開新 worktree `.worktrees/backfill-coordinator-webhook-and-auto-session/`（branch `codex/openspec/backfill-coordinator-webhook-and-auto-session`），不可在 main 上直接實作。
- [ ] 0.2 對 affected symbols 跑 GitNexus impact analysis（`ingestConversionReport`、`SessionStore.create`、`allocateKitInstanceBindings`、`chooseReadyUsdc`、`/api/external/ifc-ready` route handler、`ExternalIfcReadyStore`、`/api/internal/conversion-result`、`/api/internal/conversions/:id/ingest`、`/api/review-sessions`）；HIGH/CRITICAL 先回報再改。GitNexus CLI 在 worktree 有 quoting bug（memory `opsx-skill-placeholder-bug`），用 `git diff --stat` + manual symbol read 為 fallback。
- [ ] 0.3 對 `bim-review-coordinator/src/app.ts:566-628` 與 `bim-review-coordinator/src/services/{externalIfcReadyStore,sessionStore?,kitPool}.ts` 做 baseline 讀取，記錄當前 signature；確認 archive design D7（reuse existing session-create logic）仍可行。

## 1. Intake: Worker Compatibility Payload Normalization

- [ ] 1.1 抽出 `normalizeIntakePayload(rawBody): ExternalIfcReadyEvent` helper（D9），覆蓋 canonical payload pass-through 與 worker compatibility mapping：`status→event`、`ifc_path→source_ifc.ref`、`version→external_model_version_id`、`task_id→external_conversion_task_id`、`task_id→fallback correlation_id/idempotency_key`、`project_id→project_id`、`tenant_id` 缺時 intranet-dev fallback。
- [ ] 1.2 加入 helper unit tests（`bim-review-coordinator/tests/external-ifc-ready.test.ts` 或新增 `intake-normalization.test.ts`）：
      - valid worker payload → canonical event
      - canonical payload 不被改動
      - non-ready `status` → reject 4xx
      - missing `ifc_path` / `project_id` / `version` / `task_id` → reject 4xx，不寫 partial shadow metadata
      - worker payload accepted 後 dispatch 給 streaming 仍走 internal conversion shape，不洩漏 worker 形狀
- [ ] 1.3 在 `/api/external/ifc-ready` route handler 接 `normalizeIntakePayload` 之後再走既有 `ExternalIfcReadyStore.recordIntake`；service auth / explicit `X-Correlation-Id` / `X-Idempotency-Key` header 處理順序維持不變，header 優先於 task_id fallback。
- [ ] 1.4 補 `tests/contracts/ifc_ready_payload.json` compatibility example，保留 canonical contract，新增 worker compatibility payload example 與 mapping 說明。
- [ ] 1.5 更新 `tests/fakes/external_ifc_worker_client.py`，讓 test-only worker double 可產生 worker compatibility payload 與 canonical payload；contract test 雙 path 都跑。
- [ ] 1.6 若 auth fallback 需改 `IntranetDevAuthProvider`，同步更新 `bim-review-coordinator/tests/auth-provider.test.ts`。

## 2. Auto-session: Conversion-ready → Local Session Handoff

- [ ] 2.1 抽出 `autoCreateOrActivateSession(correlationId, externalModelVersionId, conversionJobId, artifacts)` helper（D10），內部呼叫 `chooseReadyUsdc` + `allocateKitInstanceBindings` + `SessionStore.create`；對同一 `correlation_id || external_model_version_id` idempotent（D11），重入回既有 session。
- [ ] 2.2 在 `ingestConversionReport`（`bim-review-coordinator/src/app.ts:566-628`）的 `normalizedStatus === "ready"` 分支，於 `callbackOutbox.enqueue` 之後**並行**呼叫 `autoCreateOrActivateSession`；任一失敗不阻塞他者（outbox enqueue / session create 狀態獨立分類）。
- [ ] 2.3 確認 `normalizedStatus === "failed"` 分支不呼叫 `autoCreateOrActivateSession`；補測試斷言。
- [ ] 2.4 確認 `autoCreateOrActivateSession` 在 GPU/Kit 無容量時走 `queued_for_instance` 路徑（既有 `kitPool` 語意），不丟 review intent；不啟動 Kit 進程、不開 USD stage、不渲染。
- [ ] 2.5 確認 `POST /api/review-sessions` route handler 仍走原本路徑、不被自動接線改動；explicit caller 與 auto-creation 共存。

## 3. Auto-session Tests

- [ ] 3.1 新增測試（`bim-review-coordinator/tests/host-native-conversion-ingest.test.ts` 或等效）：terminal `ready` ingestion 自動建立綁 USDC + Kit binding 的 session（spec scenario「Conversion-ready ingestion auto-creates a review session under retired `_bim-control`」）。
- [ ] 3.2 測 idempotency：同 `correlation_id` / `external_model_version_id` 重複 ready 回既有 session，不建重複 active session（spec scenario「Duplicate conversion-ready does not create duplicate sessions」）；與 explicit `POST /api/review-sessions` caller 共存不互相覆蓋。
- [ ] 3.3 測 non-ready / failed：不建可串流 session、不宣稱 model ready（spec scenarios「Non-ready conversion does not create a streamable session」「Failed conversion creates no local session」）。
- [ ] 3.4 測 callback outbox 與 session 接線狀態獨立分類：pending / dead-letter callback 不阻塞 session handoff（spec scenario「Pending cloud callback does not block local session handoff」）；session handoff 成功不被誤標為 callback success。
- [ ] 3.5 測 control-plane 邊界：auto-creation 不啟動 Kit 進程、不開 USD stage、不渲染（spec scenario「Coordinator-triggered creation stays control-plane only」）；以既有 fake / contract 斷言。
- [ ] 3.6 測 lifecycle audit event 仍與 explicit caller 路徑等價（Risk mitigation）：reuse 既有 `session-lifecycle.test.ts` pattern。

## 4. Verification

- [ ] 4.1 跑 `cd bim-review-coordinator && npm test -- external-ifc-ready.test.ts auth-provider.test.ts host-native-conversion-ingest.test.ts`（或等效範圍）綠。
- [ ] 4.2 跑 `cd bim-review-coordinator && npm run verify`（= `tsc + vitest 全套`）綠。
- [ ] 4.3 跑 `python -m pytest tests -p no:cacheprovider` 為 root contract baseline check，維持綠。
- [ ] 4.4 跑 `git diff --check` 無 whitespace 錯誤。
- [x] 4.5 跑 `npx openspec validate backfill-coordinator-webhook-and-auto-session --strict` 綠 — **propose 階段已驗證**：Option A 不可行（OpenSpec strict 要求每個 change 帶 spec delta + Scenario）；改採 Option B，為三份 capability 寫 MODIFIED delta，每個既有 requirement 加 implementation status note，scenarios 保留不變。Validate 結果 `Change 'backfill-coordinator-webhook-and-auto-session' is valid`。Apply 階段仍需重跑 validate 確認落 implementation 後一致。
- [ ] 4.6 跑 GitNexus `detect_changes`（CLI quoting bug 時 fallback `git diff --stat` + manual symbol read），確認 affected symbols/flows 符合 §0.2 預期。
- [ ] 4.7 Render tier 維持 `not_observed`：不跑 Kit/WebRTC/browser visual evidence，verification doc 明寫此 tier 不在本 change pass 範圍。

## 5. Evidence & Roadmap

- [ ] 5.1 新增 `docs/verification/2026-05-2X-backfill-coordinator-webhook-and-auto-session.md`，記錄 §4 evidence + 11 spec scenarios 對應 test 編號 + render tier `not_observed` rationale。
- [ ] 5.2 在 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 加一段 2026-05-2X 更新：archive `2026-05-21-coordinator-ifc-ready-worker-webhook` documentation lag 已透過本 change 補齊，spec drift 收斂；HTML 鏡像同步更新（`scripts/render-roadmap-html.py`）。
- [ ] 5.3 編輯 archive `2026-05-21-coordinator-ifc-ready-worker-webhook/tasks.md`，把 26 個 `[ ] — deferred` 升級為 `[x] — implemented by backfill-coordinator-webhook-and-auto-session (PR #NN)`；不刪 retro-audited annotation。

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
