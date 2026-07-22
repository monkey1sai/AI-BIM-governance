## ADDED Requirements

### Requirement: ai-bim-governance.css SHALL 為 UnifiedConsole 唯一 production design token 權威

`web-viewer-sample` 的 UnifiedConsole 前端（`console/` 目錄下所有頁面與元件，含已遷移的 `console/unified/*` 與尚未遷移的 `LegacyEdgeConsole`/`ConversionPage`/`governance/overlay.css`/`viewer/*.css`）SHALL 以 `docs/plans/ai-bim-governance.css`（`--ab-*` custom properties + `.ab-*` classes）為唯一 production design token 來源，取代現行 `web-viewer-sample/src/console/edge-console.css`（`--ec-*`）。`ai-bim-governance.css` SHALL 被真實引入為 CSS 依賴（`<link>`/`@import`/建置管線皆可），元件層級樣式 SHALL 消費其 `--ab-*` custom properties，SHALL NOT 手抄色碼數值到 inline style 或另建平行 CSS 檔案。

#### Scenario: production 元件消費 --ab-* token 而非手寫色碼

- **WHEN** 檢視任一 UnifiedConsole 元件（`console/unified/*.tsx`、已遷移的 legacy 頁）的樣式來源
- **THEN** 顏色/字體/圓角/間距值 SHALL 經 `var(--ab-*)` 或 `.ab-*` class 取得
- **AND** SHALL NOT 出現與 `ai-bim-governance.css` 已定義 token 數值相同的手寫十六進位色碼字面值

#### Scenario: edge-console.css 不再是任何 production 元件的樣式來源

- **WHEN** 對 `web-viewer-sample/src` 執行 `--ec-` 使用量搜尋
- **THEN** production 元件（不含遷移前的歷史 commit / 待刪除檔案本身）SHALL 回傳 0 個 `--ec-` custom property 消費
- **AND** `edge-console.css` 檔案 SHALL 標記為 retired 或移除

### Requirement: UnifiedConsole SHALL 收斂為純深色，不提供亮色主題切換

`EdgeConsole.tsx` 現行的亮/暗主題切換功能（UI 按鈕、`localStorage["aibim:ec-theme"]` 持久化、`.theme-light` class 套用邏輯）SHALL 被移除。UnifiedConsole SHALL 只以單一深色主題渲染，對齊 `ai-bim-governance.css` 現有的唯一深色 token 集合。此為有意識的產品方向調整（推翻既有「NVIDIA 綠為核心品牌，含亮色變體」設計決策），SHALL 於 `docs/plans/AI-BIM 前後端設計文件.dc.html` §08 明確記錄調整理由，SHALL NOT 靜默移除而不留紀錄。

#### Scenario: 亮色主題入口不存在

- **WHEN** 操作員開啟 UnifiedConsole 任一頁面
- **THEN** 介面 SHALL NOT 提供亮/暗主題切換控制項
- **AND** `localStorage` SHALL NOT 讀寫 `aibim:ec-theme` 鍵

#### Scenario: 品牌與主題調整誠實記錄於設計文件

- **WHEN** 讀者查閱 `docs/plans/AI-BIM 前後端設計文件.dc.html` §08
- **THEN** 文件 SHALL 明確記錄「production 主色由 NVIDIA 綠改為 Hi-Fi 青色系」與「移除亮色主題」為有意識決策及其理由
- **AND** SHALL NOT 讓讀者誤以為此為疏忽覆蓋既有品牌決策

### Requirement: 視覺遷移 SHALL NOT 變更既有功能、API 或 provenance 誠實性行為

本次視覺/design-token 遷移 SHALL 僅變更 CSS 樣式來源與外觀，SHALL NOT 變更 `openspec/specs/edge-console-operator-frontend/spec.md` 與 `openspec/specs/unified-governance-console/spec.md` 定義的任何功能行為、API 端點、coordinator-only proxy 邊界、或 provenance 誠實標記規則。所有既有 SHALL/SHALL NOT 條款（A1 rule-run、A2 apply-overlay、A3 federation、Review Room、fake-vs-real mapping 隔離、後端離線誠實顯示等）遷移後 SHALL 逐字繼續成立。

「逐字繼續成立」在本 change 的驗收語意是 SHALL NOT 由此 token/style diff 新增違規；不代表把遷移前已存在的 Requirement drift 偽報為滿足。本 change 發現但未引入的三個 `#conv` / `#minio` runtime/spec/E2E ownership failures，已依使用者批准 deferred 至既有 active change `minio-folderview-and-baseline-disclosure`。本 change SHALL 保持其相對 `origin/main` 的行為不變，SHALL NOT 把這三個失敗案例記為 pass，SHALL NOT 宣稱該 deferred Requirement 已完成，且 SHALL NOT 另造 Change ID。

#### Scenario: 既有功能行為在換皮後不變

- **WHEN** 視覺遷移完成後執行既有功能驗收（如 A1 rule-run 觸發、A2 apply-overlay 誠實顯示 501、後端離線顯示 502）
- **THEN** 行為結果 SHALL 與遷移前一致，僅外觀（顏色/字體/主題）改變
- **AND** SHALL NOT 因樣式變更而新增、移除或改變任何 coordinator/governance-service API 呼叫

#### Scenario: 既存 #conv / #minio ownership drift 誠實 deferred

- **WHEN** 三個 `#conv` / `#minio` browser cases 因遷移前已存在的 runtime/spec/E2E ownership mismatch 失敗，且相關 production/test blobs 與 `origin/main` byte-identical
- **THEN** 本 change SHALL 將其記為 approved deferred gap，不記為 pass、也不以此 change 修改行為或既有 capability spec
- **AND** SHALL 交由既有 active change `minio-folderview-and-baseline-disclosure` 承接，不另造 Change ID
- **AND** 除該具名 deferred gap 外，其餘 affected-page、final combined-tree 與 Scenario evidence gates SHALL 仍須通過

### Requirement: 遷移落地後 SHALL 重用既有 pixel/semantic 雙閘機制重新 rebaseline

視覺遷移程式碼落地後，SHALL 使用既有 `web-viewer-sample/scripts/capture-design-system-reference.mjs`（帶 `--rebaseline --confirm-rebaseline` 雙旗標）重新擷取 `docs/plans/design-system-reference.manifest.json` 的 golden baseline（13 screens × 2 viewports），SHALL NOT 新建擷取機制或手動覆寫 golden 圖檔。重新擷取後 SHALL 以 `scripts/tests/verify-design-system-reference.ps1 -RepoRoot <dedicated-worktree>` 驗證 repo-local tracked snapshot 通過；external authoring origin（`C:\Repos\design\desigin-system`）SHALL 維持唯讀，CI/PR gate SHALL NOT 依賴該絕對路徑或要求 `-VerifyOrigin`。本 change 與 `openspec/changes/align-frontend-design-system-reference` 管理的其餘雙閘機制成熟化工作平行推進、互不阻塞——機制與視覺內容正交，機制無論鎖定何種視覺皆可重用。

#### Scenario: 視覺遷移後重新 rebaseline 且驗證通過

- **WHEN** UnifiedConsole 完成 `--ab-*` token 遷移的程式碼變更
- **THEN** SHALL 執行 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`
- **AND** 隨後執行 `pwsh -NoProfile -NonInteractive -File scripts/tests/verify-design-system-reference.ps1 -RepoRoot <dedicated-worktree>` SHALL 通過
- **AND** external authoring origin SHALL 保持唯讀，且驗證 SHALL NOT 依賴 `-VerifyOrigin` 或該機器絕對路徑
- **AND** SHALL NOT 手動編輯 `design-system-reference.manifest.json` 的 baseline hash 欄位或手動置換 golden PNG

#### Scenario: 不阻塞既有雙閘機制成熟化工作

- **WHEN** `align-frontend-design-system-reference` 仍有機制成熟化 tasks 未完成
- **THEN** 本 change 的視覺遷移工作 SHALL NOT 因此被阻擋而無法開始或完成
- **AND** 本 change 的完成 SHALL NOT 要求先 archive `align-frontend-design-system-reference`
