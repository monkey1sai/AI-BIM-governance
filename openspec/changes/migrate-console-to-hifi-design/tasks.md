## 1. Token 覆蓋率盤點

- [ ] 1.1 逐一比對 `edge-console.css` 的 217 個 `--ec-*` token 與 `ai-bim-governance.css` 的 `--ab-*` token 語意對應，列出缺口清單（例如 diff 專用色、特定 UI 狀態色）
- [ ] 1.2 為缺口新增對應的 `--ab-*` token（延伸 `ai-bim-governance.css`，維持既有 `primitive`/命名慣例），SHALL NOT 為填補缺口而退回消費 `--ec-*`
- [ ] 1.3 確認 `ai-bim-governance.css` 的 import 機制（`<link>` vs `@import` vs 建置管線 bundling）並在 `web-viewer-sample` 建置設定中接上

## 2. UnifiedConsole IA v2 收斂（console/unified/*）

- [ ] 2.1 `UnifiedShell.tsx`：inline hex → `var(--ab-*)`
- [ ] 2.2 `HomePage.tsx`：inline hex → `var(--ab-*)`
- [ ] 2.3 `WorkspacePage.tsx`：inline hex → `var(--ab-*)`
- [ ] 2.4 `PipelinePage.tsx`：inline hex → `var(--ab-*)`
- [ ] 2.5 `OpsPage.tsx`：inline hex → `var(--ab-*)`
- [ ] 2.6 `ConceptPage.tsx`：inline hex → `var(--ab-*)`
- [ ] 2.7 `unified.css`：body 層級樣式改用 `--ab-*`（現行硬寫的 `#060a10` 等值改 `var(--ab-bg)` 等）
- [ ] 2.8 每頁遷移後跑該頁既有 browser E2E 案例，確認功能行為不變（僅允許樣式相關的截圖差異）

## 3. Legacy 頁面遷移（仍掛 edge-console.css 的部分）

- [ ] 3.1 盤點 `LegacyEdgeConsole` 覆蓋的路由（`#/kit`、`#/demo-control` 等）與其對應的 `edge-console-operator-frontend` spec Requirement，逐條核對遷移後行為仍逐字成立
- [ ] 3.2 `LegacyEdgeConsole` 各頁元件：`--ec-*` → `--ab-*`
- [ ] 3.3 `ConversionPage.tsx`（`#conv` 路由）：`--ec-*` → `--ab-*`，含 `ConversionPage.test.tsx` 一併檢視斷言是否綁死舊色碼
- [ ] 3.4 `governance/overlay.css`：`--ec-*` → `--ab-*`，核對 `unified-governance-console` spec 中 `GovernanceOverlay`/`HighlightBridge`/`MappingCache` 相關 Requirement 對應的真實元件與行為不受影響
- [ ] 3.5 `viewer/*.css`（含 `MockViewport.tsx`）：`--ec-*` → `--ab-*`
- [ ] 3.6 `IntentDialog.css` 及其 `.css.test.ts`：`--ec-*` → `--ab-*`，核對測試斷言
- [ ] 3.7 每頁遷移後跑該頁既有 browser E2E / provenance 誠實性案例，確認功能行為不變

## 4. 主題切換移除

- [ ] 4.1 `EdgeConsole.tsx`：移除亮/暗切換按鈕 UI
- [ ] 4.2 `EdgeConsole.tsx`：移除 `theme` state、`localStorage["aibim:ec-theme"]` 讀寫、`.theme-light` class 套用邏輯
- [ ] 4.3 確認移除後無殘留對 `.theme-light` 或亮色 token 區塊的引用（`edge-console.css` 淺色主題區塊隨 §5 一併處理）

## 5. Retire edge-console.css

- [ ] 5.1 確認 `--ec-` 使用量歸零（`grep -rc -- "--ec-" web-viewer-sample/src` 為 0，`edge-console.css` 本檔案除外）
- [ ] 5.2 依當時其他既有引用盤點結果（如測試 fixture 是否仍需要）決定 `edge-console.css` 是刪除還是移至歷史保存路徑，並執行
- [ ] 5.3 更新任何仍提及 `edge-console.css` 為權威來源的程式碼註解或文件片段

## 6. 文件更新

- [ ] 6.1 `docs/plans/AI-BIM 前後端設計文件.dc.html` §08 R1：改寫為 `ai-bim-governance.css --ab-*` 為唯一 production design token 權威
- [ ] 6.2 §08：新增小節記錄「production 主色由 NVIDIA 綠改 Hi-Fi 青色系」與「移除亮色主題」為有意識決策及理由（見 design.md D4）
- [ ] 6.3 §03（或其他相關章節）核對是否有仍描述 `edge-console.css`/雙主題的過時敘述需一併更新
- [ ] 6.4 origin（`C:\Repos\design\desigin-system`）與 repo `docs/plans/` 副本同步更新（比照 PR #353 的作法）

## 7. Rebaseline 與驗證

- [ ] 7.1 執行 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`，重新擷取 13 screens × 2 viewports golden baseline
- [ ] 7.2 執行 `pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`，確認通過
- [ ] 7.3 跑 `web-viewer-sample` 既有測試套件（`npm run verify`），確認無 regression
- [ ] 7.4 逐條核對 `edge-console-operator-frontend` 與 `unified-governance-console` 兩份既有 spec 的相關 Scenario 仍成立（依 design.md Risk 項，行為層面的不確定 SHALL 停下澄清，不視為理所當然通過）

## 8. Archive 前置

- [ ] 8.1 `npx openspec validate migrate-console-to-hifi-design --strict` 通過
- [ ] 8.2 確認本 change 未修改 `unified-governance-console`、`edge-console-operator-frontend`、`align-frontend-design-system-reference` 任一既有 spec/change 檔案本體（僅新增 `console-design-token-authority`）
- [ ] 8.3 PR 附上遷移前後截圖對照、golden baseline diff 摘要、既有功能 E2E 證據，供 review 確認視覺遷移未夾帶行為變更
