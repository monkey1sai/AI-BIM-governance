# 設計規格說明（#spec）頁對齊 DS + 誠實措辭 — F1~F5 修復設計

- slug: `spec-page-ds-alignment-fixes`
- userFacing: **true**（F1 改 `#spec` 頁可見 lead 文字、F3 改 nav tooltip，須從 `#spec` route 操作 + browser E2E 取證；F2 為零視覺改動的 CSS token 化、F4 為純文件現況補記（F5 查證後 won't-fix），隨車）
- dateStamp: 2026-06-24
- 里程碑定位：**收尾/技術債**（非新功能）；F1–F4 為實際修復（blast=low、surgical），F5 經查證後判定 **won't-fix**（見 §2 F5）

---

## 0. 一句話

2026-06-24 對「設計規格說明（`#spec`）」左側欄位與顯示內容做了 ultracode 49-agent 對齊稽核：**整體高度對齊、0 high/0 medium**，只剩 5 項 low/info 小事（一行措辭不精確、CSS 少套一個已定義的 token、tooltip 沒走 i18n、一份手冊現況過時、一份設計規格命名慣例差異）。本 spec 修掉其中 **4 項**（F1–F4，全 surgical、不碰後端凍結面）；**F5 經查證後判定 won't-fix**（§2.2 是非權威分群表 + 該 doc 自身 legend line 55 已映射 `CORE→governance`，逐行只改一列反而破壞全文一致性，見 §2 F5）。

---

## 1. 稽核 / 對抗驗證結論（grounded，2026-06-24 main HEAD a8fbcb4）

> 來源：`artifacts/2026-06-24-spec-page-alignment-audit.md`（job tmp 同步副本）。下表 5 項皆經 skeptic 親自 Read/Grep 查證；錨點（檔:行 + 逐字現有字串）由本 spec §2 帶出。

| ID | finding | verdict | severity | user-facing | 誠實相關 | blast |
|---|---|---|---|---|---|---|
| F1 | `#spec` lead 文字把 MinIO 列為「各自 repo 邊界」，但 MinIO 是 coordinator 外連 S3 依賴、無獨立 repo | confirmed mismatch | low | ✓ | ✓（措辭精確性） | low |
| F2 | `.ec-lead` margin 用字面 `16px`，未引用已定義的 `--ec-sp-4` | confirmed gap | low | ✗（零視覺改動） | ✗ | low |
| F3 | nav 按鈕 `title={p.label}` 用 data.ts 混語 fallback，tooltip 語言不一致 | confirmed gap | info | ✓（tooltip） | ✗ | low |
| F4 | 前端對齊手冊 §8 Q3 `theme-docs` 仍是 open question；repo 已用全站 `theme-light` toggle 取代 | confirmed（刻意延後） | low | ✗ | ✗ | low |
| F5 | 設計規格.md §2.2 把 `#spec` 的 plane 記為 `CORE`；repo data.ts:73 是 `governance` | confirmed 但 **won't-fix**（命名慣例差異、非錯誤；見 §2 F5） | info | ✗ | ✗ | low |

### 1.1 對抗驗證已排除的「假警報」（誠實記錄，避免重提）
- **「#spec 缺 E2E 截圖 = gap」被多數 skeptic 推翻** → `#spec` 是正典路由表第 22 條的「靜態 / 🟢 文件入口」，DoD §4 條件 2「後端真接線」對零後端的靜態頁結構性不適用；且原 finding 引用的 `HON-03` 是稽核流程自造 ID（全庫零命中）。**本 spec 不把「補 E2E」當作 F1-F5 之一**；但因本 spec 把 F1/F3 列為 user-facing 改動，P4 仍會自然產出 `#spec` 頁截圖。
- **「.ec-panel border-radius:6px 硬編碼」被推翻** → `edge-console.css:411` DS polish block 已用 `var(--ec-r)` cascade 覆蓋，**實際生效是 token**。故 §3 明列 **不要動** `.ec-panel` line 98。

---

## 2. 修復項目（按優先序：誠實措辭 → token hygiene → i18n → 文件）

> 全部用「逐字 current → proposed」。implementer 以 current_text 為 find target，不得自行擴大改動範圍。

### F1 — `#spec` lead 文字修正 MinIO 措辭（user-facing · 誠實措辭）
- **root cause**：`web-viewer-sample/src/console/pages.tsx:1332` lead 把 `conversion / Kit / WebRTC / MinIO 權威仍在各自 repo 邊界`，把 MinIO 與三個有 sub-repo 的服務並列、隱含 MinIO 有自己的 repo boundary。但《實作紀律與技術債防線》§6（埠表，約 line 182）明確：**真實 MinIO endpoint（`192.168.20.234:9000` / bucket `bim-control`）是 `bim-review-coordinator` 的外連依賴（outbound S3Client）、非 loopback bind、不在埠表、由部署區 .env 注入**。lead 措辭與 §6 架構不符（下方 Panel 本體 lines 1333-1338 只列 4 個 repo、已正確不含 MinIO）。
- **fix**（pages.tsx:1332，整行 find/replace）：
  - current：`      <p className="ec-lead">{t("此頁保留 prototype 到 repo 的落地對照：完整操作台是 frontend product shell；conversion / Kit / WebRTC / MinIO 權威仍在各自 repo 邊界。", "This page keeps the prototype-to-repo mapping: the full console is the frontend product shell; conversion / Kit / WebRTC / MinIO authority still lives within their respective repo boundaries.")}</p>`
  - proposed：`      <p className="ec-lead">{t("此頁保留 prototype 到 repo 的落地對照：完整操作台是 frontend product shell；conversion / Kit / WebRTC 權威仍在各自 sub-repo 邊界；MinIO 為 coordinator 外連 S3 來源，非獨立 repo。", "This page keeps the prototype-to-repo mapping: the full console is the frontend product shell; conversion / Kit / WebRTC authority still lives within their respective sub-repo boundaries; MinIO is an outbound S3 source for coordinator, not a separate repo.")}</p>`
- **scope**：純前端 JSX 字串，僅 `web-viewer-sample/src/console/pages.tsx`（SpecPage）。不碰 Panel 本體、不碰後端。對齊《實作紀律》§6。
- **acceptance**：
  - vitest（新增）：render `SpecPage`，斷言 lead `toContainText("MinIO 為 coordinator 外連 S3")` 且 `not.toContainText("MinIO 權威仍在各自 repo 邊界")`（誠實守門用 not-contains）。
  - browser E2E：見 §2 末「user-facing 驗收」。

### F2 — `.ec-lead` margin token 化（CSS · token hygiene · 零視覺改動）
- **root cause**：`web-viewer-sample/src/console/edge-console.css:69` `.ec-main .ec-lead { color:var(--ec-fg-3); margin:0 0 16px; max-width:70ch; }` 的 `16px` 為字面值；而同檔 line 18 已定義 `--ec-sp-4:16px`（在 `.ec-root` scope，`.ec-lead` 恆為其後代、解析正確）。違反《前端對齊手冊》§5.B「tokenize 間距」與 `--ec-*` 唯一入口紀律。
- **fix**（edge-console.css:69，整行 find/replace）：
  - current：`.ec-main .ec-lead { color:var(--ec-fg-3); margin:0 0 16px; max-width:70ch; }`
  - proposed：`.ec-main .ec-lead { color:var(--ec-fg-3); margin:0 0 var(--ec-sp-4); max-width:70ch; }`
- **scope**：純 CSS，僅 `edge-console.css`。`.ec-lead` 全檔僅出現於 line 69、無覆蓋，安全單點替換。`16px === var(--ec-sp-4)` → **零視覺改動**。
- **out of scope（明確不做）**：**不要動 `.ec-panel` line 98 的 `border-radius:6px`** —— 它已被 line ~411 DS polish block 的 `var(--ec-r)` cascade 覆蓋、實際生效是 token，改它無效果且製造 churn。
- **acceptance**：`npx tsc --noEmit` + `npm run build`（vite）綠；視覺不變（P4 截圖與基準一致即可，非新增斷言）。

### F3 — nav tooltip 走 i18n（前端 · i18n 一致）
- **root cause**：`web-viewer-sample/src/console/EdgeConsole.tsx:210` nav 按鈕 `title={p.label}` 直接用 `data.ts` 的 `label`（該欄中英混用、是 fallback），導致 tooltip 語言與可見 nav 文字不一致（可見文字 line 212 已用 `navText(p.key, p.label)`）。`navText`（line 176，`(key, fallback) => string`）同元件作用域可用。
- **fix**（EdgeConsole.tsx:210，整行 find/replace）：
  - current：`              <button key={p.key} className={page === p.key ? "active" : ""} data-plane={p.plane} title={p.label} onClick={() => go(p.key)}>`
  - proposed：`              <button key={p.key} className={page === p.key ? "active" : ""} data-plane={p.plane} title={navText(p.key, p.label)} onClick={() => go(p.key)}>`
- **scope**：純前端，僅 `EdgeConsole.tsx`（nav render）。不改 `navText`、`NAV_LABEL`、`data.ts`。
- **acceptance**：
  - vitest（新增）：render `EdgeConsole`（lang=zh），取一個 `label`≠`biz` 的項（如 `overview`：data.ts `label="Overview"`、NAV_LABEL biz=`總覽`），斷言該按鈕 `title` 屬性 === `總覽`（非 `Overview`）。
  - browser E2E：見 §2 末。

### F4 — 前端對齊手冊 §8 Q3 `theme-docs` 現況補記（純文件 · **不替人類拍板**）
- **root cause**：`docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md:379` §8 Q3 仍把 `theme-docs` 寫成「本輪做不做」的 open question，未反映 repo 現況：repo 已落地全站 `theme-light` toggle（`edge-console.css:435`–437 註解映射 `.theme-light = DS .theme-docs`、一處覆寫全站變色，PR #255）。文件因此 stale。
- **§8 約束（關鍵，決定 fix 形態）**：手冊 §8 開頭（line 375）明定「下列是**會改變可見外觀或行為**的決策，AI coding **不得自行拍板**，須先問人類」。故 F4 **只補現況事實**（指出已有實作可參考），保留原 open question 不動；**嚴禁**把 Q3 標成「已結案 / 刻意決策 / 無待決」——是否正式採此為最終架構仍是**人類保留決策**。
- **fix**（手冊:379，整段 find/replace；該段在全檔唯一；proposed ⊃ current，僅在句尾**附加**非拘束現況補記）：
  - current：`3. **Light \`.theme-docs\`**：DS 出一整套淺色 token（藍 \`#2563eb\`）；repo console 純暗、無 docs surface。本輪做不做任何淺色/docs surface，或整個 skip？`
  - proposed：`3. **Light \`.theme-docs\`**：DS 出一整套淺色 token（藍 \`#2563eb\`）；repo console 純暗、無 docs surface。本輪做不做任何淺色/docs surface，或整個 skip？**（現況補記 2026-06，非拍板）** repo 已落地全站 \`theme-light\` toggle（\`edge-console.css:435\` 註解映射 \`.theme-light = DS .theme-docs\`、一處覆寫全站變色，PR #255），可作此題現有實作參考；惟「是否正式採此為最終形 / 是否做 per-page docs surface」仍依本節開頭規則**保留人類決策、未拍板**。`
- **scope**：純文件（`.md`），不碰任何 code。
- **acceptance**：該段**保留原 open question 文字**並於句尾附「現況補記（非拍板）」一句，明列保留人類決策；**不得**出現「已結案/刻意決策/無待決」等替人類拍板字眼；PR diff 僅此一段。

### F5 — 設計規格.md §2.2 plane「stale」→ 查證後 **won't-fix**（純文件 · 不改）
- **原 finding**：`docs/plans/ai-bim-governance-設計規格.md:170` §2.2 把 system 列 plane 記為 `CORE`，而 repo `data.ts:73` 是 `governance`。
- **重新查證（2026-06-30）後判定不改，理由**：
  1. §2.2 開頭（line 162）明示「完整 22 條路由以互動規格 §A.1.1 正典表為準，**本節只描述分群語意**」→ §2.2 對 per-route plane **非權威**，`#spec` 的 plane 真相在 §A.1.1 / `data.ts`，不在此表。
  2. `CORE`/`OMNIVERSE` 是**該 doc 自身的巨觀平面命名**，定義在其 legend（line 55 `| CORE | cyan | …governance-service / coordinator |`）與 NavItem 規則（line 96 `CORE cyan / OMNIVERSE green`）；§2.2 五列（166/167/168/169/170）一致沿用。**doc 內 `CORE` ≡ repo `governance`**，line 55 已自帶映射，非「錯誤」而是命名層差異（審計亦記「色碼同為 cyan、無行為差異」）。
  3. 只改 line 170 一列 → 半 `CORE` 半 `governance`、與 166/167/169 及 legend line 55/96 互相矛盾（**這正是原 spec F5 的缺陷**）。要對齊得連 legend line 55、規則 line 96、全 §2.2 一起改 = **跨全文的詞彙遷移**，遠超「surgical stale 修正」、且會把 doc 既有 CORE/OMNIVERSE 慣例整組推翻，風險與範圍不成比例。
- **disposition**：**不修改 `設計規格.md`**。F5 從 in-scope 移除（§3.1 不再含此檔）。誠實記錄：5 findings → **4 實際修復（F1–F4）+ 1 documented won't-fix（F5）**。若日後要做 doc 全文 `CORE/OMNIVERSE → governance/omniverse` 遷移，另開獨立 docs PR（見 §5 follow-up）。

### user-facing 驗收（P4，涵蓋 F1 + F3；隔離 branch stack）
> 隔離 branch stack 啟法見 memory `branch-e2e-isolated-stack` / `a1a3-ds-alignment-2026-06-23`：branch coordinator（PORT=8005 / CONSOLE_DIST_DIR / GOVERNANCE_API_BASE）+ branch governance（GOV_PORT=49103）+ viewer；E2E 打 `:8005`，不碰部署區 `:8004`。
- 載 `#spec` → 截圖：lead 文字顯示新措辭（含「MinIO 為 coordinator 外連 S3 來源，非獨立 repo」、不含「MinIO 權威仍在各自 repo 邊界」）；下方 4-Field Panel 不變。
- （F3）hover 一個 `tech`≠`biz` 的 nav 項（如 `總覽`/Overview），tooltip 語言與當前介面語言一致。
- 維持不變量：無視覺 regression（F2 零改動）、Prov chip 不變（`kit-manager-api=p1` 紅、其餘綠）。
- 產物落 `artifacts/e2e/spec-page-ds-alignment-fixes-*`（screenshot + trace + summary JSON）。

---

## 3. 範圍總表

### 3.1 In scope（檔案清單）
- `web-viewer-sample/src/console/pages.tsx`（F1 lead 字串）
- `web-viewer-sample/src/console/edge-console.css`（F2 `.ec-lead` margin token）
- `web-viewer-sample/src/console/EdgeConsole.tsx`（F3 nav tooltip）
- `web-viewer-sample/src/console/*.test.tsx`（F1/F3 新增最小斷言）
- `docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md`（F4 現況補記，純附加）

### 3.2 Out of scope（明確不做）
- **後端凍結面**：禁改 `app.py` / `governanceProxy.ts`（governance proxy）/ `conversion_authority.py` 或任何後端檔（CLAUDE.md §1 / 前端對齊手冊 §1 DO-NOT-TOUCH）。本批 0 後端改動。
- **F5（設計規格.md §2.2 plane vocab）**：查證後 **won't-fix**（見 §2 F5）；本批**不改** `docs/plans/ai-bim-governance-設計規格.md`。
- `edge-console.css:98` `.ec-panel border-radius:6px`（已被 line ~411 token 覆蓋，動了無效）。
- SpecPage 的 Panel 本體與 4 個 Field（已正確，不動）。
- `navText` / `NAV_LABEL` / `data.ts` label 欄本身（F3 只改 tooltip 取值，不重構 label 來源；「label 欄整批語言統一 / 加 lint」列為 follow-up，不在本格）。
- 不補 `#spec` 的 E2E-only 截圖當作獨立修復項（見 §1.1，靜態頁非義務；F1/F3 的 user-facing 截圖自然涵蓋 `#spec`）。

---

## 4. 共通紀律（避免 pr-review-agent / DoD 失敗）

- **PR body evidence 表**：
  - F1/F2/F3 改 `web-viewer-sample/` → 需 **Frontend Verification** 10 列表（Frontend route `#spec` / Main UI tested / Fixture / Visible state / E2E command / Screenshot / trace / Known gaps…）。
  - F4 純 `docs/plans/`（手冊現況補記）→ 不 match deployPattern，註明「純文件，不適用 Deploy Path」。（F5 won't-fix，不改檔。）
  - 無後端 / runtime 改動 → Deploy Path 表註明不適用。
- **誠實鐵律**：F1 是誠實措辭修（讓 lead 與 §6 架構一致）；F4 只補現況、不替人類拍板（守 §8）；F5 查證後不硬改、誠實記 won't-fix。全頁仍無 live data claim、Prov chip 不變、不新增假宣稱。
- **GitNexus / codebase-memory impact**：改 `pages.tsx`/`EdgeConsole.tsx` symbol 前跑 `impact(upstream)`；commit 前 `detect_changes(compare base_ref=main)`，確認 blast 限於 `#spec` 頁 + nav render + 新測試，未波及其他頁。預期 risk=LOW（純前端加法 / 字串 / 文件）。HIGH/CRITICAL 先回報。
- **流程**：不在 `main` 開發；branch → PR → Actions → merge（auto-merge 依既有授權）。
- **先量再改**：動手前 `web-viewer-sample` 內跑 baseline `npx vitest run` + `npx tsc --noEmit`（vite build 不跑 tsc，型別須另驗，見 memory `minio-closed-loop-phase1`）。

---

## 5. 拍板紀錄 ＋ follow-up
- **拍板**：F1–F4 一次出（單一 PR，user-facing），逐字 current→proposed 已釘死；**F5 won't-fix（documented，不改檔）**。
- **follow-up（不在本格）**：
  - `data.ts` label 欄語言整批統一 + 加 lint 確保每個 `PAGES` key 都有 `NAV_LABEL`（F3 已治標 tooltip，此為治本，info 級）。
  - 手冊 §8 Q3 `theme-docs` 是否正式採全站 toggle 為最終架構＝**保留人類決策**（F4 僅補現況、未拍板）。
  - 設計規格 doc 全文 `CORE/OMNIVERSE → governance/omniverse` 詞彙遷移（含 legend line 55、規則 line 96、§2.2 全表）＝F5 won't-fix 的「治本」版，另開獨立 docs PR。
