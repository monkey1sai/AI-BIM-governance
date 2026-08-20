## 0. Current-main convergence reconciliation（2026-07-24）

> 2026-07-28 ledger 對帳（forensic，以 git/code 證據為準）：勾選修正 14/40 → 31/40，另修正四處 task 文字的事實錯誤。分支 `codex/openspec/migrate-console-to-hifi-design`（tip `94a5575`）已 push origin 保全——獨有資產為 `design-token-source-guard.test.ts`（1929 行守門測試）與 spacing/typography 深度遷移 diff（受 HIFI-02/03 裁決凍結，暫不可採用）。dubious-ownership worktree 已棄置，後續 P3 由 origin/main 重開。

- [x] 0.1 固定 current main `1959a4905a76ee95d9f314a6e52c67a415a7700f`、legacy tip `94a557571c25fe6e058251d39e3dad139eb65bf3` 與兩個 CSS blob，禁止整包 cherry-pick
- [x] 0.2 以 parser-backed census 確認 current/legacy canon 分別有 86/179 個 unique declaration、差集為 93；legacy consumer 相對 current canon 的第 94 個缺名是負向測試 sentinel `--ab-not-real`
- [x] 0.3 建立 `token-gap-ledger.md` 與 `adjudication-index.md`，揭露 current-main 已完成事項、未裁決缺口與 GitNexus HIGH/CRITICAL gates
- [x] 0.4 在 `drafts/ai-bim-governance.token-extension.proposed.css` 保存平行 proposal；不得 import、不得覆寫受保護 canon
- [x] 0.5 使用者逐項裁決 token disposition 與 consumer migration blast radius；canon adoption 仍由 human owner 執行，AI 只維護 parallel proposal/draft，frontend visual slice 另依核准範圍啟動。**2026-08-20 owner grill**：HIFI-01 拒絕 93；HIFI-02 允許元件本地 geometry；HIFI-03 四個 HIGH／CRITICAL consumer 不放行；HIFI-04 本 change 不再打包 consumer 遷移、以後 visual 單 route。正本寫入未授權（R-A1）。紀錄＝`adjudication-index.md`。

## 1. Token 覆蓋率盤點

- [x] 1.1 以 parser-backed census 比對 legacy canon 與 current canon 的 token 語意對應並列出缺口清單（census 正本＝`token-gap-ledger.md`：86/179 unique declaration、差集 93；原文「217 個 `--ec-*` token」數字有誤，實體缺口清單＝ledger「Legacy proposed declaration census」7 類 93 項表 + `drafts/ai-bim-governance.token-extension.proposed.css`）
- [x] 1.2 為缺口新增對應的 `--ab-*` token（延伸 `ai-bim-governance.css`，維持既有 `primitive`/命名慣例），SHALL NOT 為填補缺口而退回消費 `--ec-*`。**terminal disposition 2026-08-20 HIFI-01／02：won't-add**。不延伸受保護正本；93 項 draft 保持歷史、不 import。
- [x] 1.3 確認 `ai-bim-governance.css` 的 import 機制（current main 由 `EdgeConsole.tsx` 直接 import）並在 `web-viewer-sample` 建置設定中接上

## 2. UnifiedConsole IA v2 收斂（console/unified/*）

- [x] 2.1 `UnifiedShell.tsx`：inline hex → `var(--ab-*)`（#357 落地；origin/main raw-hex=0、`var(--ab-` 36 處）
- [x] 2.2 `HomePage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 20）
- [x] 2.3 `WorkspacePage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 32）
- [x] 2.4 `PipelinePage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 53）
- [x] 2.5 `OpsPage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 23）
- [x] 2.6 `ConceptPage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 9）
- [x] 2.7 `unified.css`：body 層級樣式改用 `--ab-*`（#357 落地；raw-hex=0、ab-var 8）
- [ ] 2.8 每頁遷移後跑該頁既有 browser E2E 案例，確認功能行為不變（僅允許樣式相關的截圖差異）。2026-08-12 corrective review：#357 artifact 與現行 spec 僅覆蓋 unified home／部分 workspace-runtime routes；`PipelinePage`／`ConceptPage` 只有 Vitest／DOM 證據，尚無逐頁 browser run，因此維持未勾。

## 3. Legacy 頁面遷移（仍掛 edge-console.css 的部分）

- [x] 3.1 盤點 `LegacyEdgeConsole` 覆蓋的路由（`#/kit`、`#/demo-control` 等）與其對應的 `edge-console-operator-frontend` spec Requirement 的 mapping（證據＝`artifacts/2026-07-16-migrate-console-to-hifi-design-pr-body.md` §5/§7；「遷移後行為逐字成立」的 closeout 歸 7.4，不在本項重複認列）
- [x] 3.2 `LegacyEdgeConsole` 各頁元件：`--ec-*` → `--ab-*`（#357 落地；`git grep -- "--ec-" origin/main -- web-viewer-sample/src` 唯一命中為守門測試自我參照）
- [x] 3.3 `ConversionPage.tsx`（`#conv` 路由）：`--ec-*` → `--ab-*`，含 `ConversionPage.test.tsx`（#357 同 PR 落地；main 該檔 ec=0、raw-hex=0）
- [x] 3.4 `governance/overlay.css`：`--ec-*` → `--ab-*`（#357 落地；ec=0、ab 11；專屬守門 `e2e/overlay-ec-token-resolution.spec.ts`）
- [x] 3.5 `viewer/*.css`（含 `MockViewport.tsx`）：`--ec-*` → `--ab-*`（#357 落地；ec=0、ab 60）
- [x] 3.6 `legacy-console.css` 內 `IntentDialog` selectors 及 `IntentDialog.css.test.ts`：`--ec-*` → `--ab-*`（repo 不存在獨立 `IntentDialog.css`，原文前提有誤；#357 已改測試，現行斷言讀 `legacy-console.css`）
- [ ] 3.7 每頁遷移後跑該頁既有 browser E2E / provenance 誠實性案例，確認功能行為不變。2026-08-12 corrective review：本 PR 引用的既有 evidence 覆蓋 `#conv`、`#/kit`、`#/demo-control`、`#/review` 與 component tests，但未記錄 `#/admin`、`#/gpu`、`#/sessions` 等所有 migrated legacy pages 的逐頁 browser／provenance run，因此維持未勾。

## 4. 主題切換移除

- [x] 4.1 `EdgeConsole.tsx`：亮/暗切換按鈕 UI 已移除（current-main source + regression guard verified）
- [x] 4.2 `EdgeConsole.tsx`：`theme` state、`localStorage["aibim:ec-theme"]` 讀寫、`.theme-light` class 套用邏輯已移除
- [x] 4.3 production source 無 `.theme-light` / `aibim:ec-theme` 殘留，且 `EdgeConsole.theme-removal.test.ts` 鎖定 regression guard

## 5. Retire edge-console.css

- [x] 5.1 確認 production `--ec-` 使用量歸零（2026-07-24 current-main reconciliation 排除 tests/specs 後為 0）
- [x] 5.2 確認 current main 已移除 `edge-console.css`，production 改由 `legacy-console.css` 消費 `--ab-*`
- [x] 5.3 更新仍提及 `edge-console.css` 為權威來源的程式碼註解或文件片段（範圍排除 `docs/superpowers/plans/` 與 `docs/evidence/` 之 immutable 歷史 artifact；production source 與 dc.html §08 已零殘留）

## 6. 文件更新

- [x] 6.1 current canon §08 R1 已記錄 `ai-bim-governance.css --ab-*` 為唯一 production design token 權威（本 reconciliation 僅讀取驗證，未寫 canon）
- [x] 6.2 current canon §08 已記錄「production 主色由 NVIDIA 綠改 Hi-Fi 青色系」與「移除亮色主題」為有意識決策（本 reconciliation 僅讀取驗證）
- [x] 6.3 §03（或其他相關章節）核對過時敘述（2026-07-28 對 dc.html 全文 grep `edge-console|雙主題|theme-light|亮色主題`，僅命中 §08 三處且措辭正確；§03 零殘留）
- [ ] 6.4 **human owner only**：同步 origin（`C:\Repos\design\desigin-system`）與受保護的 repo `docs/plans/` 正本；AI 只提供 parallel proposal/draft，不原地寫入任一正本。**Status: deferred-this-change 2026-08-20**（owner grill：本 change 不執行 origin↔repo 正本對齊；等下次 human 真的要改 Hi-Fi 正本再做 R-A4 backup／version bump。不擋 2.8／3.7。checkbox 維持未勾，不算完成。）

## 7. Rebaseline 與驗證

- [x] 7.1 在 PR #535 合併前 **STOP**：不得執行會寫入 `workspace.a4.default` PNG／sha256 的 generic `--rebaseline`。#535 合併後本項只准 (a) 保全 pinned `workspace.a4.default` digest、零覆寫，或 (b) 只重拍非 `canonical_product_surface` 的 origin 投影屏。禁止再寫「13 screens 一律 generic rebaseline」。2026-08-12 執行結果：**非 no-op，已 STOP 不勾**。跑完後 diff 僅命中 `workspace.a4.default`（1440x900／1920x1080 兩張 golden＋manifest 三處 sha256／`baseline_snapshot_sha256`），來源快照 `snapshot_sha256=2f414d9d...`本身未變。根因：capture script 對全部 13 screens 一律走 origin mockup（`C:\Repos\design\desigin-system`）靜態伺服器擷取，未對 manifest 中僅 `workspace.a4.default` 具備的 `baseline_provenance.authority=canonical_product_surface`（要求改走 `web-viewer-sample/e2e/design-system-visual.spec.ts` 對「真實 product」擷取）做任何特判；產出的新 sha256（`a67240fdc...`／`51f333465...`）與 manifest 三處 baseline sha256 逐一比對，恰好等於 PR #429（commit `2b9573e`）明確裁決汰換掉的**舊值**——換言之本次 rebaseline 會原地復原 #429 修正過的 A4 canonical baseline 回退到 mockup-origin 版本。已用 `git checkout --` 還原 manifest 與兩張 PNG 至 HEAD 狀態，未 commit；`-VerifyOrigin` 復原後仍綠（`source=2f414d9d...`，13 screens／26 golden）。這是 capture script 本身的一個真實缺陷（遺漏 baseline_provenance 特判），建議另立 issue 修正腳本，不在本次範圍內動手改。
**2026-08-17 合規執行（#535 provenance guard 上線後）**：`node scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`——log 明示 `preserving canonical product-surface baselines: workspace.a4.default`、12 origin screens captured／1 product screen preserved×2 viewports；跑後 `git status` 僅 `manifest.json` 的 `captured_at_utc` 時戳一行（26 張 golden PNG 全 byte-identical、`snapshot_sha256=2f414d9d…` 未變、A4 pinned digest 零覆寫）。2026-08-12 發現的 capture script 缺陷已由 PR #535（`design-system-rebaseline-authority.mjs` planOriginRebaseline＋preserved-baseline integrity check）修復，本次為其 mainline 首驗。
- [x] 7.2 執行 `pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`，確認通過。2026-08-12 corrective review：7.1 尚未重新擷取 golden baseline；既有 13 screens／26 golden 驗證只證明舊 snapshot 完整，不能預先驗證 7.1 未來產物，因此須於 7.1 完成後重跑再勾。**2026-08-17：7.1 合規 rebaseline 完成後重跑，passed — 13 screens、26 golden files、source=`2f414d9d…`，exit 0。**
- [x] 7.3 跑 `web-viewer-sample` 既有測試套件（`npm run verify`），確認無 regression。2026-08-12：worktree 缺 `node_modules`（已知環境缺口，非程式缺陷）→ `cd web-viewer-sample && npm install`（356 packages，`npm install` 因本機 npm 11.6.2 與 manifest 釘選之 npm 10.9.4 版本差異在 `package-lock.json` 多寫入 14 處 `"peer": true` 標註，非真實依賴變動，已 `git checkout --` 還原、不影響已裝 node_modules）。`npm run verify`＝`typecheck && build && test && test:struct-log` 全綠、exit 0：`tsc --noEmit` 無錯；`vite build` 176 modules transformed 成功；`vitest run` 78 test files／1069 tests 全通過；`test:struct-log` 23/23 PASS。跑完 `git status --short` 乾淨、無殘留變更。
- [ ] 7.4 逐條核對 `edge-console-operator-frontend` 與 `unified-governance-console` 兩份既有 spec 的相關 Scenario 仍成立（依 design.md Risk 項，行為層面的不確定 SHALL 停下澄清，不視為理所當然通過）。2026-08-12：逐條稽核產出 `artifacts/2026-08-12-hifi-consumer-spec-scenario-audit.md`——66 個 Scenario 全數走過（edge-console-operator-frontend 30 個、unified-governance-console 36 個）。2026-08-12 review reclassify（PR #507 兩輪 P2 review threads 共 13 條逐條獨立查證：12 條成立並改判，1 條「A1–A10 overlay 能力清單不全」因混用兩套刻意不同的 A1–A10 編號而不成立、已附逐字反駁並維持 HOLDS；並機械重算總覽表使其與 66 個逐條 verdict 標題一致）：**48 HOLDS、3 HOLDS-WITH-NOTE、9 STALE、6 UNVERIFIABLE**。9 項 STALE 皆早於本次遷移、非 #357/#358/#429 造成——其中 8 項為 spec 措辭落後於現行程式碼（IA v2 把 `a1`/`a2`/`a3` 讓給 UnifiedConsole workspace、`defaultCoordinatorBase` same-origin 化、`#runtime` 改掛 fixture `OpsPage` 等），僅 `unified-governance-console` R3「在 3D 標紅」為真正能力缺口（production Kit `_on_highlight_prims` 不讀 `color`、只做 `set_selected_prim_paths` 回 `applied_mode: "selection"`），需在補 Kit 實作與收斂 spec 之間擇一；6 項 UNVERIFIABLE 皆需真實部署 stack／GPU／Kit runtime 的 browser E2E（`npm run verify` 不含 `test:e2e`），本 session 純程式碼稽核無法逐字確認，且均不在本次遷移實際改動檔案範圍內（見 audit 文件「總覽」file-scope 證據）。因存在 STALE 與 UNVERIFIABLE 項，依規範不勾選本項；兩份清單與根因見 audit 文件「STALE 項清單」「UNVERIFIABLE 項清單」兩節，升級請 coordinator／使用者裁決是否另立 spec 對齊變更與部署驗證任務。

## 8. Archive 前置

- [x] 8.1 `npx openspec validate migrate-console-to-hifi-design --strict` 通過（2026-07-24 reconciliation rerun；2026-07-28 ledger 對帳後於 worktree 重跑仍綠）
- [x] 8.2 確認本 change 未修改 `unified-governance-console`、`edge-console-operator-frontend` 任一既有 spec 檔案本體（僅新增 `console-design-token-authority`）；`align-frontend-design-system-reference` 僅允許 2026-08-14 裁決落地的 successor crosswalk 編輯（#538：`proposal.md` 現況註記＋`successor-crosswalk-migrate-console-to-hifi-design.md`），不得有其他修改。2026-08-14：原措辭因 crosswalk 失效、取消勾選。2026-08-17 重核（改寫後）：`git log --since=2026-07-16 origin/main -- openspec/specs/unified-governance-console openspec/specs/edge-console-operator-frontend`＝零 commits；`align-frontend-design-system-reference` 目錄僅 #538 兩個 crosswalk commits（`5e176a4`／`9e111e5`）與 repository-wide lifecycle 操作（#370/#404），無本 change 的其他編輯——條件成立，重新勾選。
- [x] 8.3 PR 附上遷移前後截圖對照、golden baseline diff 摘要、既有功能 E2E 證據（實體＝`artifacts/2026-07-16-migrate-console-to-hifi-design-pr-body.md` §3/§4/§5/§7，已隨 #357 merge 入 main；§7「Design gate status」欄位未回填屬已知殘項）
