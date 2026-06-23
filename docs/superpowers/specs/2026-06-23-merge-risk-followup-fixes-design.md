# 合併風險 follow-up 修復設計

> 日期：2026-06-23
> 背景：A1/A2/A3 對齊 Design System 的 PR #241/#242/#243 已 merged 進 `main`（commit 9857ae5）。一份 review report 提出 5 個合併風險 finding。經 ultracode **5-agent 交叉對抗驗證**（refute-by-default，依難度配 haiku/sonnet/opus，讀 main 真 code 確認）。本 doc 記錄驗證結論與修復計畫。
> 全部 5 項 blast radius=low（surgical 修法）；其中 2 項涉誠實鐵律違規（F1/F5）列 P1。

---

## 1. 對抗驗證結論

| ID | finding | verdict | severity | user-facing | 誠實違規 | blast |
|---|---|---|---|---|---|---|
| F1 | BCF gating 無 issue 可 enable | confirmed | medium | ✓ | ✓ | low |
| F2 | rebuild restore 部分失敗即 abort | confirmed | medium | ✗ | ✗ | low |
| F3 | store migration 非 race-safe | **partial** | low | ✗ | ✗ | low |
| F4 | BCF export 無 observable state | **partial** | low | ✓ | ✗ | low |
| F5 | old rows ifc_type 空 cell | confirmed | medium | ✓ | ✓ | low |

### 對抗驗證糾正的「誇大」（誠實記錄，避免照單全收）
- **F3 → partial（非高危）**：race window 很窄——`_SCHEMA` 用 `CREATE TABLE IF NOT EXISTS` 且新 schema 已含 ifc_type/ifc_name，fresh DB 不進 ALTER 分支；ALTER 只在「既有舊 DB 缺欄」時觸發且補欄後永久存在（一次性）。且 finding 引述的「ALTER 會被 try/except 略過」**實際不存在**（store.py:63 是誤導註解，真正守門的是 `existing_cols` 檢查）。仍需修（容忍 duplicate-column race + 修註解），但嚴重度 low。
- **F4 → partial（非高危）**：finding 說「silent 失敗」是誇大——錯誤路徑有 `setActionErr`→渲染 `a1-action-error`（非完全 silent）；fetch 期間不 disable 是 **BCF 與 Excel 同等缺口**（finding 只挑 BCF 講偏頗）。仍值得補成功/載入 state，但嚴重度 low。

---

## 2. 修復項目（按優先序）

### P1 — medium + 誠實鐵律違規（最優先）

**Fix-F1：BCF gating 獨立追蹤「是否真正建過 Issue」**
- root cause：`a1Machine.ts:62-64` 的 `EXPORT_OK` guard 含 `scored`，故 `scored →（點匯出 Excel）→ delivered` 不經 `issued`；而 `pages.tsx:508` `bcfEnabled = step==='issued' || step==='delivered'` 只看 step，導致零 Issue 也能 enable BCF，與 `pages.tsx:504/514` 的「需先建 Issue」宣示矛盾（UI 誤導 = 誠實違規）。
- fix：`A1State` 加 `issuesCreated: boolean`（初始 false），`CREATE_ISSUES_OK` 設 true、`RESET` 清零；`bcfEnabled` 改為 `issuesCreated && (step==='issued' || step==='delivered')`。不改 transition 路徑、不影響 Excel 匯出語意。
- scope：`web-viewer-sample/src/console/a1Machine.ts`、`pages.tsx`(A1GovernanceWorkbenchPage bcfEnabled)。
- acceptance：a1Machine.test.ts 加「`scored→EXPORT_OK→delivered` 時 bcfEnabled 仍 false」「`CREATE_ISSUES_OK` 後 bcfEnabled true」；browser E2E：跑檢核→匯出 Excel(不建 Issue)→BCF 鈕仍 disabled + caption。

**Fix-F5：old rows ifc_type NULL 顯誠實 missing marker**
- root cause：migration 對 old rows 留 `ifc_type` NULL，UI `pages.tsx:1905` 直接 `{it.ifc_type}`→空 cell（視覺歧義：缺失？真空？），不像 `pages.tsx:1302` ifc_name 用 `?? "—"`。
- fix：`{it.ifc_type}` → `{it.ifc_type ?? "—"}`（對齊既有 ifc_name pattern）。
- scope：`web-viewer-sample/src/console/pages.tsx`(VersionDiffPage 表格 render，單行)。
- acceptance：vitest 補「ifc_type=null 列 render `—`」；browser E2E：含 NULL ifc_type 的舊 diff 記錄型別欄顯 `—`。

### P2 — medium

**Fix-F2：restore 逐檔獨立、收集失敗、不中途 abort**
- root cause：`Restore-TestDeployEnvSnapshot` foreach(`:132-150`)無 per-entry try/catch，第一個 `WriteAllBytes`(`:148`)失敗即 throw 離開，後面 env 檔（含 MinIO 憑證 `.env.web-plane.host-kit`）未還原；`git clean -fdx` 已先刪 tracked env，abort = 永久遺失。
- fix：foreach 內 `WriteAllBytes` 包 try/catch，記錄失敗 entry、`continue`；迴圈後若 `$failures` 非空才彙總 throw。
- scope：`scripts/lib/rebuild-test-deploy.ps1` — 僅 `Restore-TestDeployEnvSnapshot` 內部(`~142-149`)，不動呼叫點。
- acceptance：`scripts/tests/test-rebuild-test-deploy.ps1` 加「第一個 entry 寫入失敗時，後續 entry 仍被還原 + 最後彙總 throw」。

### P3 — partial / low

**Fix-F3：migration 容忍 duplicate-column race + 修誤導註解**
- root cause：`existing_cols` 檢查 + ALTER 的 check-then-act 多執行緒非原子；並發 first request（FastAPI threadpool）可能都 ALTER→第二個 `duplicate column` 500。`_get_store` singleton 無鎖。`store.py:63` 註解與實作不符。
- fix：ALTER 迴圈(`:65-67`)的 `conn.execute(alter_sql)` 包 `try/except sqlite3.OperationalError`，僅錯誤訊息含 `"duplicate column"` 時吞掉、其餘 re-raise；修正 `:63` 註解。（選配：`_get_store` 加 `threading.Lock` 序列化首建，非必要）
- scope：`governance-service/diff_engine/store.py` migration 迴圈 + 註解。
- acceptance：`test_diff_engine.py` 加並發 first-request migration 測試（擴充現有 `:425-428` store1/store2 同 db_path 案例為並發）。

**Fix-F4：BCF export 補可見成功/載入 state（順帶補 Excel 同等 loading）**
- root cause：BCF onClick(`:515-531`)成功不 dispatch/不顯示成功（對比 Excel `EXPORT_OK`→可見 `a1-exported-artifact`）；fetch 期間 BCF+Excel 都不 disable。
- fix：BCF 成功 dispatch `BCF_EXPORT_OK`（或 `EXPORT_OK`+`bcfExported` flag）→可見成功 artifact(`a1-bcf-exported-artifact`)；加 `bcfBusy` useState，fetch 前 set、`finally` clear，`disabled={!bcfEnabled||bcfBusy}`。**誠實一致**：順帶補 Excel 同等 loading disable（finding 偏頗處）。
- scope：`pages.tsx`(BCF onClick)、`a1Machine.ts`(BCF_EXPORT_OK)、`console.test.tsx`。
- acceptance：vitest 補 BCF click 成功路徑（dispatch + 可見 artifact）；browser E2E：BCF 下載中鈕 disabled、成功後顯 artifact。

---

## 3. PR 分組建議
全部 blast low、surgical。建議分 3 個 follow-up PR（依 owner 區，review 聚焦）：
- **PR-fix-A（前端 / A1·A2）**：F1 + F5 + F4（都改 `web-viewer-sample/`：pages.tsx + a1Machine.ts）。含 P1 的 2 個誠實修 + F4。
- **PR-fix-B（後端）**：F3（`governance-service/diff_engine/store.py`）。
- **PR-fix-C（部署 script）**：F2（`scripts/lib/rebuild-test-deploy.ps1`）。

若要更快收誠實違規：F1 + F5 可先單獨出（P1），F2/F3/F4 隨後。

---

## 4. 共通紀律（避免重蹈 #241/#242 的 pr-review-agent 失敗）
- **誠實鐵律優先**：F1（UI gating 對齊「需先建 Issue」宣示）、F5（NULL→`—`）是誠實修，列 P1。
- **PR body evidence 表格**（否則 `pr-review-agent` 的 `check-pr-body-evidence` 會 fail）：
  - F1/F4/F5 改 `web-viewer-sample/` → 需 **Frontend Verification** 表格（Frontend route / Main button(s) tested / Fixture used / Visible success state / E2E command / Screenshot / trace / Known gaps）。
  - F2 改 `scripts/lib/rebuild-...` 、F3 改 `governance-service/` → 都 match deployPattern → 需 **Deploy Path Verification** 表格（Affects runtime…? / Canonical deploy path updated? / Deploy dry-run command / Verify command）。
- user-facing（F1/F4/F5）須 **browser E2E evidence**（隔離 stack，啟法見 memory `a1a3-ds-alignment-2026-06-23`）。
- 改 symbol 前跑 GitNexus / codebase-memory impact（雖全 blast low）。
- 不在 `main` 開發；branch → PR → Actions → 你 approve → merge。
