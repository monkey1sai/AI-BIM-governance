# 收尾 — 最終回歸結果 + PR body 草稿（供指揮官 P6 組裝）

- spec: `docs/superpowers/specs/2026-06-24-spec-page-ds-alignment-fixes-design.md`
- plan: `docs/superpowers/plans/2026-06-24-spec-page-ds-alignment-fixes.md`（Task 6 收尾）
- slug: `spec-page-ds-alignment-fixes`
- 執行時間: 2026-06-30
- branch: `worktree-spec-page-ds-alignment-fixes`（linked worktree；不動 main）
- HEAD: `c25e750`（task#6 之後、本 evidence commit 之前）
- 依據: spec §4 共通紀律（PR body evidence / 誠實鐵律 / Deploy Path）+ 本 task steps

---

## 0. 結論（一句話）

**F1–F4 全數落地、回歸無退步；F5 documented won't-fix。** 最終回歸 vitest 32 檔 / 384 測試全綠（含新增 2 個 F1/F3 守門測試）、vite build 成功、`tsc --noEmit` 的 7 個 error **全為 pre-existing baseline（本批新增 delta = 0）**；F1/F3 user-facing E2E 親跑 2 passed、產出真實截圖 + trace。**5 findings → 4 fixed（F1–F4）+ 1 documented won't-fix（F5）。**

---

## 1. 最終回歸結果（PR 前一把尺對 baseline）

工作目錄：`web-viewer-sample`。

| 檢查 | 指令 | 結果 | exit | 對 baseline |
|---|---|---|---|---|
| 單元測試 | `npx vitest run` | **32 檔 / 384 測試全 passed**（含新增 2 個 F1/F3 `it`） | 0 | 無退步（純加法 +2） |
| 型別 | `npx tsc --noEmit` | 7 error，**全 pre-existing baseline**；本批 delta = 0 | 2 | 無退步（見 §1.1） |
| 打包 | `npm run build`（vite） | built in 2.35s；僅 chunk-size 既有警告 | 0 | 無退步 |

- vitest 摘要：`Test Files 32 passed (32)` / `Tests 384 passed (384)` / `Duration 6.96s`。
- 新增 2 測試皆在 `src/console/console.test.tsx`（同檔 67 測試全綠）：
  - `SpecPage lead 誠實標 MinIO 為 coordinator 外連 S3、非獨立 repo`（F1 守門：含新措辭 + not-contains 舊措辭 + Panel 4-repo 不變）。
  - `nav tooltip 走 i18n：zh 下 overview 的 title 為「總覽」而非 fallback「Overview」`（F3 守門：title 取 navText + not-contains 英文 fallback）。

### 1.1 為何 `tsc` 非 0 error 仍判「無退步」（誠實展開，非 0 但 delta = 0）

`tsc --noEmit` 回 7 個 error，**逐一查證皆 pre-existing baseline、與本批改動無關**，本批新增 0：

| error 位置 | 種類 | 是否本批改的檔 | 判定 |
|---|---|---|---|
| `console.test.tsx:2207` | `TS2322` `ifc_type: null` | 是（但該行非本批觸碰） | pre-existing：該行最後修改 = PR #244（`ifc_type missing marker(F5)`），非本分支；本批對此檔的 diff 僅檔頭 +30 行（import + 2 個新 `it`），未碰 line 2207 區段 |
| `indexHtml.test.ts`（3 個） | `node:fs` / `node:path` / `process`（缺 `@types/node`） | 否（不在 `origin/main...HEAD` 變更集） | pre-existing baseline |
| `IntentDialog.css.test.ts`（3 個） | 同上 | 否（不在變更集） | pre-existing baseline |

- 證據：`git diff --name-only origin/main...HEAD` 僅列 10 檔（code 4 全在 `src/console/`），`indexHtml.test.ts` / `IntentDialog.css.test.ts` **不在其中**。
- 本批新增的 2 個 F1/F3 測試（console.test.tsx 檔頭 `it` 區塊）**編譯乾淨**，tsc error 清單無任一指向新測試行。
- 對齊 memory `minio-closed-loop-phase1`：vite build 不跑 tsc，型別須另以 `tsc --noEmit` 驗；本批型別 delta = 0。
- 誠實措辭：**不宣稱「tsc 0 error」**；正確陳述為「7 個 error 全 pre-existing baseline、本批引入 0、新測試編譯乾淨、無型別回歸」。

---

## 2. F1/F3 user-facing E2E（親跑、真實證據；非 not-observed）

`#spec` 為靜態頁、不打後端；playwright.config webServer 起 fresh viewer dev server `:5180`（`reuseExistingServer:false`、`trace:on`、`screenshot:on`），自帶最新 branch 碼、無 skip-gate（非偽綠）。

- 指令：`npx playwright test e2e/spec-page-ds-alignment-fixes.spec.ts`
- 結果：**2 passed (5.0s)**（F1 lead 措辭 + F3 nav tooltip i18n）。
- 真實產物（已在磁碟、`artifacts/` 為 gitignored，**不 commit 二進位**，僅本檔登錄路徑）：
  - `artifacts/e2e/spec-page-ds-alignment-fixes/spec-lead.png`（≈188 KB，fullPage）
  - `artifacts/e2e/spec-page-ds-alignment-fixes/nav-tooltip-i18n.png`（≈180 KB，fullPage）
  - `artifacts/e2e/report/index.html`（HTML report）+ `artifacts/e2e/_output/.../trace.zip` ×2（trace=on）
- E2E 已斷言不變量：`kit-manager-api` 可見、`.ec-prov.ec-p1`（紅 · 後端待建）首個可見 → **Prov chip 不變**。

---

## 3. PR body 草稿 — Frontend Verification 表（供 P6 直接貼）

> 觸發原因：本 PR diff 觸碰 `web-viewer-sample/src/console/`（F1 `pages.tsx` / F2 `edge-console.css` / F3 `EdgeConsole.tsx`），pr-review-agent body-evidence frontendPattern 命中 → 必附此表。

| 欄位 | 值 |
|---|---|
| Frontend route | `#spec`（F1 lead 在此頁可見；F3 nav tooltip 在此頁可見） |
| Main UI tested | Edge Console（`:8004/ui` product shell；E2E 用 fresh dev server `:5180`，自帶最新 branch 碼） |
| Fixture | 無 backend fixture（`#spec` 純靜態頁，default 呈現，無 API 呼叫） |
| Visible state | lead 新措辭「MinIO 為 coordinator 外連 S3 來源，非獨立 repo」；overview nav tooltip = 「總覽」(zh)；Panel 4-repo 不變 |
| E2E command | `npx playwright test e2e/spec-page-ds-alignment-fixes.spec.ts` → 2 passed |
| Screenshot | `artifacts/e2e/spec-page-ds-alignment-fixes/spec-lead.png`、`nav-tooltip-i18n.png` |
| trace | `artifacts/e2e/report/`（trace=on；`_output/.../trace.zip` ×2） |
| Known gaps | `#spec` 為靜態文件頁，**無 backend API / runtime ID / loading-success-failure-retry 狀態機**（DEMO DATA / NOT BUILT，結構性、非未完成）；F2 為零視覺改動 CSS token 化（截圖與基準一致） |

---

## 4. 共通紀律自檢（spec §4）

### 4.1 各 finding 的 PR body 處置

- **F1 / F2 / F3**（`web-viewer-sample/`）→ 套用 §3 Frontend Verification 表。
- **F4**（純 `docs/plans/` 手冊句尾 append 現況補記）→ **純文件、append-only、不 match deployPattern、不適用 Deploy Path 表**。PR body 註明此點即可。
- **F5**（設計規格.md §2.2 plane vocab）→ **documented won't-fix（不改檔）**；本批**不改** `docs/plans/ai-bim-governance-設計規格.md`。
- 全 PR **無後端 / runtime 改動 → Deploy Path 不適用**（0 後端、0 docker / port / env / Kit / conversion 改動）。
- 計數陳述（PR body 須含）：**5 findings → 4 fixed（F1–F4）+ 1 documented won't-fix（F5）**。

### 4.2 誠實鐵律自檢

- F1 是**誠實措辭修**：讓 `#spec` lead 與《實作紀律與技術債防線》§6 架構一致（MinIO = coordinator 外連 S3 依賴、非獨立 repo）。
- 全頁仍**無 live data claim**；**Prov chip 不變**（`kit-manager-api=p1` 紅、其餘綠，E2E 已驗）；**未新增任何假宣稱**。
- F4 只補現況、**不替人類拍板**（守手冊 §8「不得自行拍板」）；F5 查證後不硬改、誠實記 won't-fix。
- E2E 為**親跑真實證據**（非 mock、非 not-observed），截圖 + trace 在磁碟。

### 4.3 流程

- 不在 `main` 開發（已在 worktree branch `worktree-spec-page-ds-alignment-fixes`）。
- branch → PR → Actions → merge；auto-merge 依既有授權（main 只需 CI 綠、不需 review）。

---

## 5. 既往安全門回顧（非重跑，索引佐證）

- 編輯前 impact 前置門：`SpecPage` / `EdgeConsole` 皆 **LOW（epistemic exact）** 放行（`impact-prescan.md`）。
- PR 前 detect_changes scope 外溢門：**PASS**，code blast 嚴格限於 `SpecPage`（`#spec`）+ `EdgeConsole`（nav render）+ `.ec-lead` CSS token + 新測試 + docs，未波及其他頁或後端（`detect-changes.md`）。
- advisory（不翻 gate）：GitNexus 對 `EdgeConsole` upstream 回 0 caller，實際掛載在 `main.tsx`（JSX element + default-export import 未被 callgraph 計為 CALLS edge）；本批僅改 render 內 JSX 字串屬性，掛載端結構性不受影響。
