# A1/M1 收尾包：#a1 五步 stepper 狀態機 + 失敗構件抽屜（含樓層）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > docs/plans 行為合約 > wiki；與實作衝突時以實作程式碼與 `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` 的 IX-A1 互動卡為準。
- 日期：2026-06-15
- Phase 對應：**M1「A1 核心閉環」收尾（純 CPU，不碰 3D）**。對應 v3 計畫 M1-R4（plan line 420：「#a1 接真 API：五步 stepper 從示範資料換成真檢核」）與 A1 MVP DoD（plan line 226）。3D highlight（IX-A1-06）需 M3/M4 串流，明確不在本輪。
- userFacing：true（`#a1` / `A1GovernanceWorkbenchPage`）。本輪兩個 user-facing 缺口合併為單一收尾 spec（plan-next-spec-to-done workflow 對抗查證：兩缺口皆 not-built、dependency-met、scope 正確）。

## 1. 背景與現狀（盤點已實證）

A1 後端**已 as-built、閉環為真**：governance-service `:49102` 有 `POST /api/rule-runs`（app.py:219）、`GET /{run_id}`（app.py:259）、`GET /{run_id}/results`（app.py:279）、`GET /{run_id}/export`（app.py:291，excel）、ifctester（IDS/YAML）、issues-from-rule-run、BCF 2.1 匯出（`bcf_writer.py`，stdlib-only）、`mapping_join`（ifc_guid→usd_prim_path）；coordinator 以 `/api/governance/*` proxy 全部轉發（`governanceProxy.ts`，`/results` 在 201-207、`/export` 在 208-216、泛用 forward plumbing 49-88）。前端 `governanceClient` 的 `createRuleRun`(63)/`getRuleRun`(75)/`getResults`(76-79)/`issuesFromRuleRun`(149)/`exportUrl`(80)/`bcfExportUrl`(155) 全接真 API。`#a1` 已掛上 route（`EdgeConsole.tsx:55` `case "a1"`），`IssuesRuleCenterPage`(pages.tsx:598) 確實對 fixture 跑 rule-run、輪詢、取失敗結果。

剩兩個讓 `#a1` 還不是「真正可一路操作的單頁閉環」的 M1/A1 缺口：

1. **五步 stepper 是「版型」沒有狀態機**：`A1GovernanceWorkbenchPage`(pages.tsx:190) 是靜態頁 —— 寫死的 `rules` 陣列(191-197)、`LifecycleStrip`(62-73) 無條件把第 0 步標 active(203)、真正邏輯散在兩個內嵌 slice（`RealIfcConsolePage` pages.tsx:231、`IssuesRuleCenterPage` pages.tsx:234），頁面層不協調它們。repo-wide grep `useReducer|dispatch(|PICK_FILE|RUN_DONE` = 0 命中。對應 PART A 實測：「五步 stepper 是『版型』，步驟間沒有狀態機串接（上傳完成不會自動點亮步驟 2）」。
2. **記分板無法點開命中構件**：失敗結果只 render 成被截斷的扁平表（pages.tsx:786-797，`failed.slice(0,30)` 在 790），沒有 per-rule 展開、沒有分頁、沒有樓層、GUID 不可複製；後端也尚無 `failures?rule=` 端點（rule-run 端點只有 219/259/279/291）。對應 IX-A1-03 DoD（`docs/plans/ai-bim-governance-互動實作規格與標準對齊.md:143`）。失敗資料本身已存在：`get_results(run_id, status)`（db.py:116）以 `SELECT *` 回傳含 `ifc_guid`/`ifc_type`/`ifc_name`/`rule_code`/`severity`/`status`/`usd_prim_path` 的列；既有證據 `A1_EVIDENCE failed:71`（pages.tsx:15，PR #151）。

樓層（storey）為新欄位：`RuleResult`（rule_engine/models.py:20-28）**無 storey**，`get_results` 的列也沒有；storey 只能經 spatial chain 取得（app.py:123 `_spatial_chain`，walks ifc_el→container→storey，現由 `/api/elements/semantics` 暴露）。本輪採「後端 enrichment pass 補樓層」（使用者 2026-06-15 拍板含樓層）。

## 2. 目標（成功標準）

1. **`#a1` 由整頁單一 reducer 驅動的五步狀態機**：狀態 `idle→picked→running→scored→issued→delivered`；事件 `PICK_FILE/RUN/RUN_PROGRESS/RUN_DONE/RUN_FAIL/CREATE_ISSUES_OK/EXPORT_OK`（對齊互動規格 B.1 lines 130-137）。步驟圓點依 state 樣式（已完成=綠勾、當前=綠圈、未到=灰）；上傳完成自動點亮步驟 2；任一步可重跑，重跑清下游 state 但**保留已產出 artifact**（證據型更新，禁樂觀更新 —— PATTERN-EVIDENCE-UPDATE，B.0 mode 1，lines 82-89）。五步接既有真 API，**不新增 rule-run/issues/export 後端**。
2. **記分板規則列可展開命中構件（含樓層）**：每條失敗規則可點擊展開，懶載入分頁（預設 50 筆）顯示 `ifc_guid` + `ifc_name` + `storey`，GUID 可一鍵複製；完全通過的規則顯示「全過」不可展開；展開 71 筆失敗不卡頓。資料源為新端點 `GET /api/governance/rule-runs/{id}/failures?rule=<code>&limit=&offset=`。
3. **誠實鐵律維持**：3D highlight（IX-A1-06）維持灰掉「待建」按鈕（既有 honest disabled，pages.tsx:781-784），不做假按鈕;樓層在個別構件無容器時降級為「—」而非整包失敗或捏造。
4. **Browser E2E（gstack，A1–A10 唯一接受的 user-facing 證據）**通過完整路徑：`#a1` 上傳→自動亮步驟 2→檢核（輪詢 succeeded）→記分→展開一條失敗規則看到 GUID+名稱+樓層+複製→開 Issue→匯出 BCF；含「重跑某步清下游、保留 artifact」一條路徑;附截圖。

## 3. 非目標（明確不做）

- 不動 rule-engine / ifctester / issues-from-rule-run / BCF writer / export 本體（全 as-built）。
- 不做 3D highlight / viewer DataChannel（IX-A1-06，需 M3/M4 串流；維持待建 + honest disabled）。
- 不碰 A2 版本 diff、不碰 M2 轉檔覆蓋率報告（各自獨立 item；後者經查證 blocked-by-milestone-order，須 M1/A1 收完才輪到）。
- 不新增基礎設施 / 不改 proxy 泛用 forward 形狀 / 不引入新 production dependency。
- 不改 `getResults`(db.py:116) 既有 `/results` 端點回傳形狀（新端點獨立；既有前端輪詢路徑回歸不壞）。

## 4. 設計

### 4.1 五步 stepper 狀態機（純前端，web-viewer-sample/src/console/pages.tsx）

- `A1GovernanceWorkbenchPage`(pages.tsx:190) 改為整頁一個 `useReducer`：
  - **states**：`idle`（未選檔）→ `picked`（已選/上傳）→ `running`（檢核中，含 progress 子態）→ `scored`（有記分結果）→ `issued`（已開 Issue）→ `delivered`（已匯出 BCF/Excel）。
  - **events**：`PICK_FILE`(→picked)、`RUN`/`RUN_PROGRESS`(→running)、`RUN_DONE`(→scored)、`RUN_FAIL`(→running-error，可重試)、`CREATE_ISSUES_OK`(→issued)、`EXPORT_OK`(→delivered)。
  - **step dots**：`LifecycleStrip`(pages.tsx:62-73) 改為吃 state 決定每點樣式（done=綠勾、current=綠圈、future=灰），移除無條件 active(203) 寫死。
  - **重跑語意**：任一步可重觸發；reducer 清掉該步之後的下游 state（記分/Issue/匯出旗標歸零），但**不覆蓋已落地 artifact**（rule-run id、已開 Issue、已匯出檔路徑保留可見）。
- 把現散在 `RealIfcConsolePage`(231) 與 `IssuesRuleCenterPage`(234) 的真實呼叫**收進 reducer 的 effect**，client 方法**原封不動複用**（`createRuleRun`/`getRuleRun`/`getResults`/`issuesFromRuleRun`/`exportUrl`/`bcfExportUrl`）—— 降低回歸風險的關鍵紀律。
- 五步對應 API：步驟1 選檔（既有 file-library picker，已存在於 Rule Center slice，本輪收進 stepper）；步驟2 `createRuleRun`+輪詢 `getRuleRun`；步驟3 記分板（`getResults(id,"failed")` + §4.2 抽屜）；步驟4 `issuesFromRuleRun`；步驟5 `exportUrl`/`bcfExportUrl`。
- 3D highlight 區塊維持 honest disabled（pages.tsx:781-784），標待建。

### 4.2 失敗構件抽屜 + 樓層 enrichment（三層縱切）

**後端 governance-service（app.py + db.py + rule_engine）**
- 新端點 `GET /api/rule-runs/{run_id}/failures?rule=<code>&limit=50&offset=0`：
  - 取既有失敗列（複用 `get_results(run_id, status="failed")`，db.py:116），依 `rule_code` 過濾/分組、`limit/offset` 分頁。
  - **storey enrichment**：對該頁構件以 spatial chain（複用 app.py:123 `_spatial_chain` 既有邏輯）補 `storey`；無容器/取不到 → `storey=null`（前端顯示「—」）。enrichment 僅作用於「當頁」構件（分頁後 N 筆），避免全量逐構件 IFC traversal 的成本。
  - 回傳：`{ "rule_code": str, "total": int, "limit": int, "offset": int, "items": [{ "ifc_guid": str, "ifc_name": str|null, "ifc_type": str|null, "storey": str|null, "severity": str }] }`。
- 不改 `/results`、不改 `RuleResult` model（storey 為查詢期 enrichment，非持久化欄位）。

**coordinator（bim-review-coordinator/src/routes/governanceProxy.ts）**
- 新增一條 passthrough proxy 轉發 `/rule-runs/:id/failures`（形狀比照既有 `/results` proxy 201-207，複用泛用 forward+queryString plumbing 49-88）。不解讀 payload。

**前端 client（web-viewer-sample/src/console/governanceClient.ts）**
- 新增 `getFailures(runId, ruleCode, limit, offset)`（mirror `getResults` 76-79），回上述 JSON。

**前端 UI（pages.tsx 記分板，§4.1 步驟3 內）**
- 記分板每條規則列加展開鈕：失敗數 > 0 才可展開；展開時懶載入第一頁 `getFailures`，列出 GUID+名稱+樓層，GUID 旁複製鈕；分頁「載入更多」append 下一頁。
- 失敗數 = 0 的規則顯示「全過」不可展開。
- 取代 pages.tsx:786-797 的 `failed.slice(0,30)` 扁平表。

### 4.3 資料流（一句話版）

`#a1` reducer：`PICK_FILE` → `createRuleRun` → 輪詢 `getRuleRun` 至 done(`RUN_DONE`→scored) → 記分板列規則；展開失敗規則 → `GET /api/governance/rule-runs/:id/failures?rule=X&limit=50`（懶載、分頁、補樓層）→ 抽屜；`issuesFromRuleRun`(→issued) → `exportUrl`/`bcfExportUrl`(→delivered)。全程證據型更新（每次 dot 前進都等 server 確認）。

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| 檢核失敗 `RUN_FAIL` | 進 running-error 子態，顯示錯誤，允許重試;不前進 dot |
| 構件無容器 / storey 取不到 | 該構件 `storey=null` → 前端顯「—」（誠實降級，不整包失敗、不捏造） |
| failures 端點 `rule=` 無此規則 / 失敗數 0 | 回 `total=0, items=[]`;前端「全過」不可展開 |
| 重跑某步 | 清下游 state、保留 artifact（rule-run id/已開 Issue/已匯出檔保留） |
| 樂觀更新 | 禁止;所有 dot 前進皆等 server 回應（PATTERN-EVIDENCE-UPDATE） |
| 分頁載入中再點 | 去重/鎖（避免重複請求同 offset） |

## 6. 測試與驗收

1. **governance pytest**（新增 `tests/test_rule_failures.py` 或擴充既有 rule-run 測試）：
   - failures 端點：依 rule_code 分組、limit/offset 分頁正確、total 準。
   - storey enrichment：有容器 → storey 帶出;無容器 → `storey=null`（降級鎖）。
   - 回歸鎖：`/results`、`/export`、`get_results` 形狀零變動。
2. **前端 vitest**（`console.test.tsx` 既有模式，現僅 348-357 驗 slice render）：
   - reducer 六態轉移（idle→…→delivered）+ `RUN_FAIL` 重試 + 重跑清下游保留 artifact。
   - 記分板展開：失敗規則可展開、懶載入呼叫 `getFailures`、GUID 複製;全過規則不可展開。
3. **Browser E2E（Playwright，`e2e/a1-m1-closeout.spec.ts`）**：
   - 守門與檔頭 skip 限制揭露比照既有 `a2-version-diff-selector.spec.ts` / `minio-fileserver-source.spec.ts` 先例。
   - `#a1`：上傳 → 步驟 2 自動亮 → 檢核至 succeeded → 記分 → 展開一條失敗規則 → 斷言抽屜出現 GUID+名稱+樓層、GUID 可複製 → 開 Issue → 匯出 BCF。
   - 重跑路徑：回到檢核步重跑 → 斷言下游（Issue/匯出旗標）清空、rule-run artifact 仍在。
   - 截圖 + summary 落 `artifacts/e2e/a1-m1-closeout-*` 與 tracked `docs/evidence/a1-m1-closeout/`。
4. **驗收基準**：pytest + vitest + E2E 全綠 + 四項回報;`#a2`/`#minio`/`#conv` 既有 E2E 不壞（共用 governanceProxy / pages.tsx 回歸）。

## 7. 風險與緩解

- **動到中央 #a1 頁、reducer 重構回歸風險（候選2 標 Medium）**：緩解 = client 方法零變更原封複用、先跑 GitNexus impact（`A1GovernanceWorkbenchPage` + `RealIfcConsolePage` + `IssuesRuleCenterPage` + `getResults`），保留既有 E2E 當回歸網;commit 前 detect_changes 驗 scope 未外溢。
- **storey enrichment 成本**：僅對「當頁」分頁後構件做 spatial chain，非全量;百構件量級線性無虞，不做快取（YAGNI）。若 `_spatial_chain` 對大模型單構件成本偏高，可在 plan 階段加上「當頁上限 + 逾時降級 null」護欄。
- **`/failures` 與 `/results` 語意重疊疑慮**：`/failures` 專責「分組+分頁+樓層 enrichment」，`/results` 維持原批量語意不動;兩者並存、職責不同（查證確認既有前端不依賴 /failures）。
- **誠實鐵律**：3D highlight 維持待建;樓層 null 顯「—」;E2E 必須真的展開看到真實構件（非 mock），對齊 A1–A10 operability 與 gstack 證據規約。
- **不在 main 開發**：branch → PR → Actions → merge;PR 描述列改動檔與最小驗證。spec 落 `docs/superpowers/specs/`，接 `writing-plans` → `spec-to-done` 執行。
