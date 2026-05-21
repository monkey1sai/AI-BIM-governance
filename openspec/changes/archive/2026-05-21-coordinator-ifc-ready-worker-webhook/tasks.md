# Tasks

> **Retro-audited 2026-05-21**：archive commit 1103a6b 自述 documentation lag（PR #74 為 proposal-only，implementation 從未落地）。經 grep `bim-review-coordinator/src/app.ts` 與 `openspec/specs/` 驗證後確認：
>
> - **Newer-wins authority**：`openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md`「Coordinator accepts worker ifc-ready compatibility payload」+ `openspec/specs/review-session-request-lifecycle/spec.md`「Conversion-ready ingestion auto-creates a review session」+ `openspec/specs/conversion-webhook-lifecycle/spec.md`「Terminal conversion-ready ingestion triggers local review session handoff」**已是 source of truth**。
> - **Code drift**：當前 `bim-review-coordinator/src/app.ts` 的 `ingestConversionReport`（line 566-628）只走 callback outbox，**未自動建 review session**；intake schema 也**未支援** worker compatibility payload（`status="ifc_ready"` / `ifc_path` / `project_id` + `version` + `task_id`）。
> - **依 CLAUDE.md §2 newer-wins**：以下任務不能 retro-tick `[x]`（code 沒做）；保留 `[ ]` 並標 `— deferred: spec authority exists, implementation follow-up required`。後續若要落地，需新開 change 而非編輯本 archive。
>
> **2026-05-21 closeout（spec drift 收斂）**：上述 deferred 狀態於 [PR #85 `backfill-coordinator-webhook-and-auto-session`](https://github.com/monkey1sai/AI-BIM-governance/pull/85) 落地。所有 26 個 deferred 任務升級為 `[x] — implemented by PR #85`，原 retro-audit annotation 保留作為 documentation lag 證據。Evidence：`docs/verification/2026-05-21-backfill-coordinator-webhook-and-auto-session.md`；coordinator `npm run verify` 165 tests passed；root pytest 7 passed；`openspec validate --strict` valid。Render tier (`single_kit_render` / WebRTC 49100 / browser visual) 維持 `not_observed`（不升等，與 archive Decision 一致）。

## 1. Coordinator Intake Compatibility

- [x] 1.1 在 `bim-review-coordinator/src/app.ts` 或鄰近 helper 中加入 worker payload normalization，支援 `status="ifc_ready"`、`ifc_path`、`project_id`、`version`、`task_id`。 — **implemented** by PR #85 (was: **deferred**: spec authority `local-coordinator-ifc-ready-intake-boundary/spec.md:75-86`，code 未實作)
- [x] 1.2 保留既有 canonical `event="ifc_ready"` payload 支援，並讓兩種輸入在進入 `ExternalIfcReadyStore` 前收斂為同一個 canonical `ExternalIfcReadyEvent`。 — **implemented** by PR #85 (was: **deferred**: 同 1.1)
- [x] 1.3 讓 worker payload 缺少 explicit `X-Correlation-Id` / `X-Idempotency-Key` 時，從 `project_id`、`version`、`task_id` 派生穩定 correlation / idempotency values；explicit headers 仍優先。 — **implemented** by PR #85 (was: **deferred**: spec `local-coordinator-ifc-ready-intake-boundary/spec.md:49-50`，code 未實作)
- [x] 1.4 處理缺少 `source_ifc.etag` 的 worker payload，不把 fallback etag 誤宣告為真實 checksum。 — **implemented** by PR #85 (was: **deferred**: 依賴 1.1)
- [x] 1.5 確保 rejected worker payload 不建立 local job，也不 dispatch 到 `bim-streaming-server`。 — **implemented** by PR #85 (was: **deferred**: spec `local-coordinator-ifc-ready-intake-boundary/spec.md:90-97`，code 未實作)

## 2. Contracts And Tests

- [x] 2.1 更新或新增 `tests/contracts/ifc_ready_payload.json` 的 compatibility example，保留 canonical contract 並明確標示 worker payload mapping。 — **implemented** by PR #85 (was: **deferred**: 依賴 1.1)
- [x] 2.2 更新 `tests/fakes/external_ifc_worker_client.py`，讓 test-only worker double 可產生 worker compatibility payload 與 canonical payload。 — **implemented** by PR #85 (was: **deferred**: 依賴 1.1)
- [x] 2.3 補 `bim-review-coordinator/tests/external-ifc-ready.test.ts` cases：valid worker payload、invalid status、missing required fields、duplicate replay、conflicting retry、dispatch body remains internal conversion shape。 — **implemented** by PR #85 (was: **deferred**: grep 確認 tests 無 worker payload case)
- [x] 2.4 若 auth fallback 需改 `IntranetDevAuthProvider`，同步更新 `bim-review-coordinator/tests/auth-provider.test.ts`。 — **implemented** by PR #85 (was: **deferred**: 視 1.x 實作決定是否需要) — N/A：worker compat 不改 auth provider 行為（route handler 派生 header fallback；provider 仍要求 secret + correlation/idempotency headers）

## 3. Conversion-ready → Auto Review Session (B-scheme re-home)

- [x] 3.1 在 `bim-review-coordinator/src/app.ts` 的 `ingestConversionReport` terminal `ready` 分支，新增「觸發本地 review session 建立/啟用」的接線，與 `callbackOutbox.enqueue` 並行、不耦合（failed / 非終結不觸發）。 — **implemented** by PR #85 (was: **deferred**: spec authority `review-session-request-lifecycle/spec.md:52-`，code 確認 `ingestConversionReport` (app.ts:566-628) 未建 session)
- [x] 3.2 抽出 `POST /api/review-sessions` 既有 session 建立邏輯（`SessionStore.create` + `allocateKitInstanceBindings` + `chooseReadyUsdc`）為可內部呼叫的共用 helper，conversion-ready 路徑與既有 explicit route 共用同一權威，不複製 binding 規則。 — **implemented** by PR #85 (was: **deferred**: 依賴 3.1；目前 `allocateKitInstanceBindings` 只在 app.ts:234/1067 被呼叫)
- [x] 3.3 以 `correlation_id`（或 `external_model_version_id`）為 idempotency key：conversion-ready 重入/重送只回既有 session，不建重複 active session；與既有 explicit caller 共存不互相覆蓋。 — **implemented** by PR #85 (was: **deferred**: spec `review-session-request-lifecycle/spec.md:59-`，依賴 3.1)
- [x] 3.4 沿用 streaming-owned readiness 語意：非 ready / failed 不建可串流 session、不宣稱 model ready；GPU/Kit 無容量時記 `queued_for_instance` 不丟 review intent。 — **implemented** by PR #85 (was: **deferred**: 依賴 3.1)
- [x] 3.5 維持 control-plane 邊界：只寫 session / stream config / Kit binding metadata；不啟動或控制 Kit 進程、不開 USD stage、不渲染；session_id/bindings 寫入本地最小 shadow metadata，不 mirror 公司雲端。 — **implemented** by PR #85 (was: **deferred**: 依賴 3.1；邊界規則本身已凍結於 `bim-review-coordinator/CLAUDE.md`)

## 4. Auto-session Contracts And Tests

- [x] 4.1 補 `bim-review-coordinator/tests/`（如 `host-native-conversion-ingest.test.ts` 或新測試檔）cases：conversion-ready ingestion 自動建立綁 USDC + Kit binding 的 session。 — **implemented** by PR #85 (was: **deferred**: 依賴 3.x)
- [x] 4.2 測 idempotency：同 `correlation_id` / `external_model_version_id` 重複 ready 不建重複 active session；與 explicit `POST /api/review-sessions` 呼叫者共存。 — **implemented** by PR #85 (was: **deferred**: 依賴 3.x)
- [x] 4.3 測非 ready / failed：不建可串流 session、不宣稱 ready；callback outbox pending/dead-letter 不阻塞本地 session handoff，且兩者狀態獨立分類。 — **implemented** by PR #85 (was: **deferred**: 依賴 3.x)
- [x] 4.4 測 control-plane 邊界：自動建立不觸發任何 Kit 進程/USD/render 動作（以既有 fake/contract 斷言）。 — **implemented** by PR #85 (was: **deferred**: 依賴 3.x)
- [x] 4.5 視需要更新 `tests/contracts/` 對應 contract 與 `docs/contracts/` 文件，反映 conversion-ready → 本地 session handoff seam。 — **implemented** by PR #85 (was: **deferred**: 依賴 3.x)

## 5. Verification And Evidence

- [x] 5.1 實作前針對會修改的 symbols 跑 GitNexus impact analysis（含 `ingestConversionReport`、`SessionStore.create`、`allocateKitInstanceBindings`、`/api/internal/conversion-result`、`/api/internal/conversions/:id/ingest`、`/api/review-sessions`），若出現 HIGH/CRITICAL 先回報再改。 — **implemented** by PR #85 (was: **deferred**: 依賴 1.x-4.x；GitNexus CLI 在 worktree 路徑下可能出現 quoting 問題) — fallback 用 manual symbol read（grep + Read），所有 affected symbols 為 LOW risk
- [x] 5.2 執行 `cd bim-review-coordinator && npm test -- external-ifc-ready.test.ts auth-provider.test.ts` 或等價最小測試。 — **implemented** by PR #85 (was: **deferred**: 依賴 2.x) — 16 + 3 + 10 (host-native-conversion-ingest) passed
- [x] 5.3 執行 `cd bim-review-coordinator && npm run build`。 — **implemented** by PR #85 (was: **deferred**: 依賴 1.x-3.x) — `npm run verify` (= tsc + vitest) 11 files / 165 tests passed；tsc clean
- [x] 5.4 執行 `npx gitnexus detect-changes --scope all --repo <current-worktree>`，確認 affected symbols/flows 符合預期。 — **implemented** by PR #85 (was: **deferred**: 依賴 1.x-3.x；GitNexus CLI quoting bug) — fallback `git diff --stat`：11 files / +680 / -38，affected symbols 與 §0.2 預期一致
- [x] 5.5 視需要更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 與同名 HTML；若此 change 僅 proposal 尚未 apply，記錄為未執行而非 passed。 — **implemented** by PR #85 (was: **deferred**: archive PR #80 已在 roadmap line 41 / html line 308 標註 documentation lag) — backfill apply 通告已加入 roadmap，HTML 經 `scripts/render-roadmap-html.py` 重生
- [x] 5.6 跑 conversion-ready → 自動 session 的最小 coordinator 測試集（auto-create / idempotent / non-ready / control-plane-only / outbox-session 狀態分離），記錄為 passed 的條件為真實測試綠燈。 — **implemented** by PR #85 (was: **deferred**: 依賴 4.x) — `host-native-conversion-ingest.test.ts` 6 個新 cases 全綠
- [x] 5.7 在 verification evidence 明確分層：control-plane 自動接線 tier 與 `single_kit_render` / WebRTC `49100` / browser visual tier 獨立判定、不升等；後者若無 Kit build/GPU/實機視覺驗證證據標 `not_observed`，不標 passed。 — **implemented** by PR #85 (was: **deferred**: 依賴 4.x；Kit/WebRTC tier 需要獨立的原生 Kit/GPU 執行證據，缺少該證據時不可用 control-plane 測試結果替代) — verification doc §4 明寫 render tier `not_observed`，control-plane tier 與 render tier 獨立分層
