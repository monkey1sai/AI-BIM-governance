## Why

`docs/plans/ai-bim-governance.css`（`--ab-*`/`.ab-*`，500 行完整 token 系統，自述「extracted from Hi-Fi console」）目前是零消費者的孤兒檔案：repo 全域搜尋（`.ts`/`.tsx`/`.html`/`.md`/`.json`）0 個引用，不在唯讀 authoring origin（`C:\Repos\design\desigin-system`）內，不受 `docs/plans/design-system-reference.manifest.json` 的 pixel gate 管，也不是該 manifest 自己 `token_projection.upstream_authority` 指的 `source/styles.css`（兩者 `--ab-` 命中數、內容、大小皆不同）。production 實際的唯一 CSS 真相源是 `web-viewer-sample/src/console/edge-console.css`（217 個 `--ec-*` token，NVIDIA 綠 `#76b900` 為主色，雙主題）。使用者已在完整揭露現況（含 `edge-console.css` 內「NVIDIA 綠為核心品牌」的既有設計註解、以及亮/暗切換是真實可點的 localStorage-persisted 功能）後，明確指示：以 `AI-BIM Console Hi-Fi.dc.html` 為前端唯一操作標準、以 `ai-bim-governance.css` 為前端設計風格，並確認即使代表推翻既有品牌決策與拿掉淺色主題，仍要落地此方向。本 change 把該裁決正式轉為可驗收的 spec，讓孤兒檔案真正成為 production 消費的唯一 design token 權威。

## What Changes

- 新增 `ai-bim-governance.css`（`--ab-*` custom properties + `.ab-*` classes）為 UnifiedConsole 的唯一 production design token 真相源，**BREAKING**：取代現行 `edge-console.css`（`--ec-*`）。
- `ai-bim-governance.css` SHALL 被真實 `import` 為 CSS 依賴（`<link>`/`@import`/建置管線引入皆可，細節見 design.md），SHALL NOT 手抄色碼值到 inline style 或另一份 CSS。
- 收斂三套並存的顏色來源為一套：(a) 已遷移的 UnifiedConsole IA v2（`console/unified/*.tsx`）目前手寫 inline hex JSX style，SHALL 改為消費 `ai-bim-governance.css` 的 `--ab-*` token；(b) 尚未遷移、仍掛 `edge-console.css` 的頁面（`LegacyEdgeConsole`：`#/kit`、`#/demo-control`、`#conv` 等路由，`ConversionPage.tsx`，`governance/overlay.css`，`viewer/*.css`）SHALL 遷移至 `ai-bim-governance.css`。
- **BREAKING**：移除 `EdgeConsole.tsx` 的亮/暗主題切換功能（按鈕、`localStorage["aibim:ec-theme"]` 持久化、`theme-light` class 邏輯）。UnifiedConsole 收斂為純深色 console，對齊 `ai-bim-governance.css`（全檔僅一組深色 token，無淺色變體）。
- 品牌主色由 NVIDIA 綠（`#76b900`）改為 Hi-Fi 青色系（`#41c7e8` / `#2f7bf6`），為有意識的品牌方向調整（非疏忽覆蓋）。
- 遷移完成後，重用既有 `web-viewer-sample/scripts/capture-design-system-reference.mjs`（`--rebaseline --confirm-rebaseline`）重新擷取 `docs/plans/design-system-reference.manifest.json` 的 13 screens × 2 viewports golden baseline，不新建擷取機制。
- `docs/plans/AI-BIM 前後端設計文件.dc.html` §08 R1（現行「design token 沿用 edge-console.css --ec-* 單一真相源」）SHALL 改寫以反映新權威。

## Capabilities

### New Capabilities
- `console-design-token-authority`：定義 UnifiedConsole production CSS design token 的唯一權威來源、真實 import 契約、深色-only 主題邊界，以及與既有 pixel/semantic 雙閘機制的重用關係。

### Modified Capabilities
（無）現行 `unified-governance-console` 與 `edge-console-operator-frontend` 兩份 capability spec 均未規範具體顏色/CSS token 機制（只規範功能行為、API 邊界、provenance 誠實性），本 change 不觸及其任何 SHALL 條款，故無需為其建立 delta spec。

## Impact

- **受影響程式碼**：`web-viewer-sample/src/console/edge-console.css`（retire）、`web-viewer-sample/src/console/EdgeConsole.tsx`（移除主題切換邏輯）、`web-viewer-sample/src/console/unified/*.tsx`（inline hex → `--ab-*` token）、`web-viewer-sample/src/console/unified/unified.css`、`web-viewer-sample/src/console/governance/overlay.css`、`web-viewer-sample/src/console/viewer/*.css`、`web-viewer-sample/src/console/ConversionPage.tsx`。
- **受影響文件**：`docs/plans/AI-BIM 前後端設計文件.dc.html` §08、`docs/plans/design-system-reference.manifest.json`（golden baseline 需重新 rebaseline，13 screens × 2 viewports 全數視覺內容改變）。
- **不受影響**：`bim-review-coordinator`、`governance-service`、`bim-streaming-server`、任何 API/event/DB schema/session/conversion lifecycle。前端仍只打 coordinator `:8004`。`edge-console-operator-frontend` 與 `unified-governance-console` 定義的功能行為、provenance 標記、coordinator-only proxy 邊界逐字不變，只換視覺外觀。
- **不受影響（機制重用，非新建）**：`openspec/changes/align-frontend-design-system-reference` 管理的 pixel+semantic 雙閘機制（manifest schema、`scripts/lib/design-system-gate.ps1`、`scripts/tests/verify-design-system-reference.ps1`、`capture-design-system-reference.mjs`、`web-viewer-sample/e2e/design-system-visual.spec.ts` + `design-system-semantic-cases.ts`）—— 本 change 與其平行推進、互不阻塞，遷移完成後直接重用同一套工具重新 rebaseline。

## Known Risks（記錄不處理，超出本 change 範圍）

- `openspec/specs/edge-console-operator-frontend/spec.md` 描述的頁面結構（`CoordinatorPage`/`IntakePage`/`RuntimePage`/`AppsPage`/`OverviewPage` 等扁平頁）未反映 `#349`/`#350`（UnifiedConsole IA v2）後的新 IA 結構，本 change 不代為修正。
- `openspec/specs/unified-governance-console/spec.md`（311 行）內部混雜至少兩三種不同時期的架構描述（primary-viewer-overlay 治理架構 `GovernanceOverlay`/`HighlightBridge`/`MappingCache` vs. 英文寫的 grouped-navigation product console shell），且引用 `docs/frontend/frontend-design-guidelines.md`（另一份尚未查核的文件）。這份 spec 本身的內部一致性與是否反映當前實碼，超出本 change 查核範圍，本 change 只確認其未規範具體顏色/CSS token 機制、不因本次視覺遷移而牴觸。
- `openspec/changes/align-frontend-design-system-reference` 的 `documentation-source-of-truth/spec.md` 仍逐字引用已於 `#342` 刪除的 `docs/plans/TRUTH`/`TARGET`/`PROCESS`/`BACKLOG` 四檔案所有權模型，已於 PR #353 的 `docs/plans/AI-BIM 前後端設計文件.dc.html` §07 記一筆已知不一致，本 change 不代為修正該 change 的 spec 檔案本體。
