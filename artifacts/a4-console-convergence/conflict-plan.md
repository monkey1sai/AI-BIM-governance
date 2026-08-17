# a4-console-convergence 衝突調和計畫（task 1.2）

> 文件性質：**working inventory**（task 1.2 交付物）。量測方法：`git merge-tree --write-tree origin/main origin/codex/openspec/a4-semantic-search-model-qa-convergence` 列衝突檔，再以 `git merge --no-ff --no-commit`（隨即 abort）逐檔計 `<<<<<<<` hunk 數。量測基準：main=`c3057d8`（2026-08-17）、convergence=`origin/codex/openspec/a4-semantic-search-model-qa-convergence`（頭=`保全 a4-semantic-search-model-qa-convergence 未提交工作`，落後 main 270+）。
>
> 原 tasks.md 記載「126 個衝突 hunk」為 2026-07 快照；main 前進後現值為 **27 檔／153 hunks**。以下逐檔清單即本輪的權威清單。

## 分類彙總

| 類別 | 檔數 | hunks | 調和基準 |
|---|---|---|---|
| 後端契約（governance-service src） | 6 | 54 | 取 main（上限常數／degraded 欄位／session-bound 持久化），只併不改 response shape 的補強 |
| 後端契約（coordinator src） | 2 | 10 | 取 main（route 拆分／handoff backend #380/#418），不回退 inline 掛載 |
| 前端結構（viewer src） | 3 | 33 | 取 convergence 的 live session-scoped 結構，移植到 main 的 API 形狀（3.2） |
| test | 9 | 39 | 聯集重寫：main 的契約斷言為底，補 convergence 的 session-scoped 情境；先照 3.1 加 failing tests |
| 文件／設定 | 7 | 17 | 取 main，僅補記 convergence 專有的 runbook／env 說明；NOW.md 依 lifecycle 機制重生 |

## 逐檔清單（hunks 降冪）

| # | 檔案 | hunks | 類別 | 調和方向 |
|---|---|---|---|---|
| 1 | `governance-service/search/engine.py` | 26 | 後端契約 | **取 main**：保留 `MAX_A4_PROOF_ROWS_PER_RESPONSE`／`MAX_A4_SEARCH_RESPONSE_BYTES`／`degraded_to_deterministic`；convergence 補強逐 hunk 審視，只取不改 shape 者（task 2.1） |
| 2 | `web-viewer-sample/src/console/A4SemanticSearchPage.tsx` | 23 | 前端結構 | **取 convergence**（938 行 live session-scoped 版）為骨架，API 呼叫對齊 main 的 `governanceClient` 現行形狀（task 3.2）；canonical route 收斂到 `#/workspace?dock=a4`（task 3.3） |
| 3 | `governance-service/tests/test_search_model.py` | 17 | test | 聯集：main 契約斷言為底＋convergence 的 session 情境；隨 2.1/2.2 調和結果重跑 |
| 4 | `governance-service/search/proofs.py` | 15 | 後端契約 | **取 main**：proof 上限與 truncation 語意不動（task 2.2） |
| 5 | `governance-service/search/api.py` | 8 | 後端契約 | **取 main**（task 2.2） |
| 6 | `web-viewer-sample/src/console/governanceClient.ts` | 7 | 前端結構 | **取 main 的 API 形狀**；convergence 若有 session-binding helper 以不改契約方式併入（task 3.2 前置） |
| 7 | `bim-review-coordinator/src/app.ts` | 6 | 後端契約 | **取 main**：route 拆分後結構（task 2.4）；歷史紀錄此符號曾測得 CRITICAL exact impact，調和時逐 hunk 檢視 |
| 8 | `openspec/changes/a4-semantic-search-model-qa/tasks.md` | 5 | 文件 | **取 main**（deferred 母版不由本 change 改動；task 5.5 走 thaw crosswalk） |
| 9 | `governance-service/tests/test_search_handoff_api.py` | 5 | test | 聯集重寫 |
| 10 | `web-viewer-sample/src/console/governanceClient.test.ts` | 4 | test | 聯集重寫（隨 #6 調和） |
| 11 | `governance-service/issues/store.py` | 4 | 後端契約 | **取 main**：session-bound issue 持久化（#398）不回退（task 2.3） |
| 12 | `bim-review-coordinator/tests/a4-handoffs.test.ts` | 4 | test | 聯集重寫（隨 #7/#13 調和） |
| 13 | `bim-review-coordinator/src/routes/a4HandoffRoutes.ts` | 4 | 後端契約 | **取 main**（task 2.4） |
| 14 | `web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx` | 3 | test | 聯集：以 task 3.3 的相容轉址規格重寫 |
| 15 | `docs/plans/NOW.md` | 3 | 文件 | **取 main**：由 lifecycle 機制重生投影，不手工調和 |
| 16 | `governance-service/tests/test_search_llm.py` | 2 | test | 聯集重寫 |
| 17 | `governance-service/search/llm_client.py` | 2 | 後端契約 | **取 main**（task 2.2） |
| 18 | `governance-service/search/interpreter.py` | 2 | 後端契約 | **取 main**（task 2.2） |
| 19 | `docs/runbooks/a4-ornith-llm.md` | 2 | 文件 | 取 main＋補記 convergence 專有段落 |
| 20 | `bim-review-coordinator/tests/governance-search-for-session.test.ts` | 2 | test | 聯集重寫 |
| 21 | `bim-review-coordinator/tests/dev-console.test.ts` | 2 | test | 聯集重寫 |
| 22 | `bim-review-coordinator/README.md` | 2 | 文件 | 取 main＋補記 |
| 23 | `web-viewer-sample/src/console/A4SemanticSearchPage.test.tsx` | 1 | test | 依 task 3.1 重寫為 failing-first component tests（route 收斂／session binding／`table_only` 停用 Issue+3D／無 host path input） |
| 24 | `web-viewer-sample/e2e/design-system-semantic-cases.ts` | 1 | test | 聯集；semantic cases 對齊 workspace.a4 canonical 面 |
| 25 | `web-viewer-sample/e2e/a4-closeout.spec.ts` | 1 | test | 取 convergence（隔離 stack A4 E2E）＋4.0.5 的 `A4_E2E_IFC_READY_JOB_ID` 掛鉤 |
| 26 | `governance-service/issues/api.py` | 1 | 後端契約 | **取 main**（task 2.3 相鄰） |
| 27 | `bim-review-coordinator/.env.example` | 1 | 設定 | 取 main；convergence 新 key 只留空 placeholder（tracked sample 禁真值） |

## Task 1.1 baseline（2026-08-17，main=`c3057d8`）

- `governance-service` pytest（`-k "search or issue or a4 or A4"`）：**183 passed**／119 deselected。前置：`.venv` 缺 `openpyxl` 造成 8 個 collection error（`rule_engine/excel_export.py` import），已 `pip install openpyxl` 修復——環境退化，非程式失敗，已列入 venv 退化清單知識。
- `bim-review-coordinator` `npm run verify`：**857 tests passed**。
- `web-viewer-sample` `npm run typecheck && npx vitest run`：typecheck 通過、**79 files／1080 tests passed**。
- 既有失敗：無（三件套全綠）。調和後（task 2.5／5.1）不得低於此基準。

## Task 1.3 impact（current GitNexus index @ main `c3057d8`，exact epistemic）

| Symbol | 方向 | 結果 |
|---|---|---|
| `A4SemanticSearchPage` | upstream | LOW（2 impacted） |
| `governanceClient` | upstream | LOW（0 impacted） |
| `run_model_search`（engine.search 實體） | upstream | LOW（3 impacted） |
| `createCoordinatorApp`（app.ts 調和的傘符號） | upstream | LOW（1 impacted）——**與歷史紀錄不符**：2026-07 兩輪 exact 分析為 CRITICAL（35 direct／62 impacted）。現值疑為 index 涵蓋率縮水，實作輪（task 2.4/5.2）前必須 re-index 後重測，未重測前依 CRITICAL 對待（owner 已於 issue #551 R3 對該符號給過 scoped CRITICAL 簽核先例） |

## 殘留與依賴

- **4.0.4（owner 動作）**：真實 MinIO 唯讀憑證（`MINIO_WATCH_*` 四值經 `--env-file` 提供，不進 tracked 檔）——4.0.5 起的隔離 stack seeding 全數依賴此項。
- 4.0.5 另依賴 #431 launcher（已在 main）。
- 實作輪順序建議：2.x（後端，main 基準）→ 3.1 failing tests → 3.2–3.6（前端移植）→ 4.x（隔離 stack）→ 5.x。
