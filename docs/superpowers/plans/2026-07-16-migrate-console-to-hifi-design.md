# UnifiedConsole 遷移至 Hi-Fi Design Token（ai-bim-governance.css）Implementation Plan

> **Implementation authorization:** This plan does not authorize implementation. After the user reviews the plan, obtain explicit follow-up authorization before invoking subagent-driven-development, executing-plans, or any other implementation skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 讓 `docs/plans/ai-bim-governance.css`（`--ab-*`）成為 UnifiedConsole 唯一 production design token 權威：真實 import、三套顏色來源收斂為一套、移除亮/暗主題切換、retire `edge-console.css`、更新 §08 文件並用既有 pixel/semantic 雙閘 rebaseline。

**Architecture:** `ai-bim-governance.css` 以相對路徑真實 import 進 vite 建置（token 定義在 `:root`，全域可 var() 消費；缺口 token 延伸進授權檔本體）。已遷移的 UnifiedConsole IA v2 頁面（`console/unified/*`）做值恆等的 inline hex → `var(--ab-*)` 置換（像素零漂移，由既有 visual gate 證明）；legacy 頁面（`LegacyEdgeConsole` 殼、`#conv`、overlay、viewer）換為消費 `--ab-*`（品牌由 NVIDIA 綠 `#76b900` 轉 Hi-Fi 青 `#41c7e8`，視覺改變是本 change 的目的）。`edge-console.css` 的結構性 selector 移植到新檔 `legacy-console.css`（僅消費 `--ab-*`、無淺色主題塊），原檔刪除。

**Tech Stack:** React 18 + TypeScript + Vite（`web-viewer-sample/`）、vitest（jsdom）、Playwright 1.61.1（pinned）、pixelmatch 7.1.0、PowerShell 7、現成 pixel/semantic 雙閘（`capture-design-system-reference.mjs` + `verify-design-system-reference.ps1` + `design-system-visual.spec.ts`）。

## 導航前提（plan 作者已驗證的事實，執行者不必重查）

- 唯一 CSS import 點：`web-viewer-sample/src/console/EdgeConsole.tsx:8`（`import "./edge-console.css"`）；`GovernanceOverlay.tsx:7` import `governance/overlay.css`；`unified/UnifiedShell.tsx:21` import `unified.css`。掛載入口 `src/main.tsx:40`（console 路由 → `<EdgeConsole/>`）。
- `--ec-` 目前分佈：`edge-console.css`（217，含定義）、`governance/overlay.css`（11，**自帶一份本地定義副本**，因 overlay 掛在 `.ec-root` 之外）、`pages.tsx`（5 處 inline `style={{color:"var(--ec-…)"}}`，位於 `AppVisionPage` 區段 947/974/978/986/1319 行）。`viewer/viewer.css` **不用 `--ec-`**，全部硬寫 hex（44 個，含 `#76b900`）；`MockViewport.tsx` 只用 `gv-*` class、無色碼。
- 主題切換全部在 `EdgeConsole.tsx` 的 `LegacyEdgeConsole`：state + localStorage `aibim:ec-theme`（232–236 行）、`.theme-light` class 套用（256 行）、切換按鈕 aria-label「切換亮暗主題」（270 行）。淺色 token 塊在 `edge-console.css:441-454`。
- unified 頁 inline hex 數：`UnifiedShell` 27、`HomePage` 20、`WorkspacePage` 27、`PipelinePage` 40、`OpsPage` 19、`ConceptPage` 10、`docks.tsx` 55、`fixtures.ts` 26、`unified.css` 8。**這些 hex 值與 `--ab-*` token 值逐字相同**（同一 Hi-Fi 設計萃取），置換後像素不變。
- `index.html:18-21` 已載入與授權檔 `@import` 完全相同的 Google Fonts（Noto Sans TC 400/500/700 + JetBrains Mono 400/600）→ 授權檔的 `@import` 冗餘但無害，**原樣保留**。
- Pixel gate 機理：golden baseline 由 `capture-design-system-reference.mjs` 從 **authoring origin**（`C:\Repos\design\desigin-system`，靜態伺服）擷取；`design-system-visual.spec.ts` 把 production build（`npm run preview` :5182）截圖與 origin baseline 以 pixelmatch 比對（color_threshold 0.1 / max_diff_pixel_ratio 0.01）。13 screens 全是 UnifiedConsole 頁（home/a1-a4 workspace/pipeline/ops/a5-a10 concept）——**legacy 頁不在 pixel 基準內**，品牌換色不影響 gate；unified 頁值恆等置換 → gate 持續綠。origin 未變 → `--rebaseline` 產出理應與現行一致（spec §8「26 基準全作廢」的預期在此機理下不會發生，照跑 rebaseline 滿足條文即可，結果如實揭露）。
- `manifest.token_projection.production_projection` 目前值 = `"web-viewer-sample/src/console/edge-console.css"`；`verify-design-system-reference.ps1` **只驗 order 與 boolean，不驗此字串值** → 可安全改指新權威。
- 測試綁定：`IntentDialog.css.test.ts` 直讀 `src/console/edge-console.css` 斷言 5 個 modal selector 存在（`.ec-modal-backdrop`/`.ec-modal`/`.ec-modal-actions`/`.ec-field-k`/`.ec-input`）+ backdrop fixed/z-index；`ConversionPage.test.tsx:191-194` 斷言 `.ec-status-dot[data-status=…]` **class 名**（不綁色值）；unified 測試與 e2e **零 hex 斷言**（已 grep 驗證）。
- GitNexus impact 預掃：FTS 索引降級（查詢回空），以 codebase-memory + 直接 grep 交叉完成。唯一被修改的共享 symbol 為 `LegacyEdgeConsole`（`EdgeConsole` default export 介面不變）；其餘全是 CSS 檔與元件內 inline style 值 → blast radius 為視覺層，無 API/事件面。
- **前置安裝（Task 1 之前一次性執行；已實測為必要）**：本 linked worktree 的 `web-viewer-sample/` 與 `bim-review-coordinator/` **皆無** `node_modules`（git worktree 不共用 main checkout 的安裝；已驗證 `ls -d node_modules` 兩處皆失敗），但兩處 `package.json` 與 tracked `package-lock.json` 都在。**執行任何 task（含 Task 1 Step 2）之前**，於兩個目錄各安裝一次依賴：
  ```powershell
  # cwd: <repo>/bim-review-coordinator
  npm ci
  # cwd: <repo>/web-viewer-sample
  npm ci
  ```
  優先用 `npm ci`——精確自 lockfile 安裝、**不改寫** `package-lock.json`，契合下方 Global Constraints「不動 `package-lock.json`」；若 `npm ci` 因 lockfile 與 `package.json` 不同步而報錯，改跑 `npm install --no-audit --no-fund`，其 lockfile 變更**不納入本 change 的任何 commit**。略過此步的後果不只是「多一步」：Task 1 Step 2 起、之後每個 task 的第一條指令（`npx vitest run …` / `npm run typecheck` / `npm run build` / `npx playwright test …`，以及 Task 9 harness 解析的 `bim-review-coordinator/node_modules/.bin/tsx.cmd`）會**先因缺依賴**以 `'vitest' 不是內部或外部命令 / Cannot find module` 失敗——這**不是**各步標註的「Expected: FAIL（特定斷言全紅）」的 TDD red，**不得**誤判為「TDD red 已達成」而繼續往下。

## Global Constraints（每個 task 隱含適用）

- SHALL NOT 修改 `openspec/specs/unified-governance-console/**`、`openspec/specs/edge-console-operator-frontend/**`、`openspec/changes/align-frontend-design-system-reference/**` 任一檔案本體。
- SHALL NOT 修改雙閘機制檔：`web-viewer-sample/scripts/capture-design-system-reference.mjs`、`scripts/tests/verify-design-system-reference.ps1`、`scripts/lib/design-system-gate.ps1`、`web-viewer-sample/e2e/design-system-visual.spec.ts`、`design-system-semantic-cases.ts`。
- SHALL NOT 新增/移除/改變任何 coordinator / governance-service API 呼叫；前端仍只打 coordinator `:8004`；provenance 誠實標記逐字不變。
- `ai-bim-governance.css` SHALL 被真實 import；SHALL NOT 手抄色碼到 inline style 或另一份 CSS。缺口 token 一律**延伸授權檔本體**（`--ab-` 前綴、沿既有命名慣例），SHALL NOT 回頭消費 `--ec-`。
- 置換規則：十六進位色碼一律換 `var(--ab-*)`；`rgba()` 字面值可保留（與授權檔內部寫法一致），**但品牌綠系 `rgba(118,185,0,α)` 必換青系**（同 α：`rgba(65,199,232,α)` 或對應 soft token）。
- 完成定義（機器可驗）：`grep -rn -- "--ec-" web-viewer-sample/src` 無輸出（＝spec §6.5 的「`grep -rc` 全 0」，且 `edge-console.css` 已刪除故無例外）；`console/unified/` 內 `#[0-9a-fA-F]{6}` 色碼歸零。
- 工具 pin（rebaseline/visual gate 環境）：Playwright 1.61.1 / Chromium 149.0.7827.55 / Node 20.20.2 / npm 10.9.4 / Windows；不動 `package-lock.json` 的 visual 依賴。
- 所有指令 cwd 註明；`web-viewer-sample` 指 `<repo>/web-viewer-sample`，`<repo>` = 本 worktree 根（`.worktrees/migrate-console-to-hifi-design`）。
- YAGNI：不新增 spec 未要求的功能、不動 A4–A10 後端、不重構無關程式。

## 全域 token 對照表（Task 1 產出、Task 2–7 消費；值恆等除非標註「品牌轉向」）

| `--ec-*`（值） | 換成 | 備註 |
|---|---|---|
| `--ec-bg` #0b0d10 | `var(--ab-bg)` #060a10 | 品牌轉向（更深） |
| `--ec-bg-2` #111418 | `var(--ab-bar)` #0a1018 | 品牌轉向 |
| `--ec-bg-3` #15191e | `var(--ab-inset)` #0a1220 | 品牌轉向 |
| `--ec-panel` #181c21 | `var(--ab-surface)` #0e1621 | 品牌轉向 |
| `--ec-panel-hi` #1d2329 | `var(--ab-raised)` #101d2c | 品牌轉向 |
| `--ec-line` #262c33 | `var(--ab-border)` | 品牌轉向 |
| `--ec-line-2` #2f363f | `var(--ab-border-strong)` | 品牌轉向 |
| `--ec-fg` #e7ebf0 | `var(--ab-text)` #dbe6f3 | 品牌轉向 |
| `--ec-fg-2` #b8c0c9 | `var(--ab-text-2)` #b9c9da | 品牌轉向 |
| `--ec-fg-3` #7d8794 | `var(--ab-text-muted)` #8aa0b8 | 品牌轉向 |
| `--ec-fg-4` #545d68 | `var(--ab-text-dim)` #5a7089 | 品牌轉向 |
| `--ec-grn` #76b900 | `var(--ab-accent)` #41c7e8 | **品牌主色轉向** |
| `--ec-grn-2` | `var(--ab-accent-soft)` | Task 1 新增 |
| `--ec-grn-3` | `var(--ab-accent-strong)` | Task 1 新增 |
| `--ec-cyan` #4dd0e1 | `var(--ab-info)` #41c7e8 | 收斂 |
| `--ec-cyan-2` | `var(--ab-info-soft)` | Task 1 新增 |
| `--ec-amb` #f4b740 | `var(--ab-warn)` #e6b23e | 品牌轉向 |
| `--ec-amb-2` | `var(--ab-warn-soft)` | Task 1 新增 |
| `--ec-red` #ef5350 | `var(--ab-danger)` #e8615c | 品牌轉向 |
| `--ec-red-2` | `var(--ab-danger-soft)` | Task 1 新增 |
| `--ec-vio` #b388ff | `var(--ab-violet)` #9d8cff | 品牌轉向 |
| `--ec-vio-2` | `var(--ab-violet-soft)` | Task 1 新增 |
| `--ec-mono` | `var(--ab-mono)` | 字族換 JetBrains Mono 首位 |
| `--ec-sans` | `var(--ab-font)` | 字族換 Noto Sans TC 首位 |
| `--ec-r-xs` 6px | `var(--ab-r-sm)` 6px | 恆等 |
| `--ec-r-sm` 10px | `var(--ab-r-lg)` 10px | 恆等 |
| `--ec-r` 14px | `var(--ab-r-2xl)` 14px | 恆等 |
| `--ec-r-pill` | `var(--ab-r-pill)` | 恆等 |
| `--ec-sp-1` 4px | `var(--ab-space-1)` 4px | 恆等 |
| `--ec-sp-2` 8px | `var(--ab-space-3)` 8px | 恆等 |
| `--ec-sp-3` 12px | `var(--ab-space-5)` 12px | 恆等 |
| `--ec-sp-4` 16px | `var(--ab-space-6)` 16px | 恆等 |
| `--ec-sp-5` 20px | `var(--ab-space-7)` 22px | 有意識 +2px（legacy 頁允許視覺改變） |
| `--ec-sp-6` 24px | `var(--ab-space-8)` 26px | 有意識 +2px |
| `--ec-sp-8` 32px | `var(--ab-space-9)` 32px | Task 1 新增 |
| `--ec-shadow-1` | `var(--ab-shadow-card)` | Task 1 新增（同值） |
| `--ec-shadow-2` | `var(--ab-shadow-pop)` | 語意同級 |
| `--ec-glow-grn` | `var(--ab-glow-accent)` | 綠光→青光 |
| `--ec-ease`/`--ec-dur-fast`/`--ec-dur`/`--ec-dur-slow` | `var(--ab-ease)`/`var(--ab-dur-fast)`/`var(--ab-dur)`/`var(--ab-dur-slow)` | Task 1 新增（同值） |
| `--ec-track-label`/`--ec-track-tag` | `var(--ab-track-label)`/`var(--ab-track-tag)` | Task 1 新增（同值） |
| `--ec-on-grn` #0b0d10 | `var(--ab-on-accent)` #04121a | 品牌轉向 |
| `--ec-fs-page` 27px …`--ec-fs-mono` 11px | `var(--ab-fs-page)` …`var(--ab-fs-mono)` | Task 1 新增（同值 ×7） |
| `--ec-accent`（未定義，fallback #7fd962；`edge-console.css:505`） | `var(--ab-accent)` | 修掉幽靈 token |

---

### Task 1: Token 覆蓋率盤點 + 缺口 token + 授權檔真實 import（spec §6.1）

**Files:**
- Modify: `docs/plans/ai-bim-governance.css`（追加缺口 token 於 `:root` 塊尾、95 行 `--ab-glow-accent` 之後）
- Modify: `web-viewer-sample/src/console/EdgeConsole.tsx:8`（加 import）
- Modify: `web-viewer-sample/vite.config.ts`（dev server fs.allow）
- Test: `web-viewer-sample/src/console/design-token-authority.test.ts`（新建）

**Interfaces:**
- Consumes: 無（首 task）。
- Produces: `:root` 全域可用的 `--ab-*` token 全集（原 60 個 + 下列 24 個新 token），後續全部 task 以 `var(--ab-…)` 消費；`EdgeConsole.tsx` 頂部存在 `import "../../../docs/plans/ai-bim-governance.css";`。

- [ ] **Step 1: 寫失敗測試**（模式仿 `IntentDialog.css.test.ts` 的靜態存在性把關）

建立 `web-viewer-sample/src/console/design-token-authority.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// console-design-token-authority spec R1：ai-bim-governance.css 為唯一 production design
// token 權威，SHALL 真實 import（vitest cwd = web-viewer-sample）。jsdom 不算 layout，
// 故以靜態存在性把關：import 邊、token 定義邊各驗一半。
const authorityCss = readFileSync(
  resolve(process.cwd(), "..", "docs", "plans", "ai-bim-governance.css"),
  "utf8",
);
const edgeConsoleTsx = readFileSync(
  resolve(process.cwd(), "src", "console", "EdgeConsole.tsx"),
  "utf8",
);

describe("ai-bim-governance.css 是被真實 import 的唯一 token 權威", () => {
  it("EdgeConsole.tsx import 授權檔（相對路徑指向 docs/plans 正本，不是副本）", () => {
    expect(edgeConsoleTsx).toContain('import "../../../docs/plans/ai-bim-governance.css"');
  });

  it.each([
    "--ab-accent-soft",
    "--ab-accent-strong",
    "--ab-info-soft",
    "--ab-warn-soft",
    "--ab-danger-soft",
    "--ab-violet-soft",
    "--ab-ok-soft",
    "--ab-space-9",
    "--ab-shadow-card",
    "--ab-ease",
    "--ab-dur-fast",
    "--ab-dur",
    "--ab-dur-slow",
    "--ab-track-label",
    "--ab-track-tag",
    "--ab-fs-page",
    "--ab-fs-h2",
    "--ab-fs-h3",
    "--ab-fs-body",
    "--ab-fs-sm",
    "--ab-fs-xs",
    "--ab-fs-mono",
    "--ab-scroll-thumb",
    "--ab-scroll-thumb-hover",
  ])("缺口 token %s 已定義於授權檔", (token) => {
    expect(authorityCss).toContain(`${token}:`);
  });

  it("核心 token 值未被漂移（權威值凍結）", () => {
    expect(authorityCss).toContain("--ab-bg:            #060a10");
    expect(authorityCss).toContain("--ab-accent:        #41c7e8");
    expect(authorityCss).toContain("--ab-accent-2:      #2f7bf6");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
# cwd: <repo>/web-viewer-sample
npx vitest run src/console/design-token-authority.test.ts
```
Expected: FAIL（import 邊 1 條 + 缺口 token 24 條全紅；「核心 token 值」1 條綠）。

- [ ] **Step 3: 盤點覆蓋率（census 證據，不猜）**

```powershell
# cwd: <repo>
grep -o -- "--ec-[a-z0-9-]*" web-viewer-sample/src/console/edge-console.css | sort -u
grep -o -- "--ab-[a-z0-9-]*" docs/plans/ai-bim-governance.css | sort -u
```
Expected: `--ec-` 唯一名 ≈ 40 個；`--ab-` 唯一名 ≈ 60 個。逐項核對本 plan「全域 token 對照表」左欄是否涵蓋全部 `--ec-` 唯一名——若出現表外名稱，依同語意規則補進對照表與 Step 4 的缺口塊（維持 `--ab-` 前綴 + 語意命名），並同步加進 Step 1 測試清單。

- [ ] **Step 4: 延伸授權檔——在 `docs/plans/ai-bim-governance.css` 的 `--ab-glow-accent` 行（95 行）後、`}` 之前追加**

```css

  /* ── Legacy console 遷移缺口 token（migrate-console-to-hifi-design §6.1）──
     soft = 半透明底色（承接 --ec-*-2 用途）；strong = 高透明強調（承接 --ec-grn-3）。 */
  --ab-accent-soft:   rgba(65,199,232,.14);
  --ab-accent-strong: rgba(65,199,232,.32);
  --ab-info-soft:     rgba(65,199,232,.12);
  --ab-warn-soft:     rgba(230,178,62,.14);
  --ab-danger-soft:   rgba(232,97,92,.16);
  --ab-violet-soft:   rgba(157,140,255,.16);
  --ab-ok-soft:       rgba(49,197,109,.14);

  /* Spacing 延伸（--ec-sp-8 承接） */
  --ab-space-9: 32px;

  /* Elevation 延伸（--ec-shadow-1 承接：卡片微陰影） */
  --ab-shadow-card: 0 1px 2px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.04);

  /* Motion（--ec-ease / dur 承接） */
  --ab-ease: cubic-bezier(.4,0,.2,1);
  --ab-dur-fast: .13s;
  --ab-dur: .2s;
  --ab-dur-slow: .3s;

  /* Tracking（--ec-track-* 承接） */
  --ab-track-label: .12em;
  --ab-track-tag: .06em;

  /* Font-size 階（--ec-fs-* 承接） */
  --ab-fs-page: 27px;
  --ab-fs-h2: 21px;
  --ab-fs-h3: 16px;
  --ab-fs-body: 15px;
  --ab-fs-sm: 13px;
  --ab-fs-xs: 12px;
  --ab-fs-mono: 11px;

  /* Scrollbar（unified.css 全域 scrollbar 承接；.ab-app 內硬寫值的 token 化來源） */
  --ab-scroll-thumb: #1c2a3c;
  --ab-scroll-thumb-hover: #28394f;
```

（授權檔既有內容一字不動：`@import` Google Fonts 保留——`index.html:18-21` 已載入同組字型，行為不變且離線時兩處一起 fallback，具決定性。）

- [ ] **Step 5: 接上 import——`web-viewer-sample/src/console/EdgeConsole.tsx:8` 改為**

```ts
// Design token 權威（console-design-token-authority）：docs/plans/ai-bim-governance.css 正本
// 真實 import（token 定義在 :root，全站 var(--ab-*) 可用）；SHALL NOT 手抄色碼副本。
import "../../../docs/plans/ai-bim-governance.css";
import "./edge-console.css";
```

- [ ] **Step 6: dev server 放行 repo 根 docs/plans（build/preview 不受影響，僅 `npm run dev` 需要）——`web-viewer-sample/vite.config.ts` 的 `defineConfig({...})` 內、`plugins` 之後加**

```ts
    server: {
        fs: {
            // design token 權威在 repo 根 docs/plans/（vite root 之外）；dev server 需顯式放行。
            allow: [".", "../docs/plans"],
        },
    },
```

- [ ] **Step 7: 跑測試確認通過 + build 煙測**

```powershell
# cwd: <repo>/web-viewer-sample
npx vitest run src/console/design-token-authority.test.ts
npm run build
```
Expected: 測試全綠；`vite build` 成功（bundle CSS 內含 `--ab-accent:#41c7e8`，可用 `grep -l "ab-accent" dist/assets/*.css` 抽查得到 1 檔）。

- [ ] **Step 8: Commit**

```powershell
# cwd: <repo>
git add docs/plans/ai-bim-governance.css web-viewer-sample/src/console/EdgeConsole.tsx web-viewer-sample/vite.config.ts web-viewer-sample/src/console/design-token-authority.test.ts
git commit -m "feat(console): ai-bim-governance.css 真實 import + 缺口 token 盤點延伸（§6.1）"
```

---

### Task 2: UnifiedConsole 收斂 (a) — unified.css + UnifiedShell + HomePage（spec §6.2）

**Files:**
- Modify: `web-viewer-sample/src/console/unified/unified.css`
- Modify: `web-viewer-sample/src/console/unified/UnifiedShell.tsx`
- Modify: `web-viewer-sample/src/console/unified/HomePage.tsx`

**Interfaces:**
- Consumes: Task 1 的 `:root` `--ab-*` token 全集。
- Produces: 三檔零 hex 色碼；渲染值恆等（visual gate 於 Task 4 綜合驗證）。

- [ ] **Step 1: 基準——記錄置換前 hex 數與測試綠**

```powershell
# cwd: <repo>/web-viewer-sample
grep -c "#[0-9a-fA-F]\{6\}" src/console/unified/unified.css src/console/unified/UnifiedShell.tsx src/console/unified/HomePage.tsx
npx vitest run src/console/unified/unified.test.tsx
```
Expected: 計數約 `8 / 27 / 20`；unified.test.tsx 綠（基準）。

- [ ] **Step 2: 值恆等批次置換（unified 全 task 共用對照；本 task 先套用於三檔）**

```powershell
# cwd: <repo>/web-viewer-sample
$map = [ordered]@{
  '#060a10' = 'var(--ab-bg)';        '#070b12' = 'var(--ab-bg-alt)';
  '#05080d' = 'var(--ab-black)';     '#0a1018' = 'var(--ab-bar)';
  '#0c1219' = 'var(--ab-panel)';     '#0e1621' = 'var(--ab-surface)';
  '#0a1220' = 'var(--ab-inset)';     '#101d2c' = 'var(--ab-raised)';
  '#dbe6f3' = 'var(--ab-text)';      '#b9c9da' = 'var(--ab-text-2)';
  '#8aa0b8' = 'var(--ab-text-muted)';'#5a7089' = 'var(--ab-text-dim)';
  '#4d6076' = 'var(--ab-text-dimmer)';'#3d5570' = 'var(--ab-text-faint)';
  '#5a8db0' = 'var(--ab-text-code)'; '#41c7e8' = 'var(--ab-accent)';
  '#2f7bf6' = 'var(--ab-accent-2)';  '#6fd6ee' = 'var(--ab-accent-text)';
  '#7adcf2' = 'var(--ab-accent-bright)'; '#04121a' = 'var(--ab-on-accent)';
  '#31c56d' = 'var(--ab-ok)';        '#4fd68a' = 'var(--ab-ok-text)';
  '#e8615c' = 'var(--ab-danger)';    '#e6b23e' = 'var(--ab-warn)';
  '#e8d35c' = 'var(--ab-caution)';   '#9d8cff' = 'var(--ab-violet)';
  '#b7a9ff' = 'var(--ab-violet-text)'; '#e8925c' = 'var(--ab-arch)';
  '#1c2a3c' = 'var(--ab-scroll-thumb)'; '#28394f' = 'var(--ab-scroll-thumb-hover)';
}
foreach ($f in @('src/console/unified/unified.css','src/console/unified/UnifiedShell.tsx','src/console/unified/HomePage.tsx')) {
  $text = Get-Content -LiteralPath $f -Raw
  foreach ($k in $map.Keys) { $text = $text.Replace($k, $map[$k]) }
  Set-Content -LiteralPath $f -Value $text -NoNewline
}
```

- [ ] **Step 3: 殘餘 hex 人工歸零（表外值＝census 缺口）**

```powershell
# cwd: <repo>/web-viewer-sample
grep -n "#[0-9a-fA-F]\{6\}" src/console/unified/unified.css src/console/unified/UnifiedShell.tsx src/console/unified/HomePage.tsx
```
Expected: 0 行。若有殘餘：該 hex 是對照表外的值——回 Task 1 模式處理（在 `docs/plans/ai-bim-governance.css` 缺口塊補一個同值 `--ab-*` token + 補進 `design-token-authority.test.ts` 清單），再以 `var(--ab-新名)` 置換，不許留 hex、不許改渲染值。

- [ ] **Step 4: 驗證恆等與測試綠**

```powershell
# cwd: <repo>/web-viewer-sample
npm run typecheck
npx vitest run src/console/unified/unified.test.tsx src/console/design-token-authority.test.ts
```
Expected: 全綠（unified.test.tsx 斷言 text/testid，不綁色值——已驗證零 hex 斷言）。

- [ ] **Step 5: Commit**

```powershell
# cwd: <repo>
git add web-viewer-sample/src/console/unified/unified.css web-viewer-sample/src/console/unified/UnifiedShell.tsx web-viewer-sample/src/console/unified/HomePage.tsx docs/plans/ai-bim-governance.css web-viewer-sample/src/console/design-token-authority.test.ts
git commit -m "refactor(console): unified.css/UnifiedShell/HomePage inline hex → var(--ab-*)（§6.2，值恆等）"
```
（若 Step 3 無缺口，`docs/plans/ai-bim-governance.css` 與測試檔無 diff，git add 照列不影響。）

---

### Task 3: UnifiedConsole 收斂 (b) — WorkspacePage + docks + fixtures（spec §6.2）

**Files:**
- Modify: `web-viewer-sample/src/console/unified/WorkspacePage.tsx`
- Modify: `web-viewer-sample/src/console/unified/docks.tsx`
- Modify: `web-viewer-sample/src/console/unified/fixtures.ts`

**Interfaces:**
- Consumes: Task 1 token 全集；Task 2 的置換對照 `$map`（本 task 重複定義同一份，勿引用他檔）。
- Produces: 三檔零 hex；`fixtures.ts` 匯出的顏色欄位（`ACCENT`、discipline/severity/diff 色組的 hex 成員）改為 `var(--ab-*)` 字串，型別不變（string）。

- [ ] **Step 1: 基準 + 消費位置安全檢查（防 var() 進非 CSS 情境）**

```powershell
# cwd: <repo>/web-viewer-sample
grep -c "#[0-9a-fA-F]\{6\}" src/console/unified/WorkspacePage.tsx src/console/unified/docks.tsx src/console/unified/fixtures.ts
grep -n "ACCENT\|DISCIPLINE\|SEVERITY" src/console/unified/*.tsx | grep -v "style\|color\|background\|border" | head
npx vitest run src/console/unified/unified.test.tsx src/console/unified/dockLiveLink.test.tsx
```
Expected: 計數約 `27 / 55 / 26`；第二個 grep 應為空（所有顏色消費都在 style/color/background/border 上下文——`var()` 在 inline style 合法）。**若出現 SVG `fill=` 屬性位或 canvas 用法**：該處改寫為 `style={{ fill: … }}` 形式再置換（`fill` 屬性不解析 `var()`，style 屬性可以）。兩個測試檔綠（基準）。

- [ ] **Step 2: 套用與 Task 2 完全相同的 `$map` 置換（重複貼上該 PowerShell 區塊，`$f` 清單換成本 task 三檔）**

```powershell
# cwd: <repo>/web-viewer-sample
$map = [ordered]@{
  '#060a10' = 'var(--ab-bg)';        '#070b12' = 'var(--ab-bg-alt)';
  '#05080d' = 'var(--ab-black)';     '#0a1018' = 'var(--ab-bar)';
  '#0c1219' = 'var(--ab-panel)';     '#0e1621' = 'var(--ab-surface)';
  '#0a1220' = 'var(--ab-inset)';     '#101d2c' = 'var(--ab-raised)';
  '#dbe6f3' = 'var(--ab-text)';      '#b9c9da' = 'var(--ab-text-2)';
  '#8aa0b8' = 'var(--ab-text-muted)';'#5a7089' = 'var(--ab-text-dim)';
  '#4d6076' = 'var(--ab-text-dimmer)';'#3d5570' = 'var(--ab-text-faint)';
  '#5a8db0' = 'var(--ab-text-code)'; '#41c7e8' = 'var(--ab-accent)';
  '#2f7bf6' = 'var(--ab-accent-2)';  '#6fd6ee' = 'var(--ab-accent-text)';
  '#7adcf2' = 'var(--ab-accent-bright)'; '#04121a' = 'var(--ab-on-accent)';
  '#31c56d' = 'var(--ab-ok)';        '#4fd68a' = 'var(--ab-ok-text)';
  '#e8615c' = 'var(--ab-danger)';    '#e6b23e' = 'var(--ab-warn)';
  '#e8d35c' = 'var(--ab-caution)';   '#9d8cff' = 'var(--ab-violet)';
  '#b7a9ff' = 'var(--ab-violet-text)'; '#e8925c' = 'var(--ab-arch)';
  '#1c2a3c' = 'var(--ab-scroll-thumb)'; '#28394f' = 'var(--ab-scroll-thumb-hover)';
}
foreach ($f in @('src/console/unified/WorkspacePage.tsx','src/console/unified/docks.tsx','src/console/unified/fixtures.ts')) {
  $text = Get-Content -LiteralPath $f -Raw
  foreach ($k in $map.Keys) { $text = $text.Replace($k, $map[$k]) }
  Set-Content -LiteralPath $f -Value $text -NoNewline
}
```
備註：`fixtures.ts` 內 `["#e8615c", "rgba(232,97,92"]` 這類「hex + rgba 前綴」配對只換 hex 成員；rgba 前綴（供組合 α）保留——非 hex 且值不變。

- [ ] **Step 3: 殘餘 hex 歸零（同 Task 2 Step 3 規則：表外值→補缺口 token）**

```powershell
# cwd: <repo>/web-viewer-sample
grep -n "#[0-9a-fA-F]\{6\}" src/console/unified/WorkspacePage.tsx src/console/unified/docks.tsx src/console/unified/fixtures.ts
```
Expected: 0 行。

- [ ] **Step 4: 驗證**

```powershell
# cwd: <repo>/web-viewer-sample
npm run typecheck
npx vitest run src/console/unified/unified.test.tsx src/console/unified/dockLiveLink.test.tsx
```
Expected: 全綠。

- [ ] **Step 5: Commit**

```powershell
# cwd: <repo>
git add web-viewer-sample/src/console/unified/WorkspacePage.tsx web-viewer-sample/src/console/unified/docks.tsx web-viewer-sample/src/console/unified/fixtures.ts docs/plans/ai-bim-governance.css web-viewer-sample/src/console/design-token-authority.test.ts
git commit -m "refactor(console): WorkspacePage/docks/fixtures inline hex → var(--ab-*)（§6.2，值恆等）"
```

---

### Task 4: UnifiedConsole 收斂 (c) — Pipeline/Ops/Concept + 13 screens 視覺零漂移證明（spec §6.2 收尾）

**Files:**
- Modify: `web-viewer-sample/src/console/unified/PipelinePage.tsx`
- Modify: `web-viewer-sample/src/console/unified/OpsPage.tsx`
- Modify: `web-viewer-sample/src/console/unified/ConceptPage.tsx`

**Interfaces:**
- Consumes: Task 1 token 全集；同一份 `$map`。
- Produces: `console/unified/` 全目錄 hex 歸零；**visual gate（13 screens × 2 viewports，pixelmatch vs origin baseline）通過**＝「僅允許樣式相關差異、且 unified 頁實際零漂移」的機器證明。

- [ ] **Step 1: 基準**

```powershell
# cwd: <repo>/web-viewer-sample
grep -c "#[0-9a-fA-F]\{6\}" src/console/unified/PipelinePage.tsx src/console/unified/OpsPage.tsx src/console/unified/ConceptPage.tsx
```
Expected: 約 `40 / 19 / 10`。

- [ ] **Step 2: 套用同一份 `$map` 置換（重複 Task 2 Step 2 的 PowerShell 區塊，`$f` 清單換成本 task 三檔）**

```powershell
# cwd: <repo>/web-viewer-sample
$map = [ordered]@{
  '#060a10' = 'var(--ab-bg)';        '#070b12' = 'var(--ab-bg-alt)';
  '#05080d' = 'var(--ab-black)';     '#0a1018' = 'var(--ab-bar)';
  '#0c1219' = 'var(--ab-panel)';     '#0e1621' = 'var(--ab-surface)';
  '#0a1220' = 'var(--ab-inset)';     '#101d2c' = 'var(--ab-raised)';
  '#dbe6f3' = 'var(--ab-text)';      '#b9c9da' = 'var(--ab-text-2)';
  '#8aa0b8' = 'var(--ab-text-muted)';'#5a7089' = 'var(--ab-text-dim)';
  '#4d6076' = 'var(--ab-text-dimmer)';'#3d5570' = 'var(--ab-text-faint)';
  '#5a8db0' = 'var(--ab-text-code)'; '#41c7e8' = 'var(--ab-accent)';
  '#2f7bf6' = 'var(--ab-accent-2)';  '#6fd6ee' = 'var(--ab-accent-text)';
  '#7adcf2' = 'var(--ab-accent-bright)'; '#04121a' = 'var(--ab-on-accent)';
  '#31c56d' = 'var(--ab-ok)';        '#4fd68a' = 'var(--ab-ok-text)';
  '#e8615c' = 'var(--ab-danger)';    '#e6b23e' = 'var(--ab-warn)';
  '#e8d35c' = 'var(--ab-caution)';   '#9d8cff' = 'var(--ab-violet)';
  '#b7a9ff' = 'var(--ab-violet-text)'; '#e8925c' = 'var(--ab-arch)';
  '#1c2a3c' = 'var(--ab-scroll-thumb)'; '#28394f' = 'var(--ab-scroll-thumb-hover)';
}
foreach ($f in @('src/console/unified/PipelinePage.tsx','src/console/unified/OpsPage.tsx','src/console/unified/ConceptPage.tsx')) {
  $text = Get-Content -LiteralPath $f -Raw
  foreach ($k in $map.Keys) { $text = $text.Replace($k, $map[$k]) }
  Set-Content -LiteralPath $f -Value $text -NoNewline
}
```

- [ ] **Step 3: 全目錄 hex 歸零 gate**

```powershell
# cwd: <repo>/web-viewer-sample
grep -rn "#[0-9a-fA-F]\{6\}" src/console/unified/
```
Expected: 0 行（表外值處理規則同 Task 2 Step 3）。

- [ ] **Step 4: jsdom 全套 + typecheck**

```powershell
# cwd: <repo>/web-viewer-sample
npm run typecheck
npx vitest run src/console/unified/
```
Expected: 全綠。

- [ ] **Step 5: 跑既有 visual gate（production build vs origin golden baseline）——「13 approved screens 視覺無 regression」的機器證明**

```powershell
# cwd: <repo>/web-viewer-sample
npm run test:visual:design-system
```
Expected: PASS（26 比對全過；diff ratio ≦ 0.01 上限、實際應為 0）。FAIL 即代表某個置換非值恆等——用報告 `../artifacts/e2e/design-system-visual/report` 找到該 screen，比對該頁面檔的置換項修正後重跑；**禁止**動 baseline 或 threshold 來過關。

- [ ] **Step 6: 既有 browser E2E（unified 路由行為不變；用本 task 已建好的 production bundle 起分支 coordinator，不碰部署區 :8004）**

```powershell
# cwd: <repo>/web-viewer-sample
npm run build:ui
# 新開第二個終端起分支 coordinator（cwd: <repo>/bim-review-coordinator）：
#   $env:PORT="8007"; $env:HOST="127.0.0.1"; $env:CONSOLE_DIST_DIR="<repo>\web-viewer-sample\dist-ui"; npx tsx src/index.ts
# 等 http://127.0.0.1:8007/health 回 200 後，回本終端：
$env:E2E_DISABLE_WEBSERVER = "1"
$env:E2E_COORDINATOR_BASE_URL = "http://127.0.0.1:8007"
npx playwright test unified-console-routes.spec.ts
```
Expected: PASS。跑完停掉 8007 的 coordinator 行程。

- [ ] **Step 7: Commit**

```powershell
# cwd: <repo>
git add web-viewer-sample/src/console/unified/PipelinePage.tsx web-viewer-sample/src/console/unified/OpsPage.tsx web-viewer-sample/src/console/unified/ConceptPage.tsx docs/plans/ai-bim-governance.css web-viewer-sample/src/console/design-token-authority.test.ts
git commit -m "refactor(console): Pipeline/Ops/Concept hex → var(--ab-*) + 13 screens visual gate 零漂移證明（§6.2 收尾）"
```

---

### Task 5: Legacy 消費點遷移 — overlay.css / viewer.css / pages.tsx / 零星 inline hex（spec §6.3 前半）

**Files:**
- Modify: `web-viewer-sample/src/console/governance/overlay.css`
- Modify: `web-viewer-sample/src/console/viewer/viewer.css`
- Modify: `web-viewer-sample/src/console/pages.tsx`（5 處 inline `var(--ec-*)`）
- Modify: `web-viewer-sample/src/console/RealIfcConsolePage.tsx`（135/158/165 行）
- Modify: `web-viewer-sample/src/console/KitConsolePage.tsx`（57/62 行）
- Modify: `web-viewer-sample/src/console/EmbeddedViewer.tsx`（144 行）

**Interfaces:**
- Consumes: Task 1 token 全集（`--ab-*` 於 `:root` 定義 → overlay 掛在 `.ec-root` 之外也解析得到）。**Task 5 fix 追記（實作後校正）**：`viewer/viewer.css` 的本地 `--ec-` 可整塊刪除；但 `governance/overlay.css` **不可**——`GovernanceOverlay.tsx` 仍渲染 `.ec-btn`/`.ec-note`/`.ec-warn-note`/`.ec-cap`/`.ec-table` 等 legacy class，其規則（在 `edge-console.css`，全域 selector）消費 `var(--ec-*)`，而 `--ec-*` 只定義於 `.ec-root`；`.gov-overlay` 掛在 `.ec-root` 之外，整塊刪除會令這些 var 於 overlay 內無法解析（治理面板失色迴歸，已由 browser E2E `e2e/overlay-ec-token-resolution.spec.ts` 抓到並修）。故保留一份薄的 `--ec-* → var(--ab-*)` 相容 shim，待 Task 7 把 `.ec-*` 規則的 `var(--ec-*)` 機械移植成 `var(--ab-*)`（`:root` 全域解析）後即成 dead code，於 Task 7 一併移除。
- Produces: `viewer/viewer.css` 零 `--ec-`、零品牌綠；`governance/overlay.css` 零品牌綠、零硬寫 hex，但**保留一份過渡 shim**（`--ec-*` 值全部轉接 `var(--ab-*)`，非硬寫色）。本 task 完成後 `grep -rln -- "--ec-" web-viewer-sample/src` 回傳 `edge-console.css` 與 `governance/overlay.css` 兩檔；`--ec-` 全域歸零由 Task 7 收尾（見 Task 7 Files／Step 3(d)／Step 6）。品牌色在 legacy 頁面**可見地**由綠轉青（本 change 的目的）。

- [ ] **Step 1: 基準（既有行為測試綠）**

```powershell
# cwd: <repo>/web-viewer-sample
npx vitest run src/console/GovernanceOverlay.test.tsx src/console/viewer/ src/console/ConversionPage.test.tsx
```
Expected: 綠（這些測試斷言 testid/class 名/文字，不綁色值）。

- [ ] **Step 2: `governance/overlay.css` — hex→var、品牌綠轉青。**（⚠ **Task 5 fix**：以下「整塊刪除本地 `--ec-` 副本」原案會觸發 `.gov-overlay` 治理面板失色迴歸，**勿照抄**；實際交付保留一份 `--ec-* → var(--ab-*)` shim，見本 Step 末「Task 5 fix 追記」與現行檔案。）原案 1-20 行換成：

```css
/* web-viewer-sample/src/console/governance/overlay.css
 * A1–A10 治理 overlay 容器：疊在 primary viewer live 3D 右側。
 * 消費 ai-bim-governance.css 的 --ab-* token（:root 全域定義，overlay 掛在 .ec-root 之外也解析得到；
 * 原本地 --ec-* 定義副本已隨 migrate-console-to-hifi-design 移除）。 */
.gov-overlay {
  position: absolute; top: 0; right: 0; width: 340px; height: 100%;
  background: rgba(11, 13, 16, 0.92); color: var(--ab-text);
  border-left: 1px solid var(--ab-border); overflow-y: auto; padding: 12px;
  font: 13px/1.5 var(--ab-mono); z-index: 20;
}
```

其餘行以逐值置換收尾（PowerShell，注意順序——先長字串後短字串不必要，值互不包含）：

```powershell
# cwd: <repo>/web-viewer-sample
$f = 'src/console/governance/overlay.css'
$text = Get-Content -LiteralPath $f -Raw
$repl = [ordered]@{
  '#e7ebf0' = 'var(--ab-text)';
  '#262c33' = 'var(--ab-border)';
  '#2f363f' = 'var(--ab-border-strong)';
  '#76b900' = 'var(--ab-accent)';
  '#545d68' = 'var(--ab-text-dim)';
  '#f4b740' = 'var(--ab-warn)';
  'rgba(244, 183, 64, .14)' = 'var(--ab-warn-soft)';
}
foreach ($k in $repl.Keys) { $text = $text.Replace($k, $repl[$k]) }
Set-Content -LiteralPath $f -Value $text -NoNewline
grep -n -- "--ec-\|#[0-9a-fA-F]\{6\}" src/console/governance/overlay.css
```
Expected（原案）: grep 0 行。**實際交付（Task 5 fix）**：hex 為 0，但 `--ec-` 仍有一份轉接 `var(--ab-*)` 的 shim（見下方追記）；`rgba(11, 13, 16, 0.92)` 為中性深色半透明背景、非 hex、保留。

> **Task 5 fix 追記（實作歷程）**：上方「整塊刪除本地 `--ec-` 副本」原案在 browser 下觸發迴歸——`GovernanceOverlay.tsx` 渲染的 `.ec-btn`/`.ec-note`/`.ec-warn-note`/`.ec-cap`/`.ec-table` 規則（`edge-console.css`，全域 selector）消費 `var(--ec-*)`，而 `--ec-*` 只定義於 `.ec-root`；`.gov-overlay` 掛在 `.ec-root` 之外，刪掉本地副本後這些 var 於 overlay 內解析失敗、治理面板失色。修法：於 `.gov-overlay` 保留一份薄 shim，把 `--ec-bg`/`--ec-grn`/`--ec-amb`/… 全部轉接成對應 `var(--ab-*)`（非硬寫 hex）。此 shim 是**過渡態**：待 **Task 7** 把 `.ec-*` 規則的 `var(--ec-*)` 機械移植成 `var(--ab-*)`（`:root` 全域，overlay 內即可解析）後，shim 成 dead code，於 Task 7 Step 3(d) 一併刪除、由 Step 6 grep gate 驗 `--ec-` 全域歸零。迴歸守門測試：`web-viewer-sample/e2e/overlay-ec-token-resolution.spec.ts`。

- [ ] **Step 3: `viewer/viewer.css` — 品牌綠/sky 青系轉向 + 中性色 token 化（該檔不用 `--ec-`，全是 hex）**

```powershell
# cwd: <repo>/web-viewer-sample
$f = 'src/console/viewer/viewer.css'
$text = Get-Content -LiteralPath $f -Raw
$repl = [ordered]@{
  # 品牌綠 → 青（NVIDIA 綠退場）
  '#76b900' = 'var(--ab-accent)';
  'rgba(118, 185, 0, 0.06)' = 'rgba(65,199,232,.06)';
  'rgba(118, 185, 0, 0.05)' = 'rgba(65,199,232,.05)';
  'rgba(118, 185, 0, 0.12)' = 'var(--ab-accent-soft)';
  'rgba(118, 185, 0, 0.14)' = 'var(--ab-accent-soft)';
  'rgba(118, 185, 0, 0.2)'  = 'rgba(65,199,232,.2)';
  'rgba(118, 185, 0, 0.35)' = 'var(--ab-accent-strong)';
  '#4d6b00' = 'var(--ab-border-accent)';
  '#2d3a17' = 'var(--ab-border-accent)';
  # sky/cyan → 統一青
  'rgba(56, 189, 248, 0.28)' = 'rgba(65,199,232,.28)';
  '#67e8f9' = 'var(--ab-accent-text)';
  # 語意色
  '#f4b740' = 'var(--ab-warn)';
  '#fca5a5' = 'var(--ab-danger)';
  '#5b2a2a' = 'rgba(232,97,92,.35)';
  'rgba(239, 83, 80, 0.4)'  = 'rgba(232,97,92,.4)';
  'rgba(239, 83, 80, 0.08)' = 'rgba(232,97,92,.08)';
  # 中性面/字/框
  '#101419' = 'var(--ab-panel)';   '#090b0e' = 'var(--ab-black)';
  '#10151a' = 'var(--ab-surface)'; '#11151a' = 'var(--ab-surface)';
  '#161b22' = 'var(--ab-raised)';  '#1c222a' = 'var(--ab-border-faint)';
  '#26313c' = 'var(--ab-border)';  '#262c33' = 'var(--ab-border)';
  '#2d3742' = 'var(--ab-border)';  '#2b3340' = 'var(--ab-border)';
  '#2f363f' = 'var(--ab-border-strong)';
  '#cbd5e1' = 'var(--ab-text-2)';  '#e2e8f0' = 'var(--ab-text)';
  '#f1f5f9' = 'var(--ab-text)';    '#94a3b8' = 'var(--ab-text-muted)';
  '#95a5b5' = 'var(--ab-text-muted)';
  '"Cascadia Code", "JetBrains Mono", ui-monospace, monospace' = 'var(--ab-mono)';
}
foreach ($k in $repl.Keys) { $text = $text.Replace($k, $repl[$k]) }
Set-Content -LiteralPath $f -Value $text -NoNewline
grep -n "#[0-9a-fA-F]\{6\}\|rgba(118\|rgba(56, 189\|rgba(239" src/console/viewer/viewer.css
```
Expected: 0 行。若有殘餘（例如 `rgba(11, 13, 16, …)` 中性背景）——中性深色半透明**允許保留**；品牌綠/sky/舊紅必須為 0。同時把檔頭註解第 1 行的「對齊 edge-console token」改為「消費 ai-bim-governance.css --ab-* token」。

- [ ] **Step 4: `pages.tsx` 5 處 inline `var(--ec-*)` → `var(--ab-*)`（逐處，行號 947/974/978/986/1319）**

```powershell
# cwd: <repo>/web-viewer-sample
$f = 'src/console/pages.tsx'
$text = Get-Content -LiteralPath $f -Raw
$text = $text.Replace('var(--ec-fg-2)', 'var(--ab-text-2)')
$text = $text.Replace('var(--ec-amb)',  'var(--ab-warn)')
$text = $text.Replace('var(--ec-fg-3)', 'var(--ab-text-muted)')
Set-Content -LiteralPath $f -Value $text -NoNewline
grep -n -- "--ec-" src/console/pages.tsx
```
Expected: 0 行。

- [ ] **Step 5: 零星 inline hex（legacy 頁允許可見色變）**

```powershell
# cwd: <repo>/web-viewer-sample
(Get-Content 'src/console/RealIfcConsolePage.tsx' -Raw).Replace('#94a3b8','var(--ab-text-muted)').Replace('#76b900','var(--ab-accent)') | Set-Content 'src/console/RealIfcConsolePage.tsx' -NoNewline
(Get-Content 'src/console/KitConsolePage.tsx' -Raw).Replace('#94a3b8','var(--ab-text-muted)') | Set-Content 'src/console/KitConsolePage.tsx' -NoNewline
(Get-Content 'src/console/EmbeddedViewer.tsx' -Raw).Replace('1px solid #2a2f3a','1px solid var(--ab-border)').Replace('background: "#000"','background: "var(--ab-black)"') | Set-Content 'src/console/EmbeddedViewer.tsx' -NoNewline
grep -n "#94a3b8\|#76b900\|#2a2f3a" src/console/RealIfcConsolePage.tsx src/console/KitConsolePage.tsx src/console/EmbeddedViewer.tsx
```
Expected: 0 行。

- [ ] **Step 6: 行為不變驗證（§6.3「逐條核對遷移後行為仍成立」的測試面）**

```powershell
# cwd: <repo>/web-viewer-sample
npm run typecheck
npx vitest run src/console/GovernanceOverlay.test.tsx src/console/viewer/ src/console/ConversionPage.test.tsx src/console/console.test.tsx
```
Expected: 全綠——`GovernanceOverlay`/`HighlightBridge`/`MappingCache` 行為與 `unified-governance-console` 對應 Requirement 由既有測試把關；`ConversionPage.test.tsx` 的 `.ec-status-dot[data-status]` class 名斷言不受 token 遷移影響。若任何行為斷言轉紅且無法歸因於樣式：**停下**，依 spec §6.7 澄清，不得視為理所當然通過。

- [ ] **Step 7: Commit**

```powershell
# cwd: <repo>
git add web-viewer-sample/src/console/governance/overlay.css web-viewer-sample/src/console/viewer/viewer.css web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/RealIfcConsolePage.tsx web-viewer-sample/src/console/KitConsolePage.tsx web-viewer-sample/src/console/EmbeddedViewer.tsx
git commit -m "feat(console): legacy overlay/viewer/pages 遷移至 --ab-* token，品牌綠轉 Hi-Fi 青（§6.3）"
```

---

### Task 6: 主題切換移除（spec §6.4）

**Files:**
- Modify: `web-viewer-sample/src/console/EdgeConsole.tsx`（`LegacyEdgeConsole`：232-236、256、270 行）
- Test: `web-viewer-sample/src/console/EdgeConsole.theme-removal.test.ts`（新建）

**Interfaces:**
- Consumes: 無新 token。
- Produces: `LegacyEdgeConsole` 無 `theme` state、無 `localStorage["aibim:ec-theme"]` 讀寫、無 `.theme-light` class、無切換按鈕；`EdgeConsole` default export 介面不變。

- [ ] **Step 1: 寫失敗測試（靜態源碼把關；runtime 行為由 Task 9 browser E2E 覆蓋）**

建立 `web-viewer-sample/src/console/EdgeConsole.theme-removal.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// console-design-token-authority spec R2：UnifiedConsole 收斂為純深色，
// 不提供亮色主題切換（UI / state / localStorage 讀寫全移除）。
const src = readFileSync(
  resolve(process.cwd(), "src", "console", "EdgeConsole.tsx"),
  "utf8",
);

describe("EdgeConsole 主題切換已移除（純深色 console）", () => {
  it.each(["aibim:ec-theme", "theme-light", "setTheme", '"light"'])(
    "源碼不再含 %s",
    (needle) => {
      expect(src).not.toContain(needle);
    },
  );
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
# cwd: <repo>/web-viewer-sample
npx vitest run src/console/EdgeConsole.theme-removal.test.ts
```
Expected: FAIL（4 條全紅）。

- [ ] **Step 3: 移除三段程式碼（`EdgeConsole.tsx`）**

(a) 刪 232-236 行（含前導註解）：

```ts
  // 亮/暗主題（DS .theme-docs；persist localStorage，預設暗色——操作員 console 暗色為主）。
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return localStorage.getItem("aibim:ec-theme") === "light" ? "light" : "dark"; } catch { return "dark"; }
  });
  useEffect(() => { try { localStorage.setItem("aibim:ec-theme", theme); } catch { /* ignore */ } }, [theme]);
```

(b) 256 行 root className 改為（移除 theme 三元）：

```tsx
    <div className={`ec-root ${agentOpen ? "" : "ec-agent-collapsed"}`}>
```

(c) 刪 270 行按鈕：

```tsx
        <button className="ec-btn" onClick={() => setTheme((th) => (th === "light" ? "dark" : "light"))} title="切換亮 / 暗主題 / Theme" aria-label="切換亮暗主題">{theme === "light" ? "☾ 暗" : "☀ 亮"}</button>
```

(d) 檢查 `useEffect`/`useState` import 是否仍有其他使用者（`usePageHash`、`agentOpen`、`scenario` 仍用）→ import 行不動。

- [ ] **Step 4: 跑測試確認通過 + 殘留掃描**

```powershell
# cwd: <repo>/web-viewer-sample
npx vitest run src/console/EdgeConsole.theme-removal.test.ts
grep -rn "theme-light\|aibim:ec-theme" src/
npm run typecheck
npx vitest run src/console/
```
Expected: 新測試綠；grep 僅剩 `src/console/edge-console.css`（淺色 token 塊——Task 7 隨 retire 一併處理，spec §6.4 明文）；typecheck 與 console 全套測試綠。

- [ ] **Step 5: Commit**

```powershell
# cwd: <repo>
git add web-viewer-sample/src/console/EdgeConsole.tsx web-viewer-sample/src/console/EdgeConsole.theme-removal.test.ts
git commit -m "feat(console): 移除亮/暗主題切換，UnifiedConsole 收斂純深色（§6.4，BREAKING）"
```

---

### Task 7: Retire edge-console.css — 結構樣式移植 legacy-console.css + `--ec-` 歸零（spec §6.5）

**Files:**
- Create: `web-viewer-sample/src/console/legacy-console.css`（由 `edge-console.css` 機械移植）
- Modify: `web-viewer-sample/src/console/EdgeConsole.tsx:9`（import 換檔）
- Modify: `web-viewer-sample/src/console/IntentDialog.css.test.ts:10`（讀檔路徑換新檔）
- Modify: `web-viewer-sample/src/console/governance/overlay.css`（移除 Task 5 保留的 `--ec-* → var(--ab-*)` 過渡 shim；前置條件由本 task Step 2 的 `.ec-*` 規則移植滿足，見 Step 3(d)）
- Modify: `web-viewer-sample/src/console/ConversionPage.tsx:19`、`ConversionPage.test.tsx:190`、`web-viewer-sample/e2e/ifc-ready-field-redesign.spec.ts:237`、`web-viewer-sample/src/console/unified/unified.css:5`（註解提及 edge-console.css 之處）
- Modify: `docs/plans/design-system-reference.manifest.json`（`token_projection.production_projection`）
- Delete: `web-viewer-sample/src/console/edge-console.css`

**Interfaces:**
- Consumes: 全域 token 對照表（本 plan 上方）；Task 1 的缺口 token。
- Produces: `legacy-console.css` 保留全部 `.ec-*` / `.md-split` 結構性 selector（class 名不變 → `ConversionPage.test.tsx`、`IntentDialog.tsx` 等零改動），但只消費 `var(--ab-*)`；repo 內 `--ec-` 歸零。

- [ ] **Step 1: 先改測試（失敗中）——`IntentDialog.css.test.ts` 指向新檔**

第 5-12 行改為：

```ts
// conv-prioritize-retry / Task 5 fix：IntentDialog.tsx 用到的 modal class 必須在 legacy-console.css 有定義，
// 否則在 browser E2E 下 backdrop/置中/浮層全失效（class name 存在但無樣式 → 視覺損壞）。
// jsdom 不會從 stylesheet 計算 layout，無法測 computed style；改以靜態 selector 存在性把關。
// vitest cwd = package root（web-viewer-sample），故用相對 package 的路徑讀檔。
const css = readFileSync(
  resolve(process.cwd(), "src/console/legacy-console.css"),
  "utf8",
);

describe("legacy-console.css 提供 IntentDialog modal 樣式", () => {
```

```powershell
# cwd: <repo>/web-viewer-sample
npx vitest run src/console/IntentDialog.css.test.ts
```
Expected: FAIL（ENOENT：legacy-console.css 不存在）。

- [ ] **Step 2: 機械移植產生 `legacy-console.css`**

```powershell
# cwd: <repo>/web-viewer-sample
$text = Get-Content -LiteralPath 'src/console/edge-console.css' -Raw
# (1) 全域 token 對照表逐項置換（var 消費位）
$tok = [ordered]@{
  'var(--ec-bg-3)'='var(--ab-inset)'; 'var(--ec-bg-2)'='var(--ab-bar)'; 'var(--ec-bg)'='var(--ab-bg)';
  'var(--ec-panel-hi)'='var(--ab-raised)'; 'var(--ec-panel)'='var(--ab-surface)';
  'var(--ec-line-2)'='var(--ab-border-strong)'; 'var(--ec-line)'='var(--ab-border)';
  'var(--ec-fg-2)'='var(--ab-text-2)'; 'var(--ec-fg-3)'='var(--ab-text-muted)';
  'var(--ec-fg-4)'='var(--ab-text-dim)'; 'var(--ec-fg)'='var(--ab-text)';
  'var(--ec-grn-2)'='var(--ab-accent-soft)'; 'var(--ec-grn-3)'='var(--ab-accent-strong)'; 'var(--ec-grn)'='var(--ab-accent)';
  'var(--ec-cyan-2)'='var(--ab-info-soft)'; 'var(--ec-cyan)'='var(--ab-info)';
  'var(--ec-amb-2)'='var(--ab-warn-soft)'; 'var(--ec-amb)'='var(--ab-warn)';
  'var(--ec-red-2)'='var(--ab-danger-soft)'; 'var(--ec-red)'='var(--ab-danger)';
  'var(--ec-vio-2)'='var(--ab-violet-soft)'; 'var(--ec-vio)'='var(--ab-violet)';
  'var(--ec-mono)'='var(--ab-mono)'; 'var(--ec-sans)'='var(--ab-font)';
  'var(--ec-r-xs)'='var(--ab-r-sm)'; 'var(--ec-r-sm)'='var(--ab-r-lg)'; 'var(--ec-r-pill)'='var(--ab-r-pill)'; 'var(--ec-r)'='var(--ab-r-2xl)';
  'var(--ec-sp-1)'='var(--ab-space-1)'; 'var(--ec-sp-2)'='var(--ab-space-3)'; 'var(--ec-sp-3)'='var(--ab-space-5)';
  'var(--ec-sp-4)'='var(--ab-space-6)'; 'var(--ec-sp-5)'='var(--ab-space-7)'; 'var(--ec-sp-6)'='var(--ab-space-8)'; 'var(--ec-sp-8)'='var(--ab-space-9)';
  'var(--ec-shadow-1)'='var(--ab-shadow-card)'; 'var(--ec-shadow-2)'='var(--ab-shadow-pop)';
  'var(--ec-glow-grn)'='var(--ab-glow-accent)';
  'var(--ec-ease)'='var(--ab-ease)'; 'var(--ec-dur-fast)'='var(--ab-dur-fast)'; 'var(--ec-dur-slow)'='var(--ab-dur-slow)'; 'var(--ec-dur)'='var(--ab-dur)';
  'var(--ec-track-label)'='var(--ab-track-label)'; 'var(--ec-track-tag)'='var(--ab-track-tag)';
  'var(--ec-on-grn)'='var(--ab-on-accent)';
  'var(--ec-fs-page)'='var(--ab-fs-page)'; 'var(--ec-fs-h2)'='var(--ab-fs-h2)'; 'var(--ec-fs-h3)'='var(--ab-fs-h3)';
  'var(--ec-fs-body)'='var(--ab-fs-body)'; 'var(--ec-fs-sm)'='var(--ab-fs-sm)'; 'var(--ec-fs-xs)'='var(--ab-fs-xs)'; 'var(--ec-fs-mono)'='var(--ab-fs-mono)';
  'var(--ec-accent, #7fd962)'='var(--ab-accent)';
  # 規則內殘存 hex 字面值
  '#2e7d32'='var(--ab-ok)';
  'linear-gradient(135deg, var(--ab-accent), #4d7c0f)'='var(--ab-gradient)';
}
foreach ($k in $tok.Keys) { $text = $text.Replace($k, $tok[$k]) }
Set-Content -LiteralPath 'src/console/legacy-console.css' -Value $text -NoNewline
```

備註：置換順序已按「長 key 先於其字首 key」排列（如 `--ec-bg-3` 先於 `--ec-bg`、`--ec-r-xs` 先於 `--ec-r`），`.Replace` 逐字串處理不會誤傷。

- [ ] **Step 3: 手工整理 `legacy-console.css` 的三個非機械段**

(a) 檔頭 1-32 行（原 `.ec-root` token 定義塊）換成——**刪掉全部 `--ec-*` 定義**，只留結構屬性：

```css
/* AI-BIM Governance legacy console 殼層結構樣式（migrate-console-to-hifi-design）。
 * 前身 edge-console.css 已 retire；.ec-* class 名保留（測試與元件零改動），
 * 顏色/字族/圓角/間距一律消費 docs/plans/ai-bim-governance.css 的 --ab-* token（:root 定義）。
 * 純深色：淺色主題塊已隨主題切換功能移除（spec R2）。 */
.ec-root {
  position:fixed; inset:0; display:grid;
  grid-template-rows:48px 1fr 26px;
  grid-template-columns:236px 1fr 300px;
  grid-template-areas:"top top top" "nav main agent" "foot foot foot";
  background:var(--ab-bg); color:var(--ab-text);
  font:13px/1.5 var(--ab-font); overflow:hidden;
}
```

(b) 刪除整段淺色主題塊（原 439-454 行：`/* ── 淺色主題 .theme-light … */` 註解 + `.ec-root.theme-light { … }` 整個規則）。

(c) 修掉殘留品牌註解：原 57 行「綠維持 #76b900」與原 440 行淺色註解已不適用——(b) 已刪 440；57 行註解改為 `/* DS 對齊：active left-bar 依 plane 上色（CORE/governance=cyan、OMNIVERSE=accent）。 */`。

(d) 移除 `governance/overlay.css` 的過渡 shim（Task 5 fix 保留者）：刪掉 `.gov-overlay` 內整塊 `--ec-* → var(--ab-*)` 定義（含其上方 shim 說明註解），並把檔頭註解回收成「純消費 `--ab-*`」。**前置條件已由本 Step 2 滿足**——`.ec-btn`/`.ec-note`/`.ec-warn-note`/`.ec-cap`/`table.ec-table` 等全域 `.ec-*` 規則的 `var(--ec-*)` 已移植成 `var(--ab-*)`（`:root` 定義），這些規則在 `.gov-overlay`（`.ec-root` 之外）內已能直接解析，shim 不再需要；刪除後 `.gov-overlay` 只餘結構屬性 + `var(--ab-*)`。守門測試 `e2e/overlay-ec-token-resolution.spec.ts`（Step 6 全套 E2E 內）須續綠——此時 token 由移植後的規則供給，非 shim。

- [ ] **Step 4: 換 import、刪舊檔、清註解**

`EdgeConsole.tsx:9`：`import "./edge-console.css";` → `import "./legacy-console.css";`

```powershell
# cwd: <repo>/web-viewer-sample
git rm src/console/edge-console.css
```

註解清理（單行手工編輯，不動行為）：
- `ConversionPage.tsx:19`：`（warn/ok/bad；edge-console.css:305-322）` → `（warn/ok/bad；legacy-console.css 的 .ec-status-dot 規則）`
- `ConversionPage.test.tsx:190`：`（edge-console.css）` → `（legacy-console.css）`
- `e2e/ifc-ready-field-redesign.spec.ts:237`：`.ec-root position:fixed（edge-console.css:26）` → `.ec-root position:fixed（legacy-console.css）`
- `unified/unified.css:5`：刪「不得動既有 edge-console.css。」一行（該檔已 retire）。

- [ ] **Step 5: `docs/plans/design-system-reference.manifest.json` 的 `token_projection.production_projection`**

```json
"production_projection": "docs/plans/ai-bim-governance.css",
```
（`verify-design-system-reference.ps1` 只驗 `order` 與 boolean，不驗此字串——已核實，安全。）

- [ ] **Step 6: `--ec-` 歸零 gate + 全套驗證**

```powershell
# cwd: <repo>
grep -rn -- "--ec-" web-viewer-sample/src
# cwd: <repo>/web-viewer-sample
npm run typecheck
npm run build
npx vitest run
npx playwright test e2e/overlay-ec-token-resolution.spec.ts
npm run test:visual:design-system
pwsh ../scripts/tests/verify-design-system-reference.ps1
```
Expected: 第一個 grep **無任何輸出**（全 repo src 歸零——`edge-console.css` 已刪、`governance/overlay.css` 過渡 shim 已於 Step 3(d) 移除，無例外）；typecheck/build/vitest 全綠；`overlay-ec-token-resolution.spec.ts` 是 Playwright spec（非 vitest，`vitest.config.ts` 的 include 不會撿到 `e2e/` 下的檔案），須用上面獨立的 `npx playwright test` 指令驗證，PASS 代表 Step 3(d) 移除 shim 後 `.gov-overlay` 內的 `.ec-*` 規則仍能正確解析 `var(--ab-*)`；visual gate 26 比對 PASS（unified 頁未動）；manifest 驗證 PASS。

- [ ] **Step 7: Commit**

```powershell
# cwd: <repo>
git add web-viewer-sample/src/console/legacy-console.css web-viewer-sample/src/console/EdgeConsole.tsx web-viewer-sample/src/console/IntentDialog.css.test.ts web-viewer-sample/src/console/ConversionPage.tsx web-viewer-sample/src/console/ConversionPage.test.tsx web-viewer-sample/e2e/ifc-ready-field-redesign.spec.ts web-viewer-sample/src/console/unified/unified.css web-viewer-sample/src/console/governance/overlay.css docs/plans/design-system-reference.manifest.json
git commit -m "feat(console): retire edge-console.css，legacy-console.css 移植消費 --ab-*，--ec- 全域歸零（§6.5，BREAKING）"
```

---

### Task 8: 文件更新 — §08 R1 改寫 + 品牌決策卡 + origin 同步（spec §6.6，決策 D4）

**Files:**
- Modify: `docs/plans/AI-BIM 前後端設計文件.dc.html`（619 行 R1 卡）
- Out-of-repo sync: `C:\Repos\design\desigin-system\AI-BIM 前後端設計文件.dc.html`（比照 PR #353 作法；此路徑在 repo 外，變更不入本 repo git，PR body 揭露）

**Interfaces:**
- Consumes: Task 7 完成後的最終權威路徑（`docs/plans/ai-bim-governance.css`）。
- Produces: §08 明文記錄新 token 權威與「品牌/主題調整為有意識決策」；origin 副本一致（Task 10 rebaseline 會把 origin 新 hash 重新 pin 進 manifest）。

- [ ] **Step 1: R1 卡內 token 敘述改寫。** 619 行整行換成：

```html
          <span style="font-size:10.5px;color:#8aa0b8">部分 Prompt Board 寫 Vue 3 / Pinia / Element Plus — 一律忽略。design token 沿用 <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#b7a9ff">docs/plans/ai-bim-governance.css --ab-*</span> 單一真相源（production 真實 import，不手抄色碼、不平行建第二套 theme）；前身 edge-console.css --ec-* 已於 migrate-console-to-hifi-design 退役。</span>
```

- [ ] **Step 2: R1 卡收合的 `</div>`（620 行）之後、R2 卡 `<div …rgba(49,197,109,.22)…>` 之前，插入品牌決策卡（D4：防止未來誤判為疏忽而「修回」）**

```html
        <div style="background:#0a1220;border:1px solid rgba(65,199,232,.22);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px">
          <span style="font-size:12px;font-weight:700;color:#6fd6ee">R1a · 品牌色與主題（有意識決策，非疏忽覆蓋）</span>
          <pre style="margin:0;background:#070d15;border:1px solid rgba(120,160,210,.1);border-radius:8px;padding:10px;font-family:'JetBrains Mono',monospace;font-size:10px;line-height:1.7;color:#8aa0b8;overflow:auto">Primary brand: NVIDIA green #76b900 → Hi-Fi cyan #41c7e8 / #2f7bf6
Light theme: REMOVED (localStorage aibim:ec-theme + .theme-light retired)
UnifiedConsole = dark-only console</pre>
          <span style="font-size:10.5px;color:#8aa0b8">使用者在完整揭露現況（含原「NVIDIA 綠為核心品牌」設計註解與可用的亮/暗切換）後拍板：以 <span style="color:#dbe6f3">AI-BIM Console Hi-Fi.dc.html</span> 為前端唯一操作標準、ai-bim-governance.css 為唯一 design token 權威。深色青系是刻意的品牌方向調整——<span style="color:#e6b23e">請勿</span>視為 regression 而「修回」NVIDIA 綠或補回亮色主題。依據：OpenSpec change <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#b7a9ff">migrate-console-to-hifi-design</span>。</span>
        </div>
```

- [ ] **Step 3: §03 等其他章節過時敘述核對（spec §6.6 第三點）**

```powershell
# cwd: <repo>
grep -n "edge-console\|theme-light\|亮色\|雙主題\|76b900\|NVIDIA 綠" "docs/plans/AI-BIM 前後端設計文件.dc.html"
```
Expected: 僅剩本 task 新寫入的 R1/R1a 內容（歷史敘述已在 plan 撰寫時全文 grep 過：R1 之外原本就沒有雙主題/NVIDIA 綠敘述）。若出現其他命中：逐處把過時敘述改寫為指向 `--ab-*` 權威（保守小改，不重排版）。

- [ ] **Step 4: origin 同步（比照 PR #353；repo 外側效應，PR body 揭露）**

```powershell
# cwd: <repo>
Copy-Item "docs/plans/AI-BIM 前後端設計文件.dc.html" "C:\Repos\design\desigin-system\AI-BIM 前後端設計文件.dc.html" -Force
git -C "C:\Repos\design\desigin-system" status --short 2>$null; if ($LASTEXITCODE -ne 0) { Write-Host "origin 非 git repo，僅檔案同步" }
```
Expected: 複製成功。origin 檔案 hash 改變 → manifest `source.files` 舊 pin 會 drift——**這正是 Task 10 rebaseline 重新 pin 的對象**；在 Task 10 之前不要單獨跑無旗標的 capture（會因 drift 報錯，那是預期行為）。

- [ ] **Step 5: Commit（僅 repo 內檔案）**

```powershell
# cwd: <repo>
git add "docs/plans/AI-BIM 前後端設計文件.dc.html"
git commit -m "docs(plans): §08 R1 改指 ai-bim-governance.css --ab-* 權威 + R1a 品牌/主題決策卡（§6.6，D4）"
```

---

### Task 9: Browser E2E — 遷移契約垂直切片（spec §9 userFacing=true 必備）

**Files:**
- Create: `web-viewer-sample/e2e/hifi-token-authority.spec.ts`
- Modify: `web-viewer-sample/playwright.functional-runtime.config.ts`（testMatch 加新檔）

**Interfaces:**
- Consumes: Task 1–8 全部落地後的 production bundle（`npm run build:ui` → `dist-ui`）；真實 `bim-review-coordinator`（harness 自起，port 8017，模式照抄 `conv-history.spec.ts` 既有慣例）。
- Produces: 垂直切片證據——UI route（`/ui`、`/ui#conv`、`/ui#/demo-control`）→ 按鈕/操作 → 真實 backend API（coordinator webhook 種 job + `GET /api/external/ifc-ready`）→ runtime ID（`ifc_ready_job_id`）→ loading/success/failure/retry 四態 + token 權威斷言（computed style 青色、`--ec-` 不存在、主題鍵不再寫入）。無任何 DEMO DATA 佯裝 live；後端未建面（ChatUSD 欄）維持既有誠實標示、不在本 E2E 斷言範圍。

- [ ] **Step 1: 寫 E2E（先寫、先跑、先看它紅——此時新 spec 檔在 testMatch 外會被略過，故先改 config）**

`playwright.functional-runtime.config.ts` 的 `testMatch` 行改為：

```ts
  testMatch: ["conv-history.spec.ts", "hifi-token-authority.spec.ts"],
```

建立 `web-viewer-sample/e2e/hifi-token-authority.spec.ts`（harness 逐段依 `conv-history.spec.ts` 既有慣例，port 錯開為 8017）：

```ts
import { expect, request as pwRequest, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// migrate-console-to-hifi-design 遷移契約垂直切片（真 coordinator、無瀏覽器 API mock）：
// route → 操作 → 真實 backend API → runtime ID（ifc_ready_job_id）→ loading/success/failure/retry，
// 外加 design token 權威斷言（--ab-* 生效、--ec- 絕跡、主題切換退場）。
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.resolve(TEST_DIR, "..");
const repoRoot = path.resolve(viewerDir, "..");
const coordinatorDir = path.join(repoRoot, "bim-review-coordinator");
const consoleDistDir = path.join(viewerDir, "dist-ui");
const coordinatorPort = Number.parseInt(process.env.HIFI_E2E_COORDINATOR_PORT ?? "8017", 10);
const coordinatorBase = `http://127.0.0.1:${coordinatorPort}`;
const webhookSecret = "dev-webhook-secret";
const artifactDir = path.join(repoRoot, "artifacts", "e2e", "hifi-token-authority");

let coordinatorProc: ChildProcess | null = null;
let ifcSourceStub: http.Server | null = null;
let conversionStub: http.Server | null = null;
let tmpRoot = "";
let sourcePort = 0;

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("stub bind failed");
  return address.port;
}

async function waitForHealth(earlyExit: () => string | null, timeoutMs = 60_000): Promise<void> {
  const api = await pwRequest.newContext();
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const failure = earlyExit();
      if (failure) throw new Error(failure);
      try {
        const response = await api.get(`${coordinatorBase}/health`, { timeout: 2000 });
        if (response.ok()) return;
      } catch { /* retry until ready */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`coordinator /health not ready within ${timeoutMs}ms at ${coordinatorBase}`);
  } finally {
    await api.dispose();
  }
}

async function seedIfcReadyJob(): Promise<string> {
  const api = await pwRequest.newContext();
  try {
    const response = await api.post(`${coordinatorBase}/api/external/ifc-ready`, {
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
        "X-Correlation-Id": "corr_hifi_token_001",
        "X-Idempotency-Key": "idem_hifi_token_001",
      },
      data: {
        event: "ifc_ready",
        event_id: "evt_hifi_token_001",
        correlation_id: "corr_hifi_token_001",
        idempotency_key: "idem_hifi_token_001",
        tenant_id: "tenant_fixture_001",
        project_id: "project_fixture_001",
        external_model_version_id: "version_fixture_001",
        source_ifc: {
          ref: `http://127.0.0.1:${sourcePort}/library.ifc`,
          etag: `sha256:${"e".repeat(64)}`,
          filename: "library.ifc",
          format: "ifc",
        },
        requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
      },
    });
    expect(response.status()).toBe(202);
    const body = await response.json();
    return String(body.ifc_ready_job_id);
  } finally {
    await api.dispose();
  }
}

test.describe("hifi token authority：遷移契約垂直切片（真 coordinator）", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    if (!fs.existsSync(path.join(consoleDistDir, "index.html"))) {
      throw new Error("dist-ui is required; run `npm run build:ui` before this gate.");
    }
    ifcSourceStub = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
    });
    sourcePort = await listenOnRandomPort(ifcSourceStub);
    conversionStub = http.createServer((_request, response) => {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ detail: "conversion API not exercised by this gate" }));
    });
    const conversionPort = await listenOnRandomPort(conversionStub);
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hifi-token-authority-"));
    let coordinatorExited: number | null = null;
    let stderrTail = "";
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(coordinatorPort),
      PUBLIC_HOST: "127.0.0.1",
      STREAMING_CONVERSION_API_BASE: `http://127.0.0.1:${conversionPort}`,
      CONSOLE_DIST_DIR: consoleDistDir,
      CONVERSION_POLL_ENABLED: "false",
      IFC_DOWNLOAD_STRICT: "false",
      EXTERNAL_INTAKE_WEBHOOK_SECRET: webhookSecret,
      SESSION_STORE_DIR: path.join(tmpRoot, "sessions"),
      EVENT_LOG_DIR: path.join(tmpRoot, "events"),
      CALLBACK_OUTBOX_STORE_PATH: path.join(tmpRoot, "callback-outbox.json"),
      STORAGE_ROOT: path.join(tmpRoot, "storage"),
      LOG_ROOT: path.join(tmpRoot, "logs"),
    };
    const tsxBin = path.join(coordinatorDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
    coordinatorProc = spawn(tsxBin, ["src/index.ts"], {
      cwd: coordinatorDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    coordinatorProc.on("exit", (code) => { coordinatorExited = code ?? -1; });
    coordinatorProc.stderr?.on("data", (data) => { stderrTail = `${stderrTail}${String(data)}`.slice(-4000); });
    await waitForHealth(() => (coordinatorExited == null
      ? null
      : `coordinator exited before health (code=${coordinatorExited}); stderr:\n${stderrTail}`));
  });

  test.afterAll(async () => {
    if (coordinatorProc?.pid && process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/F", "/T", "/PID", String(coordinatorProc!.pid)], { stdio: "ignore" });
        killer.on("exit", () => resolve());
        killer.on("error", () => { try { coordinatorProc?.kill("SIGKILL"); } catch { /* stopped */ } resolve(); });
      });
    } else if (coordinatorProc) {
      coordinatorProc.kill("SIGTERM");
    }
    coordinatorProc = null;
    for (const server of [ifcSourceStub, conversionStub]) {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    ifcSourceStub = null;
    conversionStub = null;
    if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("unified home：--ab token 生效、主題鍵不寫入", async ({ page }) => {
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.goto(`${coordinatorBase}/ui`);
    await expect(page.getByText("總覽 · Mission Control")).toBeVisible({ timeout: 20_000 });
    const facts = await page.evaluate(() => ({
      bodyBg: getComputedStyle(document.body).backgroundColor,
      abAccent: getComputedStyle(document.documentElement).getPropertyValue("--ab-accent").trim(),
      themeKey: localStorage.getItem("aibim:ec-theme"),
    }));
    expect(facts.bodyBg).toBe("rgb(6, 10, 16)"); // var(--ab-bg) #060a10
    expect(facts.abAccent).toBe("#41c7e8");
    expect(facts.themeKey).toBeNull(); // 主題持久化已退場
    await page.screenshot({ path: path.join(artifactDir, "unified-home.png"), fullPage: false });
  });

  test("legacy #conv 垂直切片：loading/success/failure/retry + 品牌青 + --ec- 絕跡 + 無主題鈕", async ({ page }) => {
    const jobId = await seedIfcReadyJob(); // 真實 runtime ID（coordinator 核發）

    // failure：先攔斷佇列 API → 頁面誠實顯示錯誤狀態
    await page.route("**/api/external/ifc-ready**", (route) => route.abort());
    await page.goto(`${coordinatorBase}/ui#conv`);
    await expect(page.getByTestId("conv-queue-error")).toBeVisible({ timeout: 20_000 });

    // retry：解除攔截 → 重新載入（佇列層的使用者重試路徑；prioritize/retry 鈕屬 per-job 操作）
    await page.unroute("**/api/external/ifc-ready**");
    const responsePromise = page.waitForResponse((r) => r.url().includes("/api/external/ifc-ready") && r.ok());
    await page.reload();
    // loading（短暫態，非阻塞觀測；與 conv-history.spec 同法）
    const loadingObserved = await page.getByTestId("conv-history-loading").isVisible().catch(() => false);
    const listResponse = await responsePromise; // 真實 backend API 成功
    expect(listResponse.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "IFC→USD 轉檔歷史" })).toBeVisible();
    await expect(page.getByText(jobId)).toBeVisible({ timeout: 20_000 }); // runtime ID 上桌（success）
    console.log(`[hifi-token-authority] loadingObserved=${loadingObserved} jobId=${jobId}`);

    // 遷移契約：品牌青、--ec- 絕跡、主題鈕退場、淺色 class 絕跡
    const facts = await page.evaluate(() => {
      const brand = document.querySelector(".ec-brand");
      const root = document.querySelector(".ec-root");
      return {
        brandColor: brand ? getComputedStyle(brand).color : null,
        ecGrn: root ? getComputedStyle(root).getPropertyValue("--ec-grn").trim() : "unmounted",
        themeLight: document.querySelector(".theme-light") != null,
        themeKey: localStorage.getItem("aibim:ec-theme"),
      };
    });
    expect(facts.brandColor).toBe("rgb(65, 199, 232)"); // var(--ab-accent)
    expect(facts.ecGrn).toBe(""); // --ec-* token 已不存在
    expect(facts.themeLight).toBe(false);
    expect(facts.themeKey).toBeNull();
    await expect(page.getByRole("button", { name: "切換亮暗主題" })).toHaveCount(0);
    await page.screenshot({ path: path.join(artifactDir, "legacy-conv.png"), fullPage: false });
  });

  test("legacy #/demo-control 與 #/kit 仍可達（遷移未砍 operator-tool 路由）", async ({ page }) => {
    await page.goto(`${coordinatorBase}/ui#/demo-control`);
    await expect(page.getByTestId("real-ifc-demo-control")).toBeVisible({ timeout: 15_000 });
    await page.goto(`${coordinatorBase}/ui#/kit`);
    await expect(page.getByTestId("kit-proxy-panel")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(artifactDir, "legacy-demo-control.png"), fullPage: false });
  });
});
```

- [ ] **Step 2: 跑確認紅（尚未 build 最新 dist-ui 時 harness fail-fast；或 dist-ui 為舊 bundle 時 token 斷言紅）**

```powershell
# cwd: <repo>/web-viewer-sample
npx playwright test --config=playwright.functional-runtime.config.ts hifi-token-authority.spec.ts
```
Expected: 若 `dist-ui` 缺 → 拋 "dist-ui is required"；若 `dist-ui` 是遷移前舊 bundle → `brandColor` 斷言紅（rgb(118,185,0)）。兩者都算「先看它失敗」。

- [ ] **Step 3: build 最新 bundle 後跑綠**

```powershell
# cwd: <repo>/web-viewer-sample
npm run build:ui
npx playwright test --config=playwright.functional-runtime.config.ts
```
Expected: `conv-history.spec.ts` + `hifi-token-authority.spec.ts` 全 PASS（既有功能 E2E 與新遷移契約同場驗證）。

- [ ] **Step 4: 截圖證據入庫（`.gitignore` 擋 `*.png`，要 `-f`）**

```powershell
# cwd: <repo>
git add -f artifacts/e2e/hifi-token-authority/unified-home.png artifacts/e2e/hifi-token-authority/legacy-conv.png artifacts/e2e/hifi-token-authority/legacy-demo-control.png
```

- [ ] **Step 5: Commit**

```powershell
# cwd: <repo>
git add web-viewer-sample/e2e/hifi-token-authority.spec.ts web-viewer-sample/playwright.functional-runtime.config.ts
git commit -m "test(e2e): hifi-token-authority 垂直切片——真 coordinator、runtime ID、四態、品牌青與 --ec- 絕跡斷言（spec §9）"
```

---

### Task 10: Rebaseline 與整體驗證（spec §6.7）

**Files:**
- Modify（由工具重寫，不手改）: `docs/plans/design-system-reference.manifest.json`（`source.files` 重 pin + `baseline_snapshot_sha256`）、`docs/plans/design-system-baseline/**/*.png`（如有位元變化）

**Interfaces:**
- Consumes: Task 8 已同步的 origin（含更新後 dc.html）；pin 環境（Playwright 1.61.1 / Chromium 149.0.7827.55 / Node 20.20.2 / npm 10.9.4 / Windows）。
- Produces: manifest 與 origin/baseline 一致、`-VerifyOrigin` 綠、`npm run verify` 綠、兩份既有 spec 的 Scenario 核對清單。

- [ ] **Step 1: Rebaseline（重擷 13 screens × 2 viewports + 重 pin origin file hashes）**

```powershell
# cwd: <repo>
node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline
```
Expected: `[design-reference] rebaseline complete: 13 screens x 2 viewports`。**誠實記錄**：baselines 從 origin 擷取、origin 視覺未變 → PNG 應位元恆等或僅 metadata 級差異；manifest 的 `source.files` 內 dc.html hash 更新（Task 8 的同步）。`git status` 如實呈現實際 diff（可能只有 manifest）。此結果與 spec §8「26 基準全數作廢」的預期不同——機理見本 plan「導航前提」，於 PR body 揭露，不視為缺口。

- [ ] **Step 2: Origin 驗證 + 無旗標覆核**

```powershell
# cwd: <repo>
pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin
node web-viewer-sample/scripts/capture-design-system-reference.mjs
```
Expected: 兩者 PASS（`origin and 26 baselines verified`）。

- [ ] **Step 3: 全套 verify（web-viewer-sample 契約入口）**

```powershell
# cwd: <repo>/web-viewer-sample
npm run verify
npm run test:visual:design-system
```
Expected: `verify`（typecheck + build + vitest + struct-log）全綠；visual gate PASS。

- [ ] **Step 4: 兩份既有 spec 的 Scenario 逐條核對（行為不變證據彙整，不改 spec 檔）**

核對來源與方法（結果寫進 PR body 的表格，不新增檔案）：
- `openspec/specs/edge-console-operator-frontend/spec.md`：逐 Requirement 對應本輪證據——`unified-console-routes.spec.ts`（#/kit、#/demo-control、#/review 可達）、`hifi-token-authority.spec.ts`（#conv 垂直切片）、`conv-history.spec.ts`（#conv functional gate）、vitest `console.test.tsx`/`ConversionPage.test.tsx`。
- `openspec/specs/unified-governance-console/spec.md`：`GovernanceOverlay.test.tsx`、`governance/*.test.ts`（highlightBridge/mappingCache/govPanelState/windowOverlayGlue）、`A1CrossLinks`/`A2OverlayViewer`/`A3FederationSession` 測試——Task 5/7 後全綠即為「provenance 誠實性與 API 呼叫零變更」證據。
- 任何 Scenario 無法由上述證據覆蓋且行為存疑 → **停下澄清**（spec §6.7 明文），不得自行認定通過。

```powershell
# cwd: <repo>/web-viewer-sample
npx vitest run src/console/
```
Expected: console 全套綠。

- [ ] **Step 5: Commit（rebaseline 產物）**

```powershell
# cwd: <repo>
git add docs/plans/design-system-reference.manifest.json docs/plans/design-system-baseline/
git commit -m "chore(design-gate): rebaseline——origin 重 pin（§08 文件同步後）+ 26 baseline 覆核（§6.7）"
```
（若 baseline PNG 位元恆等、僅 manifest 變動，commit 內容如實反映。）

---

### Task 11: Archive 前置與 PR 證據（spec §6.8）

**Files:**
- 無新檔（驗證 + PR body 組裝）

**Interfaces:**
- Consumes: Task 1–10 全部 commit。
- Produces: openspec 驗證綠、邊界零污染證明、PR 證據包。

- [ ] **Step 1: OpenSpec 驗證**

```powershell
# cwd: <repo>
npx openspec validate migrate-console-to-hifi-design --strict
```
Expected: PASS。

- [ ] **Step 2: 邊界零污染 gate（本 change 不得動三個既有 spec/change 的檔案本體）**

```powershell
# cwd: <repo>
git diff --name-only origin/main...HEAD -- openspec/specs/unified-governance-console openspec/specs/edge-console-operator-frontend openspec/changes/align-frontend-design-system-reference
```
Expected: 無輸出（0 檔）。

- [ ] **Step 3: 完成定義終驗（機器可驗三連）**

```powershell
# cwd: <repo>
grep -rn -- "--ec-" web-viewer-sample/src
grep -rn "#[0-9a-fA-F]\{6\}" web-viewer-sample/src/console/unified/
git log --oneline origin/main..HEAD
```
Expected: 前兩個 grep 零輸出；commit 序列涵蓋 Task 1–10。

- [ ] **Step 4: PR body 組裝（開 PR 由後續 ship 流程執行，此處備妥素材）**

必含：
1. 遷移前後截圖對照——「前」用 origin baseline `docs/plans/design-system-baseline/console.home.default/1440x900.png` 與 main 分支任一 legacy 截圖；「後」用 `artifacts/e2e/hifi-token-authority/*.png`（Task 9 已 `git add -f`）。
2. golden baseline diff 摘要——Task 10 Step 1 的 `git status`/diff 實況（含「origin-擷取機理 → 基準未大改」的誠實說明）。
3. 既有功能 E2E 證據——Task 9 Step 3 的 playwright 輸出、Task 10 Step 4 的 Scenario 對照表。
4. BREAKING 揭露——品牌主色轉向 + 亮色主題移除（引 §08 R1a）；out-of-repo origin 同步路徑 `C:\Repos\design\desigin-system`。
5. Frontend Verification 表（pr-review-agent 逐字 label，七列）：Frontend route=`/ui`、`/ui#conv`、`/ui#/demo-control`；Main button(s) tested=conv 佇列 reload-retry、demo-control 面板載入；Fixture used=coordinator webhook 種入 `ifc_ready_job_id`（真實核發）；Visible success state=jobId 列表可見 + 品牌青 computed style；E2E command=`npx playwright test --config=playwright.functional-runtime.config.ts`；Screenshot / trace=`artifacts/e2e/hifi-token-authority/*.png`；Known gaps=ChatUSD 欄維持 PREVIEW（後端未建，既有誠實標示）。

---

## Self-Review（plan 作者已執行）

1. **Spec 覆蓋**：§6.1→Task 1；§6.2→Task 2/3/4（docks/fixtures 雖未列名於 6.2 條目，屬 §2(a) `console/unified/*` 範圍，折入 Task 3，未增刪任務範圍）；§6.3→Task 5（viewer.css 實況為 hex 而非 `--ec-`，機理已註明）+ Task 7（ConversionPage/IntentDialog 測試斷言核對）；§6.4→Task 6；§6.5→Task 7；§6.6→Task 8；§6.7→Task 10；§6.8→Task 11；§9 browser E2E→Task 9。四條 capability Requirement：R1（Task 1/7 + 歸零 gate）、R2（Task 6/8）、R3（Task 5/9/10 行為證據）、R4（Task 10 重用既有機制）。
2. **Placeholder 掃描**：無 TBD/TODO/「適當處理」；每步含完整程式碼或精確指令與預期輸出；「同 Task N」樣式的 `$map` 已在 Task 3/4 重複貼全文。
3. **型別/命名一致性**：新 token 24 個在 Task 1 測試清單、Task 1 Step 4 CSS 塊、對照表三處逐字一致；`legacy-console.css` 檔名在 Task 7 全部觸點（import/測試/註解）一致；E2E 斷言的 rgb 值（rgb(6,10,16)/rgb(65,199,232)）與 token 值（#060a10/#41c7e8）對應正確。
4. **已知風險（誠實揭露，不作為 blocker）**：(a) spec §8「26 基準全作廢」與 capture 腳本 origin-擷取機理不符——照跑 rebaseline、結果如實揭露；(b) `--ab-space-7/8` 對 `--ec-sp-5/6` 有 +2px 的 legacy 版面微調（有意識、可接受）；(c) origin 同步為 repo 外側效應，需該路徑可寫，PR body 揭露。
