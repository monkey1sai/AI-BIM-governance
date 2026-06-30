# Spec Page DS Alignment Fixes Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 把 2026-06-24 對「設計規格說明（`#spec`）」頁稽核剩餘 5 項 low/info 中的 **4 項**一次 surgical 修掉（F1 lead MinIO 措辭、F2 `.ec-lead` margin token、F3 nav tooltip i18n、F4 手冊 §8 Q3 `theme-docs` 句尾**附加**現況補記/append-only 不替人類拍板），全部逐字 current→proposed、不碰後端凍結面；**F5（設計規格.md §2.2 plane 命名）經查證後判定 won't-fix、不改檔**（誠實結算：5 findings → 4 fixed + 1 documented won't-fix，見下方「F5 — won't-fix」節）。

**Architecture:** 前端是 `web-viewer-sample/` 的 React + Vite「Edge Console」product shell；`#spec` 路由由 `pages.tsx` 的 `SpecPage`（純靜態、零後端）渲染，左側 nav 由 `EdgeConsole.tsx` 用 `PAGES` + `NAV_LABEL` + `navText()` 渲染，視覺 token 集中在 `edge-console.css` 的 `--ec-*`。本批改動限於 `SpecPage` lead 一行字串、nav `<button>` 一個 `title` 取值、CSS 一處 margin 字面值改 token，以及一份 `docs/plans/*.md`（F4 手冊 §8 Q3）句尾**附加**現況補記（append-only、不替人類拍板），不新增元件、不改 `navText`/`NAV_LABEL`/`data.ts`、不動任何後端檔（F5 won't-fix，不改 `設計規格.md`）。

**Tech Stack:** TypeScript / React 18（`react-dom/server` `renderToString` 為既有 console 測試慣例）、Vite（`npm run build`，型別須另跑 `npx tsc --noEmit`）、Vitest（`vitest run`）、Playwright（`web-viewer-sample/e2e/`，baseURL `http://127.0.0.1:5180` fresh dev server、coordinator base 由 `VITE_COORDINATOR_API_BASE` 注入 `:8005` branch coordinator）。

---

## 前置（baseline，動手前先量）

> 來源紀律：本 plan 的每處 current_text 皆已對 worktree 實檔 Read 逐字核對（見各 Task 的「已核對錨點」）。line 號僅為導航提示，實際 find-target 是逐字 current_text。

執行者第一步在 `web-viewer-sample/` 下取得 baseline，之後用同一把尺比較：

```bash
cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
npx vitest run 2>&1 | tail -20
npx tsc --noEmit 2>&1 | tail -20
```

預期輸出：vitest 全綠（既有 console.test.tsx 等套件通過）、`tsc --noEmit` 0 error。把這兩個結果記下當 baseline。若 baseline 本身就紅，先回報，不要把既有紅當成自己改壞。

---

## Task 0: F2 — `.ec-lead` margin token 化（CSS · 零視覺改動 · 先做最低風險）

**已核對錨點**：`edge-console.css:69` 逐字為 `.ec-main .ec-lead { color:var(--ec-fg-3); margin:0 0 16px; max-width:70ch; }`；同檔 `line 18` 已定義 `--ec-sp-4:16px`（在 `.ec-root` scope，`.ec-lead` 恆為其後代）。`.ec-lead` 全檔僅此一處有 `margin`，無覆蓋。`16px === var(--ec-sp-4)` → 零視覺改動。

**為什麼先做**：純 CSS 字面替換、無測試、無視覺差異，先落地把風險面縮到最小。

### Files

- Modify: `web-viewer-sample/src/console/edge-console.css`（line 69，整行 find/replace）

### Steps

- [ ] 取 baseline（若 Task 前置尚未跑過）：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx tsc --noEmit 2>&1 | tail -5
  ```

  預期：`tsc` 0 error（CSS 改動不影響型別，僅作回歸基準）。

- [ ] 用 Edit 對 `web-viewer-sample/src/console/edge-console.css` 做整行替換：

  - old_string（逐字）：

    ```css
    .ec-main .ec-lead { color:var(--ec-fg-3); margin:0 0 16px; max-width:70ch; }
    ```

  - new_string：

    ```css
    .ec-main .ec-lead { color:var(--ec-fg-3); margin:0 0 var(--ec-sp-4); max-width:70ch; }
    ```

- [ ] 確認 `.ec-panel` line 98 的 `border-radius:6px` **未被改動**（spec §2 F2 明列 out of scope：它已被 line ~411 DS polish block 的 `var(--ec-r)` cascade 覆蓋，動它無效且製造 churn）：

  ```bash
  grep -n "ec-panel" "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample/src/console/edge-console.css" | head
  ```

  預期：line 98 仍含 `border-radius:6px`（保持原樣）。

- [ ] build + 型別驗證綠：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx tsc --noEmit 2>&1 | tail -5 && npm run build 2>&1 | tail -8
  ```

  預期：`tsc` 0 error；vite build 成功印出 `built in ...`（`dist/` 產出）。

- [ ] commit：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" add web-viewer-sample/src/console/edge-console.css
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" commit -m "fix(console): F2 .ec-lead margin 改用 --ec-sp-4 token（零視覺改動）"
  ```

  預期：`diff --cached --check` 無 trailing whitespace 輸出；commit 成功，diff 僅 edge-console.css 一行。

---

## Task 1: F1 — `#spec` lead 文字修正 MinIO 措辭（user-facing · 誠實措辭）

**已核對錨點**：`pages.tsx:1332` 逐字為下方 current_text；`SpecPage` 為 `pages.tsx` 既有 export（Read 確認 1328–1341，內含 `<p className="ec-lead">` 與 4-Field `Panel`）。Panel 本體（lines 1333–1338）只列 4 個 repo、已正確不含 MinIO，**不動**。`console.test.tsx` 用 `renderToString`（`react-dom/server`）渲染 pages、預設 `_lang="zh"`（i18n.ts:11–13，jsdom 無 localStorage → catch → zh）。

### Files

- Modify: `web-viewer-sample/src/console/pages.tsx`（line 1332，`SpecPage` 內 lead `<p>` 整行 find/replace）
- Modify (Test): `web-viewer-sample/src/console/console.test.tsx`（新增 `SpecPage` import + 一個誠實守門 it）

### Steps

- [ ] 先寫失敗測試（RED）。用 Edit 在 `console.test.tsx` 的 pages import block（現為 `import { A1GovernanceWorkbenchPage, ... VersionDiffPage } from "./pages";`）加入 `SpecPage`：

  - old_string（逐字，取 import 末兩行確保唯一）：

    ```ts
      ViewerPresentationPage,
      VersionDiffPage,
    } from "./pages";
    ```

  - new_string：

    ```ts
      SpecPage,
      ViewerPresentationPage,
      VersionDiffPage,
    } from "./pages";
    ```

- [ ] 用 Edit 在 `console.test.tsx` 既有 `describe("edge console honesty smoke", () => {` 區塊內、第一個 `it(...)` 之前插入新測試（誠實守門用 not-contains，呼應 spec §F1 acceptance）：

  - old_string（逐字，定位到 describe 開頭與第一個 it）：

    ```ts
    describe("edge console honesty smoke", () => {
      it("Applications 啟動器列出 A1–A10 並帶 provenance", () => {
    ```

  - new_string：

    ```ts
    describe("edge console honesty smoke", () => {
      it("SpecPage lead 誠實標 MinIO 為 coordinator 外連 S3、非獨立 repo", () => {
        const html = renderToString(<SpecPage />);
        // 修正後 lead 必須含新措辭（MinIO = coordinator 外連 S3 來源）。
        expect(html).toContain("MinIO 為 coordinator 外連 S3");
        // 誠實守門（not-contains）：不得再把 MinIO 與有 sub-repo 的服務並列、隱含其有 repo boundary。
        expect(html).not.toContain("MinIO 權威仍在各自 repo 邊界");
        // Panel 本體 4 個 repo 不動（回歸：kit-manager-api 仍在）。
        expect(html).toContain("kit-manager-api");
      });

      it("Applications 啟動器列出 A1–A10 並帶 provenance", () => {
    ```

- [ ] 跑該測試確認 RED（lead 尚未改、`toContain("MinIO 為 coordinator 外連 S3")` 應失敗）：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx vitest run src/console/console.test.tsx 2>&1 | tail -25
  ```

  預期：新 it 失敗，訊息類似 `expected '<...>' to contain 'MinIO 為 coordinator 外連 S3'`；其餘既有 it 仍綠。

- [ ] 最小實作（GREEN）。用 Edit 對 `pages.tsx` 的 `SpecPage` lead 行整行替換：

  - old_string（逐字）：

    ```tsx
          <p className="ec-lead">{t("此頁保留 prototype 到 repo 的落地對照：完整操作台是 frontend product shell；conversion / Kit / WebRTC / MinIO 權威仍在各自 repo 邊界。", "This page keeps the prototype-to-repo mapping: the full console is the frontend product shell; conversion / Kit / WebRTC / MinIO authority still lives within their respective repo boundaries.")}</p>
    ```

  - new_string（逐字，spec §F1 proposed）：

    ```tsx
          <p className="ec-lead">{t("此頁保留 prototype 到 repo 的落地對照：完整操作台是 frontend product shell；conversion / Kit / WebRTC 權威仍在各自 sub-repo 邊界；MinIO 為 coordinator 外連 S3 來源，非獨立 repo。", "This page keeps the prototype-to-repo mapping: the full console is the frontend product shell; conversion / Kit / WebRTC authority still lives within their respective sub-repo boundaries; MinIO is an outbound S3 source for coordinator, not a separate repo.")}</p>
    ```

- [ ] 跑該測試確認 GREEN：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx vitest run src/console/console.test.tsx 2>&1 | tail -15
  ```

  預期：新 it 通過、整個 console.test.tsx 套件綠。

- [ ] 型別驗證（vite build 不跑 tsc，須另驗）：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx tsc --noEmit 2>&1 | tail -5
  ```

  預期：0 error。

- [ ] commit：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/console.test.tsx
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" commit -m "fix(console): F1 #spec lead 修正 MinIO 措辭（誠實標 coordinator 外連 S3、非獨立 repo）+ 守門測試"
  ```

  預期：`diff --cached --check` 無輸出；commit 成功。

---

## Task 2: F3 — nav tooltip 走 i18n（前端 · tooltip 語言一致）

**已核對錨點**：`EdgeConsole.tsx:210` nav `<button>` 逐字為下方 current_text，`title={p.label}` 直接用 `data.ts` 混語 fallback（`overview` 的 `data.ts:74 label="Overview"`）；可見文字（line 212）已用 `navText(p.key, p.label)`。`navText`（line 176–179，同元件作用域）：lang=zh→`reg="biz"`，回 `NAV_LABEL[key].biz`。`NAV_LABEL.overview = { tech:"Overview", biz:"總覽" }`（EdgeConsole.tsx:113）。`EdgeConsole` 為 default export（`import EdgeConsole from "./EdgeConsole"`，console.test.tsx:27 已 import）。預設 `_lang="zh"`（i18n.ts），故測試無需呼叫 `setLang`。

### Files

- Modify: `web-viewer-sample/src/console/EdgeConsole.tsx`（line 210，nav `<button>` `title` 取值整行 find/replace）
- Modify (Test): `web-viewer-sample/src/console/console.test.tsx`（新增 EdgeConsole nav tooltip 一個 it）

### Steps

- [ ] 先寫失敗測試（RED）。用 Edit 在 `console.test.tsx` 的 `describe("edge console honesty smoke", () => {` 區塊內、緊接 Task 1 新增的 SpecPage it 之後插入：

  - old_string（逐字，定位到 Task 1 已加入的 it 結尾與下一個 it）：

    ```ts
        // Panel 本體 4 個 repo 不動（回歸：kit-manager-api 仍在）。
        expect(html).toContain("kit-manager-api");
      });

      it("Applications 啟動器列出 A1–A10 並帶 provenance", () => {
    ```

  - new_string：

    ```ts
        // Panel 本體 4 個 repo 不動（回歸：kit-manager-api 仍在）。
        expect(html).toContain("kit-manager-api");
      });

      it("nav tooltip 走 i18n：zh 下 overview 的 title 為「總覽」而非 data.ts fallback「Overview」", () => {
        // 預設 _lang=zh（i18n.ts；jsdom 無 localStorage → fallback zh），navText(overview) → NAV_LABEL.overview.biz = 總覽。
        const html = renderToString(<EdgeConsole />);
        // 修正後 nav 按鈕 title 取 navText（i18n）而非原始 data.ts label。
        expect(html).toContain('title="總覽"');
        // 誠實守門（not-contains）：overview 不應再以英文 fallback 當 tooltip。
        expect(html).not.toContain('title="Overview"');
      });

      it("Applications 啟動器列出 A1–A10 並帶 provenance", () => {
    ```

- [ ] 跑該測試確認 RED（`title={p.label}` 尚未改，overview 的 title 應為 `"Overview"`）：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx vitest run src/console/console.test.tsx 2>&1 | tail -25
  ```

  預期：新 nav tooltip it 失敗（`expected ... to contain 'title="總覽"'` 或 `not.toContain('title="Overview"')` 失敗）；其餘綠。

- [ ] 最小實作（GREEN）。用 Edit 對 `EdgeConsole.tsx` 的 nav `<button>` 行整行替換（僅改 `title` 取值，其餘屬性不動）：

  - old_string（逐字）：

    ```tsx
              <button key={p.key} className={page === p.key ? "active" : ""} data-plane={p.plane} title={p.label} onClick={() => go(p.key)}>
    ```

  - new_string（逐字，spec §F3 proposed）：

    ```tsx
              <button key={p.key} className={page === p.key ? "active" : ""} data-plane={p.plane} title={navText(p.key, p.label)} onClick={() => go(p.key)}>
    ```

- [ ] 跑該測試確認 GREEN：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx vitest run src/console/console.test.tsx 2>&1 | tail -15
  ```

  預期：nav tooltip it 通過、整套件綠。

- [ ] 全套件回歸 + 型別：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx vitest run 2>&1 | tail -12 && npx tsc --noEmit 2>&1 | tail -5
  ```

  預期：vitest 全綠（與 baseline 比，新增 2 個 it 皆 pass、既有不退）；`tsc` 0 error。

- [ ] commit：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" add web-viewer-sample/src/console/EdgeConsole.tsx web-viewer-sample/src/console/console.test.tsx
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" commit -m "fix(console): F3 nav tooltip 改用 navText 走 i18n（tooltip 與可見文字同語言）+ 測試"
  ```

  預期：`diff --cached --check` 無輸出；commit 成功。

---

## Task 3: F4 — 前端對齊手冊 §8 Q3 `theme-docs` 句尾附現況補記（純文件 · append-only · 不替人類拍板）

**已核對錨點**：`docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md:379` 逐字為下方 current_text（§8 open questions 第 3 項），該段全檔唯一。純 `.md`，不碰 code。**§8 約束（line 375，已 Read 確認）**：「下列是會改變可見外觀或行為的決策，AI coding 不得自行拍板，須先問人類」→ 故 F4 **只在句尾 append 非拘束現況補記**（proposed ⊃ current，原 open question 整句**保留不動**），**嚴禁**把 Q3 標成「已結案 / 刻意決策 / 無待決」等替人類拍板字眼（此為 spec §2 F4 硬性 acceptance；前一版 plan 誤寫「已結案」已於本版修正）。

### Files

- Modify: `docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md`（line 379，整段 find/replace；new_string 前半與 old_string **逐字相同**、僅句尾附加一句現況補記）

### Steps

- [ ] 用 Edit 對該檔做整段替換（append-only：old_string = 現有整句，new_string = 原句 + 句尾現況補記，前半不得改一字）：

  - old_string（逐字，handbook line 379 現有整句）：

    ```md
    3. **Light `.theme-docs`**：DS 出一整套淺色 token（藍 `#2563eb`）；repo console 純暗、無 docs surface。本輪做不做任何淺色/docs surface，或整個 skip？
    ```

  - new_string（逐字，spec §F4 proposed；前半與 old_string 完全相同、僅句尾附加）：

    ```md
    3. **Light `.theme-docs`**：DS 出一整套淺色 token（藍 `#2563eb`）；repo console 純暗、無 docs surface。本輪做不做任何淺色/docs surface，或整個 skip？**（現況補記 2026-06，非拍板）** repo 已落地全站 `theme-light` toggle（`edge-console.css:435` 註解映射 `.theme-light = DS .theme-docs`、一處覆寫全站變色，PR #255），可作此題現有實作參考；惟「是否正式採此為最終形 / 是否做 per-page docs surface」仍依本節開頭規則**保留人類決策、未拍板**。
    ```

- [ ] 誠實守門驗證：原 open question 原句**保留**、現況補記**已附加**、且**未出現替人類拍板字眼**（spec §2 F4 acceptance）：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes"
  # (1) 原 open question 整句仍在（append-only 證據；應 1 命中）
  grep -n "或整個 skip？" "docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md"
  # (2) 現況補記與「保留人類決策」字樣已附加（各應 1 命中、同在 line 379）
  grep -n "現況補記 2026-06，非拍板" "docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md"
  grep -n "保留人類決策、未拍板" "docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md"
  # (3) 誠實守門（必須 0 命中）：不得替人類拍板
  grep -nE "已結案|刻意決策|無待決" "docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md" && echo "FAIL: 出現替人類拍板字眼，違反 spec §2 F4" || echo "OK: 無拍板字眼"
  ```

  預期：(1) 與 (2) 各 1 命中且同在 line 379；(3) 印 `OK: 無拍板字眼`（grep 回非零、`||` 分支執行）。若 (3) 印 `FAIL`，回退 new_string 重做，不得 commit。

- [ ] commit：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" add docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" commit -m "docs(plans): F4 前端對齊手冊 §8 Q3 theme-docs 句尾附現況補記（非拍板、保留人類決策）"
  ```

  預期：`diff --cached --check` 無輸出；commit 成功，diff 僅此段（原句保留、句尾附加一句現況補記）。

---

## F5 — won't-fix（documented · 不改檔 · 非 task）

> 依 spec §2 F5 + §3.2 + §5：F5 經 2026-06-30 重新查證後判定 **won't-fix**，**不修改** `docs/plans/ai-bim-governance-設計規格.md`。本節為誠實記錄，**不是可執行 task**（無 step、不 commit、subagent-driven-development 不取用此節）。實作者：**跳過、不要動 `設計規格.md:170`**。

**原 finding**：`設計規格.md:170` §2.2 把 `#spec` 所在 system 列 plane 記為 `CORE`；repo `data.ts:73` 是 `governance`。

**不改的理由（逐條，spec §2 F5）**：
1. §2.2 開頭（line 162）明示「完整 22 條路由以 §A.1.1 正典表為準，**本節只描述分群語意**」→ §2.2 對 per-route plane **非權威**；`#spec` 的 plane 真相在 §A.1.1 / `data.ts`，不在此表。
2. `CORE`/`OMNIVERSE` 是該 doc **自身的巨觀平面命名**，定義在其 legend（line 55 `CORE → governance-service / coordinator`）與 NavItem 規則（line 96）；§2.2 五列一致沿用。**doc 內 `CORE` ≡ repo `governance`**，line 55 已自帶映射，非「錯誤」而是命名層差異（色碼同為 cyan、無行為差異）。
3. 只改 line 170 一列 → 半 `CORE` 半 `governance`、與 166/167/169 及 legend line 55/96 互相矛盾。要對齊得連 legend line 55、規則 line 96、全 §2.2 一起改 = 跨全文詞彙遷移，遠超「surgical stale 修正」、且推翻 doc 既有 `CORE/OMNIVERSE` 慣例，風險與範圍不成比例。

**誠實結算**：5 findings → **4 實際修復（F1–F4）+ 1 documented won't-fix（F5）**。F5「治本」版（doc 全文 `CORE/OMNIVERSE → governance/omniverse` 詞彙遷移，含 legend line 55、規則 line 96、§2.2 全表）若日後要做，**另開獨立 docs PR**（spec §5 follow-up），不在本格。

---

## Task 4: GitNexus / codebase-memory impact + detect_changes（commit 後驗 blast）

**目的**：CLAUDE.md §4 鐵律——改 code symbol 後驗證 blast 限於預期。本批改了 `SpecPage`（pages.tsx）、`EdgeConsole`（nav render，未動 `navText`）兩個前端 symbol，預期 risk=LOW（純字串 / token / tooltip 取值，無簽名變更、無新 caller）。

### Files

- 無檔案改動（純驗證）。

### Steps

- [ ] 對改到的 symbol 跑 upstream impact（確認 blast radius，HIGH/CRITICAL 才需回報）：

  ```text
  ToolSearch query "select:mcp__gitnexus__impact,mcp__gitnexus__detect_changes"
  mcp__gitnexus__impact({ target: "SpecPage", direction: "upstream", repo: "AI-BIM-governance" })
  mcp__gitnexus__impact({ target: "EdgeConsole", direction: "upstream", repo: "AI-BIM-governance" })
  ```

  預期：兩者 risk_level=LOW；`SpecPage` 僅被 `renderBody`/route switch 引用，`EdgeConsole` 為 shell 入口、無上游 caller 受字串/tooltip 影響。若回 HIGH/CRITICAL，停下回報，不續 PR。

- [ ] commit 前/PR 前跑 detect_changes 對 main 比較，確認 scope 未外溢：

  ```text
  mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main", repo: "AI-BIM-governance" })
  ```

  預期：affected symbols 限於 `SpecPage`、`EdgeConsole`（nav render）、新測試與 docs；未波及其他頁面或後端。

- [ ] （導航交叉確認，非 gate）codebase-memory 對同兩 symbol 查 graph，比對 impact 不漏報：

  ```text
  mcp__codebase-memory-mcp__search_graph({ project: "C-Repos-active-iot-AI-BIM-governance", query: "SpecPage EdgeConsole navText", limit: 10 })
  ```

  預期：回 `SpecPage`/`EdgeConsole`/`navText` 三 symbol，file_path 與本 plan 一致；僅作雙圖譜佐證，不翻 gate。

---

## Task 5: Browser E2E — `#spec` 頁 user-facing 驗收（F1 lead + F3 tooltip）

**目的**：spec userFacing=true，F1/F3 是可見改動，須從 `#spec` route 操作 + browser evidence。`#spec` 本身零後端（靜態頁），但本 spec 因 F1/F3 為 user-facing 而要求 P4 自然產出 `#spec` 截圖（spec §2 末 user-facing 驗收 + §1.1 已釐清：不把「補 E2E」當獨立修復項，但 F1/F3 截圖自然涵蓋 `#spec`）。

**vertical slice 說明（誠實標註）**：`#spec` 頁是 DoD §4「靜態 / 🟢 文件入口」，**無 backend API、無 runtime ID、無 loading/success/failure/retry 狀態**——此為頁面結構性事實，非未完成。本 E2E 驗的 vertical slice 是「UI route `#spec` → 渲染 → 可見 lead 新措辭 + nav tooltip i18n」這條前端切片；backend 維度在此頁標 **DEMO DATA / NOT BUILT：`#spec` 為純靜態文件頁，無後端接線、無 runtime 狀態機**（對齊 spec §1.1）。涉真 backend 往返的 vertical slice 由其他 A1–A10 頁的 E2E 覆蓋，不在本格。

**fixture**：本頁無 backend fixture；E2E 以 fresh viewer dev server（`:5180`，playwright.config.ts webServer）載入 `#spec` 即為 default 呈現。隔離 branch stack（`:8005` coordinator / `:49103` governance）對 `#spec` 非必要（靜態頁不打後端）；但若同 PR 想一併重跑既有 console E2E，依 memory `branch-e2e-isolated-stack` / `a1a3-ds-alignment-2026-06-23` 啟法。

### Files

- Create: `web-viewer-sample/e2e/spec-page-ds-alignment-fixes.spec.ts`（Playwright spec，落 `web-viewer-sample/e2e/` 既有慣例位置）

### Steps

- [ ] 用 Write 建立 `web-viewer-sample/e2e/spec-page-ds-alignment-fixes.spec.ts`，內容如下（route→渲染→可見斷言→截圖落 repo 根 `artifacts/e2e/`；不需 coordinator，故無 skip-gate）：

  ```ts
  import { test, expect } from "@playwright/test";
  import { mkdirSync } from "node:fs";

  // spec-page-ds-alignment-fixes user-facing 驗收（F1 lead 措辭 + F3 nav tooltip i18n）。
  // #spec 是「靜態 / 文件入口」：無 backend API、無 runtime ID、無 loading/success/failure/retry 狀態機
  //   → DEMO DATA / NOT BUILT：本頁純靜態，後端維度結構性不適用（對齊 spec §1.1）。
  //   本 E2E 驗的前端 vertical slice：UI route #spec → 渲染 → 可見 lead 新措辭 + nav tooltip i18n。
  // 服務來源：playwright.config.ts webServer 起 fresh viewer dev server :5180（reuseExistingServer:false），
  //   不打後端，故無 skip-gate（非偽綠）。
  const EVID = "../artifacts/e2e/spec-page-ds-alignment-fixes";

  test.describe("spec-page-ds-alignment-fixes #spec user-facing", () => {
    test.beforeAll(() => {
      try { mkdirSync(EVID, { recursive: true }); } catch { /* 已存在 */ }
    });

    test("F1：#spec lead 顯示新 MinIO 措辭、不含舊措辭；Panel 4-repo 不變", async ({ page }) => {
      await page.goto(`/#spec`);
      const lead = page.locator(".ec-main .ec-lead");
      await lead.waitFor({ state: "visible", timeout: 30_000 });
      // 新措辭可見（誠實標 MinIO = coordinator 外連 S3）。
      await expect(lead).toContainText("MinIO 為 coordinator 外連 S3 來源");
      // 誠實守門：不得再含舊措辭（把 MinIO 並列為有 repo 邊界）。
      await expect(lead).not.toContainText("MinIO 權威仍在各自 repo 邊界");
      // Panel 本體 4 個 repo 不變（回歸不變量）。
      await expect(page.getByText("kit-manager-api")).toBeVisible();
      // 不變量：Prov chip kit-manager-api = p1（紅 · 後端待建）。
      await expect(page.locator(".ec-prov.ec-p1").first()).toBeVisible();
      await page.screenshot({ path: `${EVID}/spec-lead.png`, fullPage: true });
    });

    test("F3：nav overview 按鈕 tooltip 為「總覽」(zh)、非英文 fallback", async ({ page }) => {
      await page.goto(`/#spec`);
      // 介面預設 zh：overview nav 按鈕 title 走 navText → NAV_LABEL.overview.biz = 總覽。
      const overviewBtn = page.locator('.ec-nav button[title="總覽"]');
      await expect(overviewBtn).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.ec-nav button[title="Overview"]')).toHaveCount(0);
      // 可見截圖：hover overview 凸顯 nav（tooltip 屬性已斷言，截圖留版面證據）。
      await overviewBtn.hover();
      await page.screenshot({ path: `${EVID}/nav-tooltip-i18n.png`, fullPage: true });
    });
  });
  ```

- [ ] 跑 E2E（fresh viewer dev server 自動起；不需後端）：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx playwright test e2e/spec-page-ds-alignment-fixes.spec.ts 2>&1 | tail -25
  ```

  預期：2 個 test 皆 pass；trace/screenshot/video 落 repo 根 `artifacts/e2e/`（config `outputDir` + spec 內 EVID）。若 chromium 未裝，先 `npx playwright install chromium` 再跑。

- [ ] 確認 evidence 產物存在（截圖 + trace）：

  ```bash
  ls "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/artifacts/e2e/spec-page-ds-alignment-fixes/" 2>/dev/null
  ls "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/artifacts/e2e/report/" 2>/dev/null | head
  ```

  預期：`spec-lead.png`、`nav-tooltip-i18n.png` 存在；`report/` 有 html 報告（trace `on`）。

- [ ] commit（spec 檔；截圖/trace 是 evidence，依既有慣例可只 commit spec 檔，evidence 另存抽樣，不 commit 大 binary）：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" add web-viewer-sample/e2e/spec-page-ds-alignment-fixes.spec.ts
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes" commit -m "test(e2e): F1/F3 #spec user-facing 驗收（lead 措辭 + nav tooltip i18n）"
  ```

  預期：`diff --cached --check` 無輸出；commit 成功。

---

## Task 6: 收尾 — PR body evidence 與共通紀律

**目的**：對齊 spec §4 共通紀律，避免 pr-review-agent / DoD 失敗。此為 PR 階段檢查清單，非 code 改動。

### Files

- 無檔案改動（PR 描述撰寫）。

### Steps

- [ ] 全套件最終回歸（PR 前一把尺對 baseline）：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/spec-page-ds-alignment-fixes/web-viewer-sample"
  npx vitest run 2>&1 | tail -12 && npx tsc --noEmit 2>&1 | tail -5 && npm run build 2>&1 | tail -6
  ```

  預期：vitest 全綠（新增 2 個 it + 既有不退）、`tsc` 0 error、vite build 成功。與 baseline 比無退步。

- [ ] PR body 必含 **Frontend Verification** 表（因 F1/F2/F3 改 `web-viewer-sample/`），逐欄填：

  - Frontend route：`#spec`（F1 lead、F3 nav tooltip 在此頁可見）
  - Main UI tested：Edge Console（`:8004/ui` product shell；E2E 用 fresh dev server `:5180`）
  - Fixture：無 backend fixture（`#spec` 純靜態頁，default 呈現）
  - Visible state：lead 新措辭「MinIO 為 coordinator 外連 S3 來源，非獨立 repo」；overview nav tooltip=「總覽」(zh)
  - E2E command：`npx playwright test e2e/spec-page-ds-alignment-fixes.spec.ts`
  - Screenshot：`artifacts/e2e/spec-page-ds-alignment-fixes/spec-lead.png`、`nav-tooltip-i18n.png`
  - trace：`artifacts/e2e/report/`（trace=on）
  - Known gaps：`#spec` 為靜態文件頁，**無 backend API / runtime ID / loading-success-failure-retry 狀態機**（DEMO DATA / NOT BUILT，結構性、非未完成）；F2 為零視覺改動 CSS token 化（截圖與基準一致）

- [ ] PR body 對 F4（純 `docs/plans/` 手冊句尾 append 現況補記）註明「純文件、append-only、不 match deployPattern、不適用 Deploy Path 表」；**F5 won't-fix（documented，不改檔）**，PR body 註明「5 findings → 4 fixed（F1–F4）+ 1 documented won't-fix（F5）」；全 PR「無後端 / runtime 改動 → Deploy Path 不適用」。

- [ ] 誠實鐵律自檢：F1 是誠實措辭修（讓 lead 與《實作紀律》§6 架構一致）；全頁仍無 live data claim、Prov chip 不變（`kit-manager-api=p1` 紅、其餘綠）、未新增任何假宣稱。

- [ ] 流程：不在 `main` 開發（已在 worktree branch）；branch → PR → Actions → merge（auto-merge 依 memory `default-enable-automerge-on-pr` 既有授權，main 只需 CI 綠、不需 review）。
