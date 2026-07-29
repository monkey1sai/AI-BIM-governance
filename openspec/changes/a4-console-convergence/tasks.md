# Tasks

驗證場所固定為**隔離 alt-port branch stack**（coordinator `:8005`／governance `:49103`），不碰測試部署區 `:8004`；`rebuild-test-deploy.ps1` 強制從 freshly fetched `origin/main` 重建，故部署區驗證只在本 change merge 後才適用（見 8.4）。

## 1. 基準與盤點

- [ ] 1.1 在本 change worktree 對 `origin/main` 建立當前行為 baseline：跑 `governance-service` pytest（A4 相關）、`bim-review-coordinator` `npm run verify`、`web-viewer-sample` `npm run typecheck && npm run test`，記錄通過數與既有失敗，作為調和後的對照基準。
- [ ] 1.2 產出 126 個衝突 hunk 的逐檔清單與分類（後端契約／前端結構／test／文件），標記每處的調和方向（取 main／取 convergence／兩者聯集），清單存 `artifacts/a4-console-convergence/conflict-plan.md`。
- [ ] 1.3 對 `A4SemanticSearchPage`、`governanceClient`、`engine.search`、`proofs` 執行 `gitnexus impact -d upstream -r AI-BIM-governance`，HIGH／CRITICAL 須在 PR body 揭露補強策略；index stale 時先 `node .gitnexus/run.cjs analyze` 或依 `docs/agents/gitnexus-usage.md` 走 unavailable gate。

## 2. 後端契約調和（以 main 為基準）

- [ ] 2.1 `governance-service/search/engine.py`(26 hunks)：保留 main 的 `MAX_A4_PROOF_ROWS_PER_RESPONSE`／`MAX_A4_SEARCH_RESPONSE_BYTES` 等上限常數與 `degraded_to_deterministic` 欄位；只在不改變既有 response shape 的前提下併入 convergence 的補強。
- [ ] 2.2 `governance-service/search/proofs.py`(15 hunks)、`api.py`(8 hunks)、`interpreter.py`／`llm_client.py`(各 2 hunks)：同上原則調和，維持 proof 上限與 truncation 語意。
- [ ] 2.3 `governance-service/issues/store.py`(3 hunks)：保留 main 的 session-bound issue 持久化（#398），不回退為舊版。
- [ ] 2.4 `bim-review-coordinator/src/app.ts`(6 hunks)、`routes/a4HandoffRoutes.ts`(1 hunk)：保留 main 的 route 拆分與 handoff backend（#380／#418 重構），不重新引入已移除的 inline 掛載。
- [ ] 2.5 後端調和後跑 `governance-service` 全量 pytest 與 coordinator `npm run verify`，結果不得低於 1.1 baseline。

## 3. 前端 Console 收斂（以 convergence 為基準）

- [ ] 3.1 先加入 failing tests：涵蓋 canonical route 收斂、session binding 顯示、`table_only` 相容結果停用 Issue／3D，以及 browser 不得提供 host path／mapping input。
- [ ] 3.2 將 convergence 的 live session-scoped `A4SemanticSearchPage.tsx`(938 行) 移植到 main 的後端契約上，對齊 `governanceClient` 的現行 API 形狀（承接母版 5.1）。
- [ ] 3.3 收斂 `#a4`／`#/a4`／separate semantic-search entry 為相容轉址，`#/workspace?dock=a4` 成為唯一 canonical 操作面；不得留下第二套實作（承接母版 5.1）。
- [ ] 3.4 移除 production path mode 與 browser mapping input；顯示 active-session binding；IFC-ready 相容結果標 `table_only` 並停用 Issue／3D（承接母版 5.2）。
- [ ] 3.5 實作 visible states：idle、loading、success、empty、uninterpreted、semantic error、retrying、retry-failed、source/session unavailable、proof-expired-draft-preserved；Retry SHALL 保留 explicit query/mode 並關聯 prior query ID（承接母版 5.3 中不依賴未實作 auth 的部分）。
- [ ] 3.6 Component tests 涵蓋 canonical route 收斂、上述所有 visible states、neutral labels（只表達「符合查詢條件」，不作 compliance judgement）、no fixture counts、no host path control、Console zero DataChannel send（承接母版 5.6 對應範圍）。

## 4. 隔離 stack 驗證與修復迴圈

- [ ] 4.1 依 `docs/agents/product-operability-and-script-contract.md` 啟動隔離 alt-port stack（coordinator `:8005`／governance `:49103`），確認啟動前已跑 host-native port 清理，且不影響部署區 `:8004`。
- [ ] 4.2 對隔離 stack 實跑 A4 canonical route：真實 coordinator API、deterministic fixture、observed `query_id`，逐一驗證 3.5 的每個 visible state；每輪失敗即修復後重跑同一檢查，記錄 before／after。
- [ ] 4.3 收集 runtime evidence 到 `artifacts/e2e/a4-console-convergence/`：screenshot、console、network、observed runtime IDs；PNG 依 repo 慣例需 `git add -f`。
- [ ] 4.4 驗證 degraded／partial 路徑不宣稱 semantic completion：`degraded_to_deterministic=true` 與 `table_only` 結果 SHALL 停用 Issue／3D eligibility。

## 5. 收尾與誠實揭露

- [ ] 5.1 從 `web-viewer-sample` 跑受影響 unit/session tests 與 `npm run build`；不得以 build 取代 user-facing evidence（承接母版 8.3）。
- [ ] 5.2 Code-flow edits 後跑 `gitnexus detect-changes --scope compare --base-ref main`，誠實處理 UNKNOWN／stale linked-worktree output，commit 前解決 HIGH／CRITICAL affected path（承接母版 8.4）。
- [ ] 5.3 PR body 提供 machine truth：Frontend route、main buttons、fixture、backend API、observed query/request IDs、visible states、E2E command、screenshot/trace，並明確標示 `Full completion claimed: no` 與 known gaps（7.x evidence gates、3.2–3.4 auth、6.x handoff 剩餘仍在 deferred 母版）。
- [ ] 5.4 在 PR body 揭露本 change **未**涵蓋母版哪些 task，以及母版 thaw 的四項重啟條件現況。
- [ ] 5.5 merge 後於 `a4-semantic-search-model-qa` 的 thaw crosswalk 標記 5.1／5.2／5.3／5.6／8.3／8.4 由本 change 承接（本 change 不直接改母版 checkbox，避免與 deferred 狀態衝突）。
