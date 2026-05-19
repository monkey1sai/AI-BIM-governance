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

## 3. Verification And Evidence

- [ ] 3.1 實作前針對會修改的 symbols 跑 GitNexus impact analysis，若出現 HIGH/CRITICAL 先回報再改。
- [ ] 3.2 執行 `cd bim-review-coordinator && npm test -- external-ifc-ready.test.ts auth-provider.test.ts` 或等價最小測試。
- [ ] 3.3 執行 `cd bim-review-coordinator && npm run build`。
- [ ] 3.4 執行 `npx gitnexus detect-changes --scope all --repo <current-worktree>`，確認 affected symbols/flows 符合預期。
- [ ] 3.5 視需要更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 與同名 HTML；若此 change 僅 proposal 尚未 apply，記錄為未執行而非 passed。
