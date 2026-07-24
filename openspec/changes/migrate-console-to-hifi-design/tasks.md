## 0. Current-main convergence reconciliation（2026-07-24）

- [x] 0.1 固定 current main `1959a4905a76ee95d9f314a6e52c67a415a7700f`、legacy tip `94a557571c25fe6e058251d39e3dad139eb65bf3` 與兩個 CSS blob，禁止整包 cherry-pick
- [x] 0.2 以 parser-backed census 確認 current/legacy canon 分別有 86/179 個 unique declaration、差集為 93；legacy consumer 相對 current canon 的第 94 個缺名是負向測試 sentinel `--ab-not-real`
- [x] 0.3 建立 `token-gap-ledger.md` 與 `adjudication-index.md`，揭露 current-main 已完成事項、未裁決缺口與 GitNexus HIGH/CRITICAL gates
- [x] 0.4 在 `drafts/ai-bim-governance.token-extension.proposed.css` 保存平行 proposal；不得 import、不得覆寫受保護 canon
- [ ] 0.5 使用者逐項裁決 token disposition 與 consumer migration blast radius；canon adoption 仍由 human owner 執行，AI 只維護 parallel proposal/draft，frontend visual slice 另依核准範圍啟動

## 1. Token 覆蓋率盤點

- [ ] 1.1 逐一比對 `edge-console.css` 的 217 個 `--ec-*` token 與 `ai-bim-governance.css` 的 `--ab-*` token 語意對應，列出缺口清單（例如 diff 專用色、特定 UI 狀態色）
- [ ] 1.2 為缺口新增對應的 `--ab-*` token（延伸 `ai-bim-governance.css`，維持既有 `primitive`/命名慣例），SHALL NOT 為填補缺口而退回消費 `--ec-*`
- [x] 1.3 確認 `ai-bim-governance.css` 的 import 機制（current main 由 `EdgeConsole.tsx` 直接 import）並在 `web-viewer-sample` 建置設定中接上

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

- [x] 4.1 `EdgeConsole.tsx`：亮/暗切換按鈕 UI 已移除（current-main source + regression guard verified）
- [x] 4.2 `EdgeConsole.tsx`：`theme` state、`localStorage["aibim:ec-theme"]` 讀寫、`.theme-light` class 套用邏輯已移除
- [x] 4.3 production source 無 `.theme-light` / `aibim:ec-theme` 殘留，且 `EdgeConsole.theme-removal.test.ts` 鎖定 regression guard

## 5. Retire edge-console.css

- [x] 5.1 確認 production `--ec-` 使用量歸零（2026-07-24 current-main reconciliation 排除 tests/specs 後為 0）
- [x] 5.2 確認 current main 已移除 `edge-console.css`，production 改由 `legacy-console.css` 消費 `--ab-*`
- [ ] 5.3 更新任何仍提及 `edge-console.css` 為權威來源的程式碼註解或文件片段

## 6. 文件更新

- [x] 6.1 current canon §08 R1 已記錄 `ai-bim-governance.css --ab-*` 為唯一 production design token 權威（本 reconciliation 僅讀取驗證，未寫 canon）
- [x] 6.2 current canon §08 已記錄「production 主色由 NVIDIA 綠改 Hi-Fi 青色系」與「移除亮色主題」為有意識決策（本 reconciliation 僅讀取驗證）
- [ ] 6.3 §03（或其他相關章節）核對是否有仍描述 `edge-console.css`/雙主題的過時敘述需一併更新
- [ ] 6.4 **human owner only**：同步 origin（`C:\Repos\design\desigin-system`）與受保護的 repo `docs/plans/` 正本；AI 只提供 parallel proposal/draft，不原地寫入任一正本

## 7. Rebaseline 與驗證

- [ ] 7.1 執行 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`，重新擷取 13 screens × 2 viewports golden baseline
- [ ] 7.2 執行 `pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`，確認通過
- [ ] 7.3 跑 `web-viewer-sample` 既有測試套件（`npm run verify`），確認無 regression
- [ ] 7.4 逐條核對 `edge-console-operator-frontend` 與 `unified-governance-console` 兩份既有 spec 的相關 Scenario 仍成立（依 design.md Risk 項，行為層面的不確定 SHALL 停下澄清，不視為理所當然通過）

## 8. Archive 前置

- [x] 8.1 `npx openspec validate migrate-console-to-hifi-design --strict` 通過（2026-07-24 reconciliation rerun）
- [x] 8.2 確認本 change 未修改 `unified-governance-console`、`edge-console-operator-frontend`、`align-frontend-design-system-reference` 任一既有 spec/change 檔案本體（僅新增 `console-design-token-authority`）
- [ ] 8.3 PR 附上遷移前後截圖對照、golden baseline diff 摘要、既有功能 E2E 證據，供 review 確認視覺遷移未夾帶行為變更
