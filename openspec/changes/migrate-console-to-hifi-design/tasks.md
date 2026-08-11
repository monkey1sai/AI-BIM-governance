## 0. Current-main convergence reconciliation（2026-07-24）

> 2026-07-28 ledger 對帳（forensic，以 git/code 證據為準）：勾選修正 14/40 → 31/40，另修正四處 task 文字的事實錯誤。分支 `codex/openspec/migrate-console-to-hifi-design`（tip `94a5575`）已 push origin 保全——獨有資產為 `design-token-source-guard.test.ts`（1929 行守門測試）與 spacing/typography 深度遷移 diff（受 HIFI-02/03 裁決凍結，暫不可採用）。dubious-ownership worktree 已棄置，後續 P3 由 origin/main 重開。

- [x] 0.1 固定 current main `1959a4905a76ee95d9f314a6e52c67a415a7700f`、legacy tip `94a557571c25fe6e058251d39e3dad139eb65bf3` 與兩個 CSS blob，禁止整包 cherry-pick
- [x] 0.2 以 parser-backed census 確認 current/legacy canon 分別有 86/179 個 unique declaration、差集為 93；legacy consumer 相對 current canon 的第 94 個缺名是負向測試 sentinel `--ab-not-real`
- [x] 0.3 建立 `token-gap-ledger.md` 與 `adjudication-index.md`，揭露 current-main 已完成事項、未裁決缺口與 GitNexus HIGH/CRITICAL gates
- [x] 0.4 在 `drafts/ai-bim-governance.token-extension.proposed.css` 保存平行 proposal；不得 import、不得覆寫受保護 canon
- [ ] 0.5 使用者逐項裁決 token disposition 與 consumer migration blast radius；canon adoption 仍由 human owner 執行，AI 只維護 parallel proposal/draft，frontend visual slice 另依核准範圍啟動

## 1. Token 覆蓋率盤點

- [x] 1.1 以 parser-backed census 比對 legacy canon 與 current canon 的 token 語意對應並列出缺口清單（census 正本＝`token-gap-ledger.md`：86/179 unique declaration、差集 93；原文「217 個 `--ec-*` token」數字有誤，實體缺口清單＝ledger「Legacy proposed declaration census」7 類 93 項表 + `drafts/ai-bim-governance.token-extension.proposed.css`）
- [ ] 1.2 為缺口新增對應的 `--ab-*` token（延伸 `ai-bim-governance.css`，維持既有 `primitive`/命名慣例），SHALL NOT 為填補缺口而退回消費 `--ec-*`
- [x] 1.3 確認 `ai-bim-governance.css` 的 import 機制（current main 由 `EdgeConsole.tsx` 直接 import）並在 `web-viewer-sample` 建置設定中接上

## 2. UnifiedConsole IA v2 收斂（console/unified/*）

- [x] 2.1 `UnifiedShell.tsx`：inline hex → `var(--ab-*)`（#357 落地；origin/main raw-hex=0、`var(--ab-` 36 處）
- [x] 2.2 `HomePage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 20）
- [x] 2.3 `WorkspacePage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 32）
- [x] 2.4 `PipelinePage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 53）
- [x] 2.5 `OpsPage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 23）
- [x] 2.6 `ConceptPage.tsx`：inline hex → `var(--ab-*)`（#357 落地；raw-hex=0、ab-var 9）
- [x] 2.7 `unified.css`：body 層級樣式改用 `--ab-*`（#357 落地；raw-hex=0、ab-var 8）
- [x] 2.8 每頁遷移後跑該頁既有 browser E2E 案例，確認功能行為不變（僅允許樣式相關的截圖差異）。證據＝`artifacts/2026-07-16-migrate-console-to-hifi-design-pr-body.md` §5（隨 #357 merge）：`hifi-token-authority.spec.ts` 3 tests 全綠（#conv loading/failure/retry/success 四態、`--ab-accent` 生效、`--ec-grn` 絕跡）、`unified-console-routes.spec.ts` 路由可達、`npx vitest run src/console/` 全綠；2026-08-11 確認上述 spec/test 檔均仍在 tree（`web-viewer-sample/e2e/hifi-token-authority.spec.ts`、`e2e/unified-console-routes.spec.ts`、`src/console/unified/unified.test.tsx`）。checkbox 此前漏勾，本次依既有證據補記。

## 3. Legacy 頁面遷移（仍掛 edge-console.css 的部分）

- [x] 3.1 盤點 `LegacyEdgeConsole` 覆蓋的路由（`#/kit`、`#/demo-control` 等）與其對應的 `edge-console-operator-frontend` spec Requirement 的 mapping（證據＝`artifacts/2026-07-16-migrate-console-to-hifi-design-pr-body.md` §5/§7；「遷移後行為逐字成立」的 closeout 歸 7.4，不在本項重複認列）
- [x] 3.2 `LegacyEdgeConsole` 各頁元件：`--ec-*` → `--ab-*`（#357 落地；`git grep -- "--ec-" origin/main -- web-viewer-sample/src` 唯一命中為守門測試自我參照）
- [x] 3.3 `ConversionPage.tsx`（`#conv` 路由）：`--ec-*` → `--ab-*`，含 `ConversionPage.test.tsx`（#357 同 PR 落地；main 該檔 ec=0、raw-hex=0）
- [x] 3.4 `governance/overlay.css`：`--ec-*` → `--ab-*`（#357 落地；ec=0、ab 11；專屬守門 `e2e/overlay-ec-token-resolution.spec.ts`）
- [x] 3.5 `viewer/*.css`（含 `MockViewport.tsx`）：`--ec-*` → `--ab-*`（#357 落地；ec=0、ab 60）
- [x] 3.6 `legacy-console.css` 內 `IntentDialog` selectors 及 `IntentDialog.css.test.ts`：`--ec-*` → `--ab-*`（repo 不存在獨立 `IntentDialog.css`，原文前提有誤；#357 已改測試，現行斷言讀 `legacy-console.css`）
- [x] 3.7 每頁遷移後跑該頁既有 browser E2E / provenance 誠實性案例，確認功能行為不變。證據＝同一 artifact §5（隨 #357 merge）：`unified-console-routes.spec.ts`（#/kit、#/demo-control 可達）、`conv-history.spec.ts`、`ConversionPage.test.tsx`、`GovernanceOverlay.test.tsx`、`governance/*.test.ts`（highlightBridge/mappingCache/govPanelState/windowOverlayGlue）、`A1CrossLinks`/`A2OverlayViewer`/`A3FederationSession` 測試全綠，provenance 誠實性與 API 呼叫零變更；2026-08-11 確認 `web-viewer-sample/e2e/conv-history.spec.ts`、`src/console/GovernanceOverlay.test.tsx` 仍在 tree。checkbox 此前漏勾，本次依既有證據補記。

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
- [ ] 6.4 **human owner only**：同步 origin（`C:\Repos\design\desigin-system`）與受保護的 repo `docs/plans/` 正本；AI 只提供 parallel proposal/draft，不原地寫入任一正本

## 7. Rebaseline 與驗證

- [ ] 7.1 執行 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`，重新擷取 13 screens × 2 viewports golden baseline
- [x] 7.2 執行 `pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`，確認通過。2026-08-11 於 HEAD `7929d74`（== origin/main）實跑：`[design-reference-gate] passed — 13 screens, 26 golden files, source=2f414d9d4bd96adbd3102e417f2465eb4aa609b0c3a12d118f41c1ccff30c9c8`。
- [ ] 7.3 跑 `web-viewer-sample` 既有測試套件（`npm run verify`），確認無 regression
- [ ] 7.4 逐條核對 `edge-console-operator-frontend` 與 `unified-governance-console` 兩份既有 spec 的相關 Scenario 仍成立（依 design.md Risk 項，行為層面的不確定 SHALL 停下澄清，不視為理所當然通過）

## 8. Archive 前置

- [x] 8.1 `npx openspec validate migrate-console-to-hifi-design --strict` 通過（2026-07-24 reconciliation rerun；2026-07-28 ledger 對帳後於 worktree 重跑仍綠）
- [x] 8.2 確認本 change 未修改 `unified-governance-console`、`edge-console-operator-frontend`、`align-frontend-design-system-reference` 任一既有 spec/change 檔案本體（僅新增 `console-design-token-authority`）
- [x] 8.3 PR 附上遷移前後截圖對照、golden baseline diff 摘要、既有功能 E2E 證據（實體＝`artifacts/2026-07-16-migrate-console-to-hifi-design-pr-body.md` §3/§4/§5/§7，已隨 #357 merge 入 main；§7「Design gate status」欄位未回填屬已知殘項）
