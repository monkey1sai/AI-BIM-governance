## 1. Token 覆蓋率盤點

- [x] 1.1 以刪除 commit `898930f` 的 parent 正本 `d3c9de3f66e8f3d74fc1b0aa6f1fa7897c5549ac:web-viewer-sample/src/console/edge-console.css` 做 parser-backed census（52 個 unique `--ec-*` 宣告名稱、78 次宣告、348 次全檔 occurrence），逐一比對 `ai-bim-governance.css` 的 `--ab-*` 語意對應並列出缺口清單（例如 diff 專用色、特定 UI 狀態色）；證據 SHALL 記錄 census 定義與可重跑命令
- [x] 1.2 為缺口新增對應的 `--ab-*` token（延伸 `ai-bim-governance.css`，維持既有 `primitive`/命名慣例），SHALL NOT 為填補缺口而退回消費 `--ec-*`
- [x] 1.3 確認 `ai-bim-governance.css` 的 import 機制（`<link>` vs `@import` vs 建置管線 bundling）並在 `web-viewer-sample` 建置設定中接上

## 2. UnifiedConsole IA v2 收斂（console/unified/*）

- [x] 2.1 `UnifiedShell.tsx`：inline hex → `var(--ab-*)`
- [x] 2.2 `HomePage.tsx`：inline hex → `var(--ab-*)`
- [ ] 2.3 `WorkspacePage.tsx`：inline hex → `var(--ab-*)`；此檔由進行中的 A4 convergence worktree 擁有，原 owner 停工並交接前 SHALL NOT 跨 worktree 覆寫
- [x] 2.4 `PipelinePage.tsx`：inline hex → `var(--ab-*)`
- [x] 2.5 `OpsPage.tsx`：inline hex → `var(--ab-*)`
- [x] 2.6 `ConceptPage.tsx`：inline hex → `var(--ab-*)`
- [x] 2.7 `unified.css`：body 層級樣式改用 `--ab-*`（現行硬寫的 `#060a10` 等值改 `var(--ab-bg)` 等）
- [ ] 2.8 每頁遷移後跑該頁既有 browser E2E 案例，確認功能行為不變（僅允許樣式相關的截圖差異）
- [ ] 2.9 與進行中的 A4 convergence worktree 收斂 `docks.tsx`、`fixtures.ts` 的 raw color/typography/radius/spacing；原 A4 owner 停工並交接前 SHALL NOT 跨 worktree 覆寫

## 3. Legacy 頁面遷移（仍掛 edge-console.css 的部分）

- [x] 3.1 盤點 `LegacyEdgeConsole` 覆蓋的路由（`#/kit`、`#/demo-control` 等）並建立其對應 `edge-console-operator-frontend` / `unified-governance-console` Requirement mapping；遷移後行為逐條核對由 task 7.4 closeout
- [x] 3.2 `LegacyEdgeConsole` 各頁元件：`--ec-*` → `--ab-*`
- [x] 3.3 `ConversionPage.tsx`（`#conv` 路由）：`--ec-*` → `--ab-*`，含 `ConversionPage.test.tsx` 一併檢視斷言是否綁死舊色碼
- [x] 3.4 `governance/overlay.css`：`--ec-*` → `--ab-*`，核對 `unified-governance-console` spec 中 `GovernanceOverlay`/`HighlightBridge`/`MappingCache` 相關 Requirement 對應的真實元件與行為不受影響
- [x] 3.5 `viewer/*.css`（含 `MockViewport.tsx`）：`--ec-*` → `--ab-*`
- [x] 3.6 `legacy-console.css` 內 `IntentDialog` selectors 及 `IntentDialog.css.test.ts`：`--ec-*` → `--ab-*`，核對測試斷言（repo 不存在獨立 `IntentDialog.css`）
- [ ] 3.7 每頁遷移後跑該頁既有 browser E2E / provenance 誠實性案例，確認本 token/style diff 未改變功能行為。三個與 `origin/main` byte-identical 的 `#conv` / `#minio` ownership assertions 明確不記為 pass；其 runtime/spec/E2E 調和已依使用者批准 deferred 至既有 change `minio-folderview-and-baseline-disclosure`，不另造 Change ID。其餘 affected-page 與 final combined-tree cases 全部通過後才勾選
- [ ] 3.8 與進行中的 A4 convergence worktree 收斂 `A4SemanticSearchPage.tsx` 與 `EdgeConsole.tsx` 的剩餘 raw style；原 A4 owner 停工並交接前 SHALL NOT 跨 worktree 覆寫
- [ ] 3.9 取得 exact-symbol CRITICAL sign-off 後，將 `ReviewSessionViewerPane.tsx` 的剩餘 raw spacing 收斂為等值 `--ab-*` token，並跑其 affected tests

## 4. 主題切換移除

- [x] 4.1 `EdgeConsole.tsx`：移除亮/暗切換按鈕 UI
- [x] 4.2 `EdgeConsole.tsx`：移除 `theme` state、`localStorage["aibim:ec-theme"]` 讀寫、`.theme-light` class 套用邏輯
- [x] 4.3 確認移除後無殘留對 `.theme-light` 或亮色 token 區塊的引用（`edge-console.css` 淺色主題區塊隨 §5 一併處理）

## 5. Retire edge-console.css

- [x] 5.1 確認 `--ec-` 使用量歸零（`grep -rc -- "--ec-" web-viewer-sample/src` 為 0，`edge-console.css` 本檔案除外；此 grep 掃整個 `src`（含 `*.ts`），唯一允許的非零命中是守門測試 `ec-token-retirement.test.ts` 自身——斷言 `/--ec-/` 需在測試碼寫出該字串，屬自我參照的必然例外，非 production CSS 殘留）
- [x] 5.2 依當時其他既有引用盤點結果（如測試 fixture 是否仍需要）決定 `edge-console.css` 是刪除還是移至歷史保存路徑，並執行
- [x] 5.3 更新任何仍提及 `edge-console.css` 為權威來源的程式碼註解或文件片段

## 6. 文件更新

- [x] 6.1 `docs/plans/AI-BIM 前後端設計文件.dc.html` §08 R1：改寫為 `ai-bim-governance.css --ab-*` 為唯一 production design token 權威
- [x] 6.2 §08：新增小節記錄「production 主色由 NVIDIA 綠改 Hi-Fi 青色系」與「移除亮色主題」為有意識決策及理由（見 design.md D4）
- [x] 6.3 §03（或其他相關章節）核對是否有仍描述 `edge-console.css`/雙主題的過時敘述需一併更新
- [x] 6.4 確認 external authoring origin（`C:\Repos\design\desigin-system`）維持唯讀且未被本 change 回寫；只更新 repo-local `docs/plans/` canonical projection，並記錄必要的唯讀 comparison evidence（CI/PR gate SHALL NOT 依賴該絕對路徑）

## 7. Rebaseline 與驗證

- [x] 7.1 執行 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`，重新擷取 13 screens × 2 viewports golden baseline
- [x] 7.2 執行 `pwsh -NoProfile -NonInteractive -File scripts/tests/verify-design-system-reference.ps1 -RepoRoot <dedicated-worktree>`，確認 repo-local tracked snapshot 通過（不帶 `-VerifyOrigin`）
- [ ] 7.3 跑 `web-viewer-sample` 既有測試套件（`npm run verify`），確認無 regression
- [ ] 7.4 逐條核對 `edge-console-operator-frontend` 與 `unified-governance-console` 的相關 Scenario，證明本 style migration 未新增行為 regression。既存的 `#conv` / `#minio` ownership mismatch 明確列為 approved deferred gap，不記為通過、也不宣稱其 Requirement 已滿足；後續由既有 change `minio-folderview-and-baseline-disclosure` 承接。除該具名 deferred gap 外，其餘 Scenario 必須在 final combined tree 閉合後才勾選

## 8. Archive 前置

- [x] 8.1 `npx openspec validate migrate-console-to-hifi-design --strict` 通過
- [x] 8.2 確認本 change 未修改 `unified-governance-console`、`edge-console-operator-frontend`、`align-frontend-design-system-reference` 任一既有 spec/change 檔案本體（僅新增 `console-design-token-authority`）
- [ ] 8.3 PR 附上遷移前後截圖對照、golden baseline diff 摘要、既有功能 E2E 證據，供 review 確認視覺遷移未夾帶行為變更
