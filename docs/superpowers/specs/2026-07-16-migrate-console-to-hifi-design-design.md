# UnifiedConsole 遷移至 Hi-Fi Design Token（ai-bim-governance.css）· Design Spec

> 日期：2026-07-16 · 狀態：已核准設計（使用者拍板，grill-me 訪談定案）· 對應 OpenSpec change：`migrate-console-to-hifi-design`（`openspec/changes/migrate-console-to-hifi-design/`，PR #353 已合併進 main，目前僅為 proposal/design/tasks/spec 四份文件，**尚無任何程式碼實作**）

## 0. 文件目的與定位

本檔是 OpenSpec change `migrate-console-to-hifi-design` 的 Superpowers spec 鏡像，供 `/spec-to-done` 的 P1（`std-plan`）讀取產生實作 plan。內容彙整自該 change 的四份原始文件（`proposal.md`／`design.md`／`tasks.md`／`specs/console-design-token-authority/spec.md`），**逐字保留其決策與任務分解**，不重新發明範圍。若本檔與 OpenSpec 原始檔案有出入，以 OpenSpec 原始檔案（`openspec/changes/migrate-console-to-hifi-design/`）為準；本檔僅是執行引擎的單一入口鏡像。

**對 plan 作者的硬約束**：第 6 節「任務分解（逐字保留，SHALL 沿用此結構）」是本 change 已核准的任務清單，plan 的 Task 切分 SHALL 以此結構為骨架（可依 writing-plans 規格拆得更細、補齊步驟與驗證指令，但 SHALL NOT 增刪任務範圍、SHALL NOT 略過任一節）。

## 1. Why（為何做這個變更）

`docs/plans/ai-bim-governance.css`（`--ab-*`/`.ab-*`，500 行完整 token 系統，自述「extracted from Hi-Fi console」）目前是零消費者的孤兒檔案：repo 全域搜尋（`.ts`/`.tsx`/`.html`/`.md`/`.json`）0 個引用，不在唯讀 authoring origin（`C:\Repos\design\desigin-system`）內，不受 `docs/plans/design-system-reference.manifest.json` 的 pixel gate 管，也不是該 manifest 自己 `token_projection.upstream_authority` 指的 `source/styles.css`（兩者 `--ab-` 命中數、內容、大小皆不同）。production 實際的唯一 CSS 真相源是 `web-viewer-sample/src/console/edge-console.css`（217 個 `--ec-*` token，NVIDIA 綠 `#76b900` 為主色，雙主題）。

使用者已在完整揭露現況（含 `edge-console.css` 內「NVIDIA 綠為核心品牌」的既有設計註解、以及亮/暗切換是真實可點的 localStorage-persisted 功能）後，明確指示：以 `AI-BIM Console Hi-Fi.dc.html` 為前端唯一操作標準、以 `ai-bim-governance.css` 為前端設計風格，並確認即使代表推翻既有品牌決策與拿掉淺色主題，仍要落地此方向。本 change 把該裁決正式轉為可驗收的 spec，讓孤兒檔案真正成為 production 消費的唯一 design token 權威。

## 2. What Changes（範圍）

- 新增 `ai-bim-governance.css`（`--ab-*` custom properties + `.ab-*` classes）為 UnifiedConsole 的唯一 production design token 真相源，**BREAKING**：取代現行 `edge-console.css`（`--ec-*`）。
- `ai-bim-governance.css` SHALL 被真實 `import` 為 CSS 依賴（`<link>`/`@import`/建置管線引入皆可），SHALL NOT 手抄色碼值到 inline style 或另一份 CSS。
- 收斂三套並存的顏色來源為一套：(a) 已遷移的 UnifiedConsole IA v2（`console/unified/*.tsx`）目前手寫 inline hex JSX style，SHALL 改為消費 `ai-bim-governance.css` 的 `--ab-*` token；(b) 尚未遷移、仍掛 `edge-console.css` 的頁面（`LegacyEdgeConsole`：`#/kit`、`#/demo-control`、`#conv` 等路由，`ConversionPage.tsx`，`governance/overlay.css`，`viewer/*.css`）SHALL 遷移至 `ai-bim-governance.css`。
- **BREAKING**：移除 `EdgeConsole.tsx` 的亮/暗主題切換功能（按鈕、`localStorage["aibim:ec-theme"]` 持久化、`theme-light` class 邏輯）。UnifiedConsole 收斂為純深色 console，對齊 `ai-bim-governance.css`（全檔僅一組深色 token，無淺色變體）。
- 品牌主色由 NVIDIA 綠（`#76b900`）改為 Hi-Fi 青色系（`#41c7e8` / `#2f7bf6`），為有意識的品牌方向調整（非疏忽覆蓋）。
- 遷移完成後，重用既有 `web-viewer-sample/scripts/capture-design-system-reference.mjs`（`--rebaseline --confirm-rebaseline`）重新擷取 `docs/plans/design-system-reference.manifest.json` 的 13 screens × 2 viewports golden baseline，不新建擷取機制。
- `docs/plans/AI-BIM 前後端設計文件.dc.html` §08 R1（現行「design token 沿用 edge-console.css --ec-* 單一真相源」）SHALL 改寫以反映新權威。

### Non-Goals（明確不做）

- 不變更 `edge-console-operator-frontend` 或 `unified-governance-console` 任何一條既有功能/API/provenance SHALL 條款。
- 不修正這兩份既有 spec 本身被發現的內部過時/不一致問題（見第 8 節 Known Risks）。
- 不擴大處理 A4–A10 願景頁以外的後端能力。
- 不等待 `align-frontend-design-system-reference` 的 task 2.4–2.8 完成才開始，兩者平行推進、互不阻塞。

## 3. 受影響程式碼與文件

- **受影響程式碼**：`web-viewer-sample/src/console/edge-console.css`（retire）、`web-viewer-sample/src/console/EdgeConsole.tsx`（移除主題切換邏輯）、`web-viewer-sample/src/console/unified/*.tsx`（`UnifiedShell`/`HomePage`/`WorkspacePage`/`PipelinePage`/`OpsPage`/`ConceptPage`，inline hex → `--ab-*` token）、`web-viewer-sample/src/console/unified/unified.css`、`web-viewer-sample/src/console/governance/overlay.css`、`web-viewer-sample/src/console/viewer/*.css`（含 `MockViewport.tsx`）、`web-viewer-sample/src/console/ConversionPage.tsx`（+`ConversionPage.test.tsx`）、`IntentDialog.css`（+`.css.test.ts`）。
- **受影響文件**：`docs/plans/AI-BIM 前後端設計文件.dc.html` §08、`docs/plans/design-system-reference.manifest.json`（golden baseline 需重新 rebaseline，13 screens × 2 viewports 全數視覺內容改變）。
- **不受影響**：`bim-review-coordinator`、`governance-service`、`bim-streaming-server`、任何 API/event/DB schema/session/conversion lifecycle。前端仍只打 coordinator `:8004`。`edge-console-operator-frontend` 與 `unified-governance-console` 定義的功能行為、provenance 標記、coordinator-only proxy 邊界逐字不變，只換視覺外觀。
- **不受影響（機制重用，非新建）**：`openspec/changes/align-frontend-design-system-reference` 管理的 pixel+semantic 雙閘機制（manifest schema、`scripts/lib/design-system-gate.ps1`、`scripts/tests/verify-design-system-reference.ps1`、`capture-design-system-reference.mjs`、`web-viewer-sample/e2e/design-system-visual.spec.ts` + `design-system-semantic-cases.ts`）—— 本 change 與其平行推進、互不阻塞，遷移完成後直接重用同一套工具重新 rebaseline。

## 4. 關鍵決策（逐字保留自 design.md）

### D1：`ai-bim-governance.css` 真實 import，而非手抄色碼延續現行 IA v2 pattern

**決策**：新頁與已遷移的 IA v2 頁面統一 `import`/`link` `ai-bim-governance.css`，元件用 `var(--ab-*)`，不手寫十六進位色碼。真實 import 才讓「唯一真相源」在技術上成立，且與 `design-system-reference.manifest.json` 已確立的 `primitive → semantic → component` token 投影哲學一致。

### D2：新建 `console-design-token-authority` capability，不對 `unified-governance-console` / `edge-console-operator-frontend` 開 MODIFIED delta

**決策**：本 change 只新增一個範圍嚴格限定在視覺/CSS token 層的 capability，不 touching 既有兩份 spec 的檔案。這兩份既有 spec 都**沒有規範任何具體顏色/CSS token 機制**——本次視覺遷移不牴觸其任何一條 SHALL。既有 spec 的內部問題記錄為 Known Risk（第 8 節），留給後續獨立處理，不在本 change 順手 reconcile。

### D3：與 `align-frontend-design-system-reference` 平行推進，不互相阻塞

**決策**：本 change 不等待該 change 的 task 2.4–2.8（branch-protection required check、11 個語意案例 approved state variants、獨立 review authority、runner/font fingerprint pin）完成才開始；反之亦然。該 change 管理的是 pixel+semantic 雙閘**機制**，與被鎖定的視覺內容正交——機制對顏色系統無感知，換皮後直接用同一套工具重新 rebaseline 即可。

### D4：品牌色與主題移除記錄於 `docs/plans/AI-BIM 前後端設計文件.dc.html` §08，不僅記錄於 OpenSpec

**決策**：`console-design-token-authority` spec 明文要求 §08 記錄「production 主色由 NVIDIA 綠改 Hi-Fi 青色系」與「移除亮色主題」為有意識決策及理由。§08 是「AI Coding 交付守則」，未來 AI coding agent 主要讀這份文件決定怎麼做；只寫在 OpenSpec change 裡（archive 後較不易被日常開發翻閱）不足以防止未來有人誤以為現行深色系是疏忽、想「修回」NVIDIA 綠。

## 5. Migration Plan（逐頁順序，來自 design.md）

1. 逐頁遷移（建議順序：先 `console/unified/*.tsx` 收斂 inline-hex → `--ab-*`，驗證既有 13 approved screens 視覺無 regression 外的功能改變；再遷移 `LegacyEdgeConsole` 覆蓋的頁面，逐頁跑其既有 E2E 證據案例）。
2. 全部遷移完成、`--ec-` 使用量歸零後，retire `edge-console.css`（移至 `deprecated/` 或直接刪除，依實作階段判斷）。
3. 移除 `EdgeConsole.tsx` 主題切換邏輯。
4. 更新 `docs/plans/AI-BIM 前後端設計文件.dc.html` §08。
5. 執行 `capture-design-system-reference.mjs --rebaseline --confirm-rebaseline` + `verify-design-system-reference.ps1 -VerifyOrigin`。
6. 若中途需要 rollback：`edge-console.css` 與 `--ab-*` 遷移可逐頁獨立 revert（非 atomic 一次性切換），因兩套 token 命名空間不重疊，可暫時並存於未完成遷移的過渡期而不互相污染。

## 6. 任務分解（逐字保留，SHALL 沿用此結構）

### 6.1 Token 覆蓋率盤點

- 逐一比對 `edge-console.css` 的 217 個 `--ec-*` token 與 `ai-bim-governance.css` 的 `--ab-*` token 語意對應，列出缺口清單（例如 diff 專用色、特定 UI 狀態色）
- 為缺口新增對應的 `--ab-*` token（延伸 `ai-bim-governance.css`，維持既有 `primitive`/命名慣例），SHALL NOT 為填補缺口而退回消費 `--ec-*`
- 確認 `ai-bim-governance.css` 的 import 機制（`<link>` vs `@import` vs 建置管線 bundling）並在 `web-viewer-sample` 建置設定中接上

### 6.2 UnifiedConsole IA v2 收斂（console/unified/*）

- `UnifiedShell.tsx`：inline hex → `var(--ab-*)`
- `HomePage.tsx`：inline hex → `var(--ab-*)`
- `WorkspacePage.tsx`：inline hex → `var(--ab-*)`
- `PipelinePage.tsx`：inline hex → `var(--ab-*)`
- `OpsPage.tsx`：inline hex → `var(--ab-*)`
- `ConceptPage.tsx`：inline hex → `var(--ab-*)`
- `unified.css`：body 層級樣式改用 `--ab-*`（現行硬寫的 `#060a10` 等值改 `var(--ab-bg)` 等）
- 每頁遷移後跑該頁既有 browser E2E 案例，確認功能行為不變（僅允許樣式相關的截圖差異）

### 6.3 Legacy 頁面遷移（仍掛 edge-console.css 的部分）

- 盤點 `LegacyEdgeConsole` 覆蓋的路由（`#/kit`、`#/demo-control` 等）與其對應的 `edge-console-operator-frontend` spec Requirement，逐條核對遷移後行為仍逐字成立
- `LegacyEdgeConsole` 各頁元件：`--ec-*` → `--ab-*`
- `ConversionPage.tsx`（`#conv` 路由）：`--ec-*` → `--ab-*`，含 `ConversionPage.test.tsx` 一併檢視斷言是否綁死舊色碼
- `governance/overlay.css`：`--ec-*` → `--ab-*`，核對 `unified-governance-console` spec 中 `GovernanceOverlay`/`HighlightBridge`/`MappingCache` 相關 Requirement 對應的真實元件與行為不受影響
- `viewer/*.css`（含 `MockViewport.tsx`）：`--ec-*` → `--ab-*`
- `IntentDialog.css` 及其 `.css.test.ts`：`--ec-*` → `--ab-*`，核對測試斷言
- 每頁遷移後跑該頁既有 browser E2E / provenance 誠實性案例，確認功能行為不變

### 6.4 主題切換移除

- `EdgeConsole.tsx`：移除亮/暗切換按鈕 UI
- `EdgeConsole.tsx`：移除 `theme` state、`localStorage["aibim:ec-theme"]` 讀寫、`.theme-light` class 套用邏輯
- 確認移除後無殘留對 `.theme-light` 或亮色 token 區塊的引用（`edge-console.css` 淺色主題區塊隨 6.5 一併處理）

### 6.5 Retire edge-console.css

- 確認 `--ec-` 使用量歸零（`grep -rc -- "--ec-" web-viewer-sample/src` 為 0，`edge-console.css` 本檔案除外；此 grep 掃整個 `src`（含 `*.ts`），故唯一允許的非零命中是守門測試 `ec-token-retirement.test.ts` 自身——斷言 `/--ec-/` 必須在測試碼寫出該字串，屬自我參照的必然例外，非 production CSS 殘留。production CSS 側維持零 `--ec-`）
- 依當時其他既有引用盤點結果（如測試 fixture 是否仍需要）決定 `edge-console.css` 是刪除還是移至歷史保存路徑，並執行
- 更新任何仍提及 `edge-console.css` 為權威來源的程式碼註解或文件片段

### 6.6 文件更新

- `docs/plans/AI-BIM 前後端設計文件.dc.html` §08 R1：改寫為 `ai-bim-governance.css --ab-*` 為唯一 production design token 權威
- §08：新增小節記錄「production 主色由 NVIDIA 綠改 Hi-Fi 青色系」與「移除亮色主題」為有意識決策及理由（見第 4 節 D4）
- §03（或其他相關章節）核對是否有仍描述 `edge-console.css`/雙主題的過時敘述需一併更新
- origin（`C:\Repos\design\desigin-system`）與 repo `docs/plans/` 副本同步更新（比照 PR #353 的作法）

### 6.7 Rebaseline 與驗證

- 執行 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`，重新擷取 13 screens × 2 viewports golden baseline
- 執行 `pwsh scripts/tests/verify-design-system-reference.ps1 -VerifyOrigin`，確認通過
- 跑 `web-viewer-sample` 既有測試套件（`npm run verify`），確認無 regression
- 逐條核對 `edge-console-operator-frontend` 與 `unified-governance-console` 兩份既有 spec 的相關 Scenario 仍成立（依第 8 節 Risk 項，行為層面的不確定 SHALL 停下澄清，不視為理所當然通過）

### 6.8 Archive 前置

- `npx openspec validate migrate-console-to-hifi-design --strict` 通過
- 確認本 change 未修改 `unified-governance-console`、`edge-console-operator-frontend`、`align-frontend-design-system-reference` 任一既有 spec/change 檔案本體（僅新增 `console-design-token-authority`）
- PR 附上遷移前後截圖對照、golden baseline diff 摘要、既有功能 E2E 證據，供 review 確認視覺遷移未夾帶行為變更

## 7. Capability Spec Requirements（逐字保留自 specs/console-design-token-authority/spec.md）

四條 ADDED Requirement（完整條文見 `openspec/changes/migrate-console-to-hifi-design/specs/console-design-token-authority/spec.md`，plan 與實作 SHALL 逐字滿足）：

1. **`ai-bim-governance.css` SHALL 為 UnifiedConsole 唯一 production design token 權威** —— 所有 UnifiedConsole 元件 SHALL 消費 `--ab-*`，SHALL NOT 手寫十六進位色碼；`--ec-` 使用量 SHALL 歸零；`edge-console.css` SHALL 標記 retired 或移除。
2. **UnifiedConsole SHALL 收斂為純深色，不提供亮色主題切換** —— 移除主題切換 UI/state/localStorage 讀寫；§08 SHALL 誠實記錄品牌與主題調整理由，SHALL NOT 讓讀者誤以為是疏忽覆蓋。
3. **視覺遷移 SHALL NOT 變更既有功能、API 或 provenance 誠實性行為** —— `edge-console-operator-frontend` 與 `unified-governance-console` 兩份既有 spec 定義的所有 SHALL/SHALL NOT 條款（A1 rule-run、A2 apply-overlay、A3 federation、Review Room、fake-vs-real mapping 隔離、後端離線誠實顯示等）遷移後 SHALL 逐字繼續成立，SHALL NOT 因樣式變更而新增/移除/改變任何 coordinator/governance-service API 呼叫。
4. **遷移落地後 SHALL 重用既有 pixel/semantic 雙閘機制重新 rebaseline** —— SHALL NOT 新建擷取機制或手動覆寫 golden 圖檔；與 `align-frontend-design-system-reference` 平行推進、互不阻塞。

## 8. Known Risks / Trade-offs（記錄不處理，超出本 change 範圍；逐字保留）

- `openspec/specs/edge-console-operator-frontend/spec.md` 描述的頁面結構（`CoordinatorPage`/`IntakePage`/`RuntimePage`/`AppsPage`/`OverviewPage` 等扁平頁）未反映 `#349`/`#350`（UnifiedConsole IA v2）後的新 IA 結構，本 change 不代為修正。
- `openspec/specs/unified-governance-console/spec.md`（311 行）內部混雜至少兩三種不同時期的架構描述（primary-viewer-overlay 治理架構 `GovernanceOverlay`/`HighlightBridge`/`MappingCache` vs. 英文寫的 grouped-navigation product console shell），且引用 `docs/frontend/frontend-design-guidelines.md`（另一份尚未查核的文件）。這份 spec 本身的內部一致性與是否反映當前實碼，超出本 change 查核範圍，本 change 只確認其未規範具體顏色/CSS token 機制、不因本次視覺遷移而牴觸。
- `openspec/changes/align-frontend-design-system-reference` 的 `documentation-source-of-truth/spec.md` 仍逐字引用已於 `#342` 刪除的 `docs/plans/TRUTH`/`TARGET`/`PROCESS`/`BACKLOG` 四檔案所有權模型，已於 PR #353 的 `docs/plans/AI-BIM 前後端設計文件.dc.html` §07 記一筆已知不一致，本 change 不代為修正該 change 的 spec 檔案本體。
- 26 個既有 golden baseline 全數作廢（預期且必要的代價），遷移完成立即用既有工具重新鎖定。
- `ai-bim-governance.css` 本身可能未覆蓋 `edge-console.css` 217 個 token 涵蓋的所有語意（例如某些 UI 狀態色、diff 專用色）——缺口不應阻塞整體遷移但需誠實記錄（對應第 6.1 節任務）。

## 9. userFacing 判定

`true`——本 change 直接變更 UnifiedConsole 全體使用者可見的視覺樣式、品牌色與主題行為，plan SHALL 包含 browser E2E task（`web-viewer-sample/e2e/` 慣例位置），驗 vertical slice：UI route → 按鈕 → default fixture → 真實 backend API → runtime ID → loading/success/failure/retry；僅樣式相關的截圖差異可接受，不接受任何行為差異。
