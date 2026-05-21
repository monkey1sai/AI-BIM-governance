## 1. Coordinator Intake Compatibility

- [ ] 1.1 在 `bim-review-coordinator/src/app.ts` 或鄰近 helper 中加入 worker payload normalization，支援 `status="ifc_ready"`、`ifc_path`、`project_id`、`version`、`task_id`。
- [ ] 1.2 保留既有 canonical `event="ifc_ready"` payload 支援，並讓兩種輸入在進入 `ExternalIfcReadyStore` 前收斂為同一個 canonical `ExternalIfcReadyEvent`。
- [ ] 1.3 讓 worker payload 缺少 explicit `X-Correlation-Id` / `X-Idempotency-Key` 時，從 `project_id`、`version`、`task_id` 派生穩定 correlation / idempotency values；explicit headers 仍優先。
- [ ] 1.4 處理缺少 `source_ifc.etag` 的 worker payload，不把 fallback etag 誤宣告為真實 checksum。
- [ ] 1.5 確保 rejected worker payload 不建立 local job，也不 dispatch 到 `bim-streaming-server`。

## 2. Contracts And Tests

- [ ] 2.1 更新或新增 `tests/contracts/ifc_ready_payload.json` 的 compatibility example，保留 canonical contract 並明確標示 worker payload mapping。
- [ ] 2.2 更新 `tests/fakes/external_ifc_worker_client.py`，讓 test-only worker double 可產生 worker compatibility payload 與 canonical payload。
- [ ] 2.3 補 `bim-review-coordinator/tests/external-ifc-ready.test.ts` cases：valid worker payload、invalid status、missing required fields、duplicate replay、conflicting retry、dispatch body remains internal conversion shape。
- [ ] 2.4 若 auth fallback 需改 `IntranetDevAuthProvider`，同步更新 `bim-review-coordinator/tests/auth-provider.test.ts`。

## 3. Conversion-ready → Auto Review Session (B-scheme re-home)

- [ ] 3.1 在 `bim-review-coordinator/src/app.ts` 的 `ingestConversionReport` terminal `ready` 分支，新增「觸發本地 review session 建立/啟用」的接線，與 `callbackOutbox.enqueue` 並行、不耦合（failed / 非終結不觸發）。
- [ ] 3.2 抽出 `POST /api/review-sessions` 既有 session 建立邏輯（`SessionStore.create` + `allocateKitInstanceBindings` + `chooseReadyUsdc`）為可內部呼叫的共用 helper，conversion-ready 路徑與既有 explicit route 共用同一權威，不複製 binding 規則。
- [ ] 3.3 以 `correlation_id`（或 `external_model_version_id`）為 idempotency key：conversion-ready 重入/重送只回既有 session，不建重複 active session；與既有 explicit caller 共存不互相覆蓋。
- [ ] 3.4 沿用 streaming-owned readiness 語意：非 ready / failed 不建可串流 session、不宣稱 model ready；GPU/Kit 無容量時記 `queued_for_instance` 不丟 review intent。
- [ ] 3.5 維持 control-plane 邊界：只寫 session / stream config / Kit binding metadata；不啟動或控制 Kit 進程、不開 USD stage、不渲染；session_id/bindings 寫入本地最小 shadow metadata，不 mirror 公司雲端。

## 4. Auto-session Contracts And Tests

- [ ] 4.1 補 `bim-review-coordinator/tests/`（如 `host-native-conversion-ingest.test.ts` 或新測試檔）cases：conversion-ready ingestion 自動建立綁 USDC + Kit binding 的 session。
- [ ] 4.2 測 idempotency：同 `correlation_id` / `external_model_version_id` 重複 ready 不建重複 active session；與 explicit `POST /api/review-sessions` 呼叫者共存。
- [ ] 4.3 測非 ready / failed：不建可串流 session、不宣稱 ready；callback outbox pending/dead-letter 不阻塞本地 session handoff，且兩者狀態獨立分類。
- [ ] 4.4 測 control-plane 邊界：自動建立不觸發任何 Kit 進程/USD/render 動作（以既有 fake/contract 斷言）。
- [ ] 4.5 視需要更新 `tests/contracts/` 對應 contract 與 `docs/contracts/` 文件，反映 conversion-ready → 本地 session handoff seam。

## 5. Verification And Evidence

- [ ] 5.1 實作前針對會修改的 symbols 跑 GitNexus impact analysis（含 `ingestConversionReport`、`SessionStore.create`、`allocateKitInstanceBindings`、`/api/internal/conversion-result`、`/api/internal/conversions/:id/ingest`、`/api/review-sessions`），若出現 HIGH/CRITICAL 先回報再改。
- [ ] 5.2 執行 `cd bim-review-coordinator && npm test -- external-ifc-ready.test.ts auth-provider.test.ts` 或等價最小測試。
- [ ] 5.3 執行 `cd bim-review-coordinator && npm run build`。
- [ ] 5.4 執行 `npx gitnexus detect-changes --scope all --repo <current-worktree>`，確認 affected symbols/flows 符合預期。
- [ ] 5.5 視需要更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 與同名 HTML；若此 change 僅 proposal 尚未 apply，記錄為未執行而非 passed。
- [ ] 5.6 跑 conversion-ready → 自動 session 的最小 coordinator 測試集（auto-create / idempotent / non-ready / control-plane-only / outbox-session 狀態分離），記錄為 passed 的條件為真實測試綠燈。
- [ ] 5.7 在 verification evidence 明確分層：control-plane 自動接線 tier 與 `single_kit_render` / WebRTC `49100` / browser visual tier 獨立判定、不升等；後者若無 Kit build/GPU 證據標 `not_observed`，不標 passed。
