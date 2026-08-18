# unified-governance-console（delta）

## MODIFIED Requirements

### Requirement: 點 3D 構件 ↔ IFC GUID 雙向 + 治理失敗構件 SHALL 經 client highlightPrimsRequest 在 3D 標示

統一治理控制台 SHALL 提供 3D 構件與 IFC GUID 的雙向打通（MappingCache 快取 `element_mapping` 的 `ifc_guid ↔ usd_prim_path`）：點 3D 構件 SHALL 經 `element_mapping` 反查得 IFC GUID 並帶進治理；治理失敗構件 SHALL 經其 `usd_prim_path` 由 HighlightBridge 組成 `highlightPrimsRequest`、透過 viewer 既有 WebRTC DataChannel（client 主動拉）在 3D 標示。3D 著色 SHALL 走 client `highlightPrimsRequest`，SHALL NOT 復活 2026-05-21 退役的 server-push highlight。未對映（`usd_prim_path=null`）的失敗構件 SHALL 誠實顯示「無法在 3D 標示」並顯示 coverage%，SHALL NOT 以捏造的 prim path 取代以假裝可標示。3D 端的視覺呈現方式 SHALL 誠實描述為現行 Kit handler 實際採用的 **USD selection 高亮**（回傳 `applied_mode: "selection"`）；client 雖仍依 severity 於協定 payload 帶 `color`，該欄位 SHALL NOT 被描述為已在 3D 生效的著色。

#### Scenario: 治理失敗構件經 client highlightPrimsRequest 在 3D 以 USD selection 標示

- **WHEN** 操作員在 A1–A10 overlay 對一個帶有效 `usd_prim_path` 的治理失敗構件按「在 3D 標示」
- **THEN** HighlightBridge SHALL 以該 `usd_prim_path` 組成 `highlightPrimsRequest`
- **AND** SHALL 經 primary viewer 既有的 WebRTC DataChannel（`web-viewer-sample/src/Window.tsx` React 元件的 private method `_sendStreamMessage`，client 主動拉，非 browser global `Window`）送至 Kit runtime
- **AND** Kit runtime SHALL 以 USD selection 呈現該構件（`clear_selected_prim_paths()` ＋ `set_selected_prim_paths(...)`）並回傳 `applied_mode: "selection"`
- **AND** client 依 severity 寫入 payload 的 `color` 欄位 SHALL 被視為協定攜帶值而非已生效的 3D 著色；spec SHALL NOT 宣稱該構件在 3D 中被標為紅色
- **AND** SHALL NOT 透過已退役的 server-push highlight 機制標示

#### Scenario: 點 3D 構件反查 IFC GUID 帶進治理

- **WHEN** 操作員在 primary viewer 的 3D 中點選一個構件
- **THEN** MappingCache SHALL 以該構件的 `usd_prim_path` 經 `element_mapping` 反查得對應 `ifc_guid`
- **AND** SHALL 將該 `ifc_guid` 帶進 A1–A10 治理（作為治理操作的目標構件）

#### Scenario: 未對映的失敗構件誠實標示無法 3D 標示，不捏造 prim path

- **WHEN** 一個治理失敗構件的 `usd_prim_path` 為 `null`（未對映）
- **THEN** overlay SHALL 誠實顯示「無法在 3D 標示」並顯示當前 coverage%
- **AND** SHALL NOT 以任意或捏造的 prim path 觸發 `highlightPrimsRequest` 假裝可標示

### Requirement: 中央 3D 視區 SHALL 誠實不空白（無 GPU 時資訊濃密 mock viewport，有 GPU 時真 Kit 幀）

中央視區 SHALL NOT 在無 GPU/harness 情境呈現「空白且無說明」的畫面。當無真實 WebRTC 視訊幀時（`harnessEnabled()` 或 `!_hasRemoteVideoFrame()`），SHALL 呈現資訊濃密 mock viewport 並明確標示為「deterministic · no-GPU」，使檢視者不致誤判為壞掉；當真實 Kit 視訊幀可用時，SHALL 自動切換為真實 `<video>` 串流。mock viewport 現行呈現的欄位為 **Stage URL、loaded prim 數、WebRTC 狀態、loaded layers、selected prim**；`camera 狀態` 與獨立的 `highlight echo` 欄位 SHALL NOT 被描述為已具備（`MockViewport.tsx` 全檔 `grep -n "camera"` 零命中）。mock viewport SHALL 為可決定性（同輸入同輸出）、不依賴 GPU、不引入新 3D 引擎生產依賴。

#### Scenario: harness/無 GPU 時中央視區顯示資訊而非空白

- **WHEN** 在 harness/無 GPU 情境開 viewer
- **THEN** 中央 SHALL 顯 mock viewport（Stage URL／loaded prims／WebRTC 狀態／loaded layers／selected），明標 no-GPU 決定性，SHALL NOT 全空白
- **AND** 點**對構表**元件 SHALL 在 mock viewport 產生可見 selection 回饋（`data-testid="mock-selected"`）
- **AND** 點**結構樹**目前 SHALL NOT 被描述為會產生回饋：`MockViewport.tsx` 未傳選取 callback 給 `StructureStats`，`StructureStats` 亦未接上 `StructureStatsView` 的 `onSelectClass`，`SpatialTreeView` 無點擊處理
- **AND** 有真實 Kit 視訊幀時 SHALL 自動切真 `<video>`；其 E2E 截圖證據屬部署驗證範圍，SHALL NOT 由本 spec 的措辭收斂視為已取得

### Requirement: Product Governance Console Shell

The web frontend SHALL present `/ui` and `/console` as a complete AI-BIM Governance operator console with grouped left navigation. 現行分組為兩組——「工作台」（`navMain`）與「AI 應用模組」（`apps`），來源為 `unified/fixtures.ts`。本 requirement SHALL NOT 宣稱存在 Workspace / Core Governance / Omniverse Runtime / Coordinator-Edge Control / System 五組導覽。

#### Scenario: Operator opens the product console
- **WHEN** the operator opens `/ui` without a `session` query
- **THEN** the frontend renders the governance console shell composed of top runtime status（Coordinator／Governance／Kit Runtime chips）、grouped left navigation（「工作台」與「AI 應用模組」兩組）、central workspace、and a toast host
- **AND** the shell SHALL NOT be described as providing a Chat USD Agent side panel：`UnifiedShell.tsx` 全檔 `grep -rn "Chat USD"` 零命中，該面板僅存在於 `LegacyEdgeConsole`

#### Scenario: Viewer session attach remains separate
- **WHEN** the browser opens `/ui?session=review_session_x`
- **THEN** the frontend does not mount the operator console and preserves the existing viewer attach path

### Requirement: A1-A10 Pages Preserve Prototype Intent

The frontend SHALL provide an operator-facing page for A1 through A10, with each page explaining the function purpose, expected UI presentation, backend dependencies, and honest provenance. `a1`／`a2`／`a3` 三個 route 自 IA v2 起由 UnifiedConsole workspace 承接（`UNIFIED_WS_KEYS`），其 dock 互動為 fixture 語意；本 requirement SHALL NOT 以 `#issues` 底下 `IssuesRuleCenterPage` 的能力充作 A1 route 的交付面。

#### Scenario: Operator opens A1
- **WHEN** the operator navigates to A1 Governance & Rule Checker
- **THEN** the page mounts `WorkspacePage` with `initialDock="a1"`, showing rule selection, a run CTA, a result scoreboard, issue creation, and BCF export
- **AND** the A1 dock SHALL NOT be described as providing upload/select model or Excel delivery：`grep -rni "excel|xlsx" src/console/unified/` 零命中；`A1DockLive` 僅在 `/health` 探活成功時掛載並提供 library IFC 選取、rule-run 與歷史列表，亦無 Excel 匯出。Excel 交付面位於 `#issues`
- **AND** 該 dock 的互動 SHALL 誠實標示為 fixture 語意（不打 `/api`），SHALL NOT 呈現為 live system evidence

#### Scenario: Operator opens roadmap apps
- **WHEN** the operator navigates to A4, A5, A6, A7, A8, A9, or A10
- **THEN** the page labels backend capabilities as roadmap or not built and does not present them as live system evidence
