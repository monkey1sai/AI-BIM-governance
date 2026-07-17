# migrate-console-to-hifi-design — PR 證據包（Task 11 備妥素材）

> 本檔為 Task 11（spec §6.8 Archive 前置）之驗證結果與 PR body 素材彙整，**非**最終 PR 描述本身；
> 實際開 PR 由後續 ship 流程（P6）依此素材組裝，並須依當時真實 diff 重跑 `Get-DesignSystemChangeScope`
> 以填入機器驗證欄位（見下方「⚠ CI Gate 風險」一節，本檔已預先跑出結果並非樂觀假設）。

## 1. Step 1–3 驗證結果（逐字記錄，未美化）

### Step 1: OpenSpec 驗證
```
npx openspec validate migrate-console-to-hifi-design --strict
→ Change 'migrate-console-to-hifi-design' is valid
```
PASS。

### Step 2: 邊界零污染 gate
```
git diff --name-only origin/main...HEAD -- openspec/specs/unified-governance-console openspec/specs/edge-console-operator-frontend openspec/changes/align-frontend-design-system-reference
→ (無輸出)
```
PASS — 三個既有 spec/change 檔案本體零觸碰。

### Step 3: 完成定義三連
```
grep -rn -- "--ec-" web-viewer-sample/src
```
輸出**非空**——僅命中 `web-viewer-sample/src/console/ec-token-retirement.test.ts`（7 行：3 行中文註解說明 + 1 行
describe 標題 + 1 行 it.each 標題 + 1 行 `not.toMatch(/--ec-/)` 正規式字面量 + 1 行注意事項註解）。

**誠實記錀**：這是 Task 6（commit `c75a832`，Important #1 review 發現後補的持久化回歸守門測試）刻意的自我參照——
該測試存在的目的就是「斷言 `legacy-console.css` 與 `governance/overlay.css` 兩份**production CSS**不再含
`--ec-`」，斷言本身必然要在原始碼裡寫出 `/--ec-/` 這個正規式字面量才能檢查它。spec §6.5 原文「`grep -rc --
"--ec-" web-viewer-sample/src` 為 0，`edge-console.css` 本檔案除外」是在此守門測試存在**之前**寫成的措辭，
未預見這個自我參照的例外。

**production CSS 本身**（唯一 spec §6.5 真正關心的對象）核實為零殘留：
```
grep -c -- "--ec-" web-viewer-sample/src/console/legacy-console.css web-viewer-sample/src/console/governance/overlay.css
→ 兩檔皆 0
```
`edge-console.css` 已刪除（Task 7/commit `3d3b004`），故 spec 原文的例外條款已不適用（無此檔可談例外）。

```
grep -rn "#[0-9a-fA-F]\{6\}" web-viewer-sample/src/console/unified/
→ (無輸出)
```
PASS——`console/unified/` 內十六進位色碼歸零。

```
git log --oneline origin/main..HEAD
→ 24 commits, task#0 ~ task#9（涵蓋 Task 1–10 全部）
```
PASS——commit 序列完整涵蓋 Task 1–10。

## 2. ⚠ CI Gate 風險（本 task 執行時新發現，不在 plan Step 4 原始清單內，須升級處理）

用真實 base/head（`origin/main` = `713c7a5` … `HEAD` = `2830bea`）跑 `Get-DesignSystemChangeScope`（`scripts/lib/design-system-gate.ps1`，
與 `check-pr-body-evidence.ps1`／`pr-review-agent.yml` CI 用的同一支函式）：

```json
{
  "status": "reference_authority_mixed_fail_closed",
  ...
  "reference_authority_paths": ["docs/plans/design-system-reference.manifest.json"],
  "gate_infrastructure_paths": ["docs/plans/design-system-reference.manifest.json"]
}
```

`check-pr-body-evidence.ps1` 對任何 `*_fail_closed` status 無條件 `throw`（無 override 路徑）：
```powershell
if ($designScope.status -like '*_fail_closed') {
    throw "Frontend design scope failed closed with status '$($designScope.status)'; ..."
}
```

**根因**：本分支同時修改了（a）`docs/plans/design-system-reference.manifest.json`（Task 10 rebaseline，
屬 gate 自身定義的 `reference_authority_path_patterns`）與（b）UnifiedConsole/legacy console 產品碼
（Tasks 1–9）。gate 的既有設計是：reference-authority 檔案與 frontend product 檔案**同一 PR 混合出現即 fail-closed**，
禁止「順手用 rebaseline 掩護產品行為變更」。

**本 repo 已有明確先例**：PR #349（`ca20a9c`，commit message 原文）——
> 「產品側（UnifiedConsole 13 screens 像素移植）隨後續 PR 上；本 PR 為 reference_authority+gate_infrastructure，
> 依 fail-closed 憲法與產品碼分離」

即 PR #349（只動 manifest + gate infra）與 PR #350（只動產品碼）刻意拆成兩個 PR，正是為了繞開這同一條
`reference_authority_mixed_fail_closed`。

**結論**：若本分支現狀（24 commits，manifest rebaseline 與 9 個產品 task 同在一支）直接開一個 PR，
`pr-review-agent`（main 上的 required check）的 `check-pr-body-evidence.ps1` 步驟會在 gate 計算階段直接
`throw`，PR 無法通過。**這不是本 task（驗證 + PR body 組裝）能在 scope 內修正的**——修正需要對 branch/PR
結構做決策（例如比照 #349/#350 拆成「manifest rebaseline」與「產品遷移」兩個 PR，或取得維護者對 fail-closed
規則的例外授權），不屬於「無新檔（驗證 + PR body 組裝）」的 Task 11 範圍，且 `scripts/lib/design-system-gate.ps1`
本身在 Global Constraints 明文 SHALL NOT 修改。**升級給下一階段（P6 PR + ship-item）處理**，開 PR 前必須先解決
此 gate 衝突，否則會在 CI 撞牆。

## 3. 遷移前後截圖對照

**前**：
- Hi-Fi 目標設計 origin baseline：`docs/plans/design-system-baseline/console.home.default/1440x900.png`
  （unified 頁像素零漂移置換，遷移前後理論上與此基準一致，見下方 §4）
- main 分支 legacy（NVIDIA 綠）截圖：`artifacts/e2e/edge-console-primary-ui-deploy/edge-console-demo-control.png`、
  `artifacts/e2e/edge-console-primary-ui-deploy/edge-console-kit.png`、
  `artifacts/e2e/edge-console-primary-ui-deploy/legacy-dev-console.png`（origin/main 既有檔案，品牌綠 #76b900）

**後**：
- `artifacts/e2e/hifi-token-authority/unified-home.png`（unified home，Hi-Fi 青 `--ab-accent` #41c7e8）
- `artifacts/e2e/hifi-token-authority/legacy-conv.png`（#conv 佇列頁，品牌轉青）
- `artifacts/e2e/hifi-token-authority/legacy-demo-control.png`（#/demo-control）
- `artifacts/e2e/hifi-token-authority/legacy-kit.png`（#/kit）
（以上四檔已於 Task 9 commit `e513d6c`/`8788f3d` `git add -f` 入庫）

## 4. Golden baseline diff 摘要（Task 10 實況）

- 執行 `capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`：13 screens × 2 viewports 重擷取。
- 26 個 baseline PNG **位元恆等**（origin 視覺未變）；`docs/plans/design-system-reference.manifest.json` 僅
  `source.files` 內 dc.html hash（因 Task 8 §08 文件同步而變）、`baseline_snapshot_sha256`、`captured_at_utc`
  三處 metadata 更新。
- 與 spec §8「26 個既有 golden baseline 全數作廢」的預期字面上不同——機理見 plan「導航前提」：baseline 是從
  **authoring origin**（`C:\Repos\design\desigin-system`，非本 repo）擷取，origin 視覺本身沒變，13 screens 全是
  UnifiedConsole 頁（值恆等 hex→var(--ab-*) 置換），故 rebaseline 結果與原基準一致是**預期且已驗證**的結果，不是
  遺漏 rebaseline。
- `pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`：PASS（origin and 26 baselines verified）。

## 5. 既有功能 E2E 證據

- `hifi-token-authority.spec.ts`（Task 9，真 coordinator :8017、webhook 種 `ifc_ready_job_id`）：4 tests 全綠
  （commit `e513d6c` 初版 4 綠；`8788f3d` 修正 retry/loading 綁定後 3 tests 8.9s 全綠；`ef7da16` 補埠前置守門）。
  斷言涵蓋：#conv 頁 loading/failure/retry/success 四態、unified home 與 legacy 頁 computed style
  `--ab-accent` = `#41c7e8`（品牌青生效）、`--ec-grn` 絕跡、主題鍵/`.theme-light`/切換鈕全數退場、
  `#/demo-control` 與 `#/kit` 路由可達。
- Task 10 Step 4 Scenario 對照（既有兩份 spec 行為不變證據）：
  - `edge-console-operator-frontend`：`unified-console-routes.spec.ts`（#/kit、#/demo-control、#/review 可達）、
    `hifi-token-authority.spec.ts`（#conv 垂直切片）、`conv-history.spec.ts`（#conv functional gate）、
    vitest `console.test.tsx`/`ConversionPage.test.tsx` 全綠。
  - `unified-governance-console`：`GovernanceOverlay.test.tsx`、`governance/*.test.ts`
    （highlightBridge/mappingCache/govPanelState/windowOverlayGlue）、`A1CrossLinks`/`A2OverlayViewer`/
    `A3FederationSession` 測試全綠——Task 5/7 後 provenance 誠實性與 API 呼叫零變更。
  - `npx vitest run src/console/`：console 全套綠（Task 10 Step 4）。

## 6. BREAKING 揭露

依 §08 R1a（`docs/plans/AI-BIM 前後端設計文件.dc.html`，Task 8 新增）：

> Primary brand: NVIDIA green `#76b900` → Hi-Fi cyan `#41c7e8` / `#2f7bf6`
> Light theme: REMOVED（`localStorage aibim:ec-theme` + `.theme-light` 退役）
> UnifiedConsole = dark-only console

使用者在完整揭露現況（含原「NVIDIA 綠為核心品牌」設計註解與可用的亮/暗切換）後拍板：以
`AI-BIM Console Hi-Fi.dc.html` 為前端唯一操作標準、`ai-bim-governance.css` 為唯一 design token 權威。
深色青系是刻意的品牌方向調整，非疏忽覆蓋，依據 OpenSpec change `migrate-console-to-hifi-design`。

out-of-repo origin 同步路徑：`C:\Repos\design\desigin-system`（Task 8，比照 PR #353 作法）。

## 7. Frontend Verification 素材（供 P6 依 §2 CI Gate 風險解決後，用真實 diff 重算 `Get-DesignSystemChangeScope` 填表）

| 欄位 | 素材值 |
|---|---|
| Frontend route | `/ui`、`/ui#conv`、`/ui#/demo-control`、`/ui#/kit` |
| Main button(s) tested | `#conv` 頁 `conv-refresh` 鈕（點擊觸發 `refresh()` → `data.load()` → `GET /api/external/ifc-ready`） |
| Fixture used | coordinator webhook 種入 `ifc_ready_job_id`（真實核發，非硬編） |
| Backend API called | `GET /api/external/ifc-ready`（真 coordinator :8017） |
| Runtime action | `ifc_ready_job_id=<webhook 核發值>`（見 `hifi-token-authority.spec.ts` 執行輸出） |
| Visible success state | loading（`conv-refresh` `toBeDisabled` + 「載入中」）/ success（jobId 列表可見）/ failure（route 攔截）/ retry（點擊 `conv-refresh` 重試） |
| E2E command | `npx playwright test --config=playwright.functional-runtime.config.ts` |
| Screenshot / trace | `artifacts/e2e/hifi-token-authority/*.png`（4 檔，見 §3） |
| Design reference manifest | `docs/plans/design-system-reference.manifest.json` |
| Design gate status | **待 P6 依當時真實 diff 重算**——本 task 執行當下算出 `reference_authority_mixed_fail_closed`（見 §2，須先解決才能開 PR） |
| Design screen(s) | 13 screens（`console.home.default` 等，見 §2 JSON `required_screen_ids`） |
| Reference-missing route(s) / surface(s) | `#admin, #conv, #gpu, #instances, #issues, #minio, #reports, #review, #sessions, #spec, #viewer`（既有缺口，本 change 未擴大） |
| Full completion claimed | no（`full_completion_allowed=false`，因 §2 fail-closed 狀態） |
| Visual fidelity result | `artifacts/e2e/design-system-visual-result.json`（`npm run test:visual:design-system` 產出，Task 10 Step 3 PASS） |
| Visual comparison | pixel diff ≤1%、semantic parity 100%（Task 10 Step 3 `npm run verify` + `test:visual:design-system` 全綠） |
| Visual artifacts | actual/diff PNG（`npm run test:visual:design-system` 標準輸出路徑，26 比對） |
| Known gaps | ChatUSD 欄位維持 PREVIEW（後端未建，既有誠實標示，非本 change 範圍）；§2 CI Gate 風險（fail-closed）待 P6 解決 |
