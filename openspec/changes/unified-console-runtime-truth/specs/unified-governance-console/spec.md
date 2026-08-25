## MODIFIED Requirements

### Requirement: Product Governance Console Shell

The web frontend SHALL present `/ui` and `/console` as a complete AI-BIM Governance operator console with grouped left navigation. 現行分組為兩組——「工作台」（`navMain`）與「AI 應用模組」（`apps`），來源為 `unified/fixtures.ts`。本 requirement SHALL NOT 宣稱存在 Workspace / Core Governance / Omniverse Runtime / Coordinator-Edge Control / System 五組導覽。 自 `unified-console-runtime-truth` 起：shell 於 liveBackend（`/health` 探活成功）時 SHALL 以 coordinator `:8004` 真值填充頂部 runtime 狀態 chips 與側欄 badge，SHALL NOT 寫死 `GPU/Stream 82%` 或 `LIVE`；`navMain`／`apps` 導覽設定與 i18n 字典 MAY 仍來源於 `unified/fixtures.ts`，但該檔的假資料 export（`initialIntake`／`initialConv`／`initialSessions`／`initialOutbox`／`initialIssues`／`alerts`／`services`／`failDefs`／`diffDefs`／`fedMembers`／`stageTree`）SHALL NOT 成為 production 顯示值來源；`/ui`（無 hash）落地的 `#home` KPI SHALL 綁 coordinator 既有端點並經共用 poller（詳 `unified-console-runtime-truth`）。

#### Scenario: Operator opens the product console
- **WHEN** the operator opens `/ui` without a `session` query
- **THEN** the frontend renders the governance console shell composed of top runtime status（Coordinator／Governance／Kit Runtime chips）、grouped left navigation（「工作台」與「AI 應用模組」兩組）、central workspace、and a toast host
- **AND** the shell SHALL NOT be described as providing a Chat USD Agent side panel：`UnifiedShell.tsx` 全檔 `grep -rn "Chat USD"` 零命中，該面板僅存在於 `LegacyEdgeConsole`
- **AND** 自 `unified-console-runtime-truth` 起，liveBackend 時 top runtime status chips 與 `#home` KPI SHALL 為 coordinator 真值或 `data-state="unavailable"`／`"offline"` 誠實標示，SHALL NOT 渲染 fixture 假值；後端不可達時 SHALL 顯示「未連線」而非任何數字

#### Scenario: Viewer session attach remains separate
- **WHEN** the browser opens `/ui?session=review_session_x`
- **THEN** the frontend does not mount the operator console and preserves the existing viewer attach path

#### Scenario: canonical-linux liveBackend 下 shell 不渲染 fixture 假值
- **WHEN** operator 於 canonical-linux 部署開啟 `/ui`（無 hash），且 coordinator `/health` 探活成功
- **THEN** shell SHALL 渲染真值 `#home`（KPI 與同分鐘 API JSON 一致），頂列 GPU chip SHALL 為 API 值或「GPU 未取得」
- **AND** 側欄 A1–A4 badge SHALL 反映 `data.ts` `A1A10` 的 `prov`，SHALL NOT 出現寫死的 `LIVE`

### Requirement: A1-A10 Pages Preserve Prototype Intent

The frontend SHALL provide an operator-facing page for A1 through A10, with each page explaining the function purpose, expected UI presentation, backend dependencies, and honest provenance. `a1`／`a2`／`a3` 三個 route 自 IA v2 起由 UnifiedConsole workspace 承接（`UNIFIED_WS_KEYS`），其 dock 互動為 fixture 語意；本 requirement SHALL NOT 以 `#issues` 底下 `IssuesRuleCenterPage` 的能力充作 A1 route 的交付面。 自 `unified-console-runtime-truth` 起，「fixture 語意」SHALL 僅限 design-preview 或後端離線態，且該態 SHALL NOT 顯示捏造數值或假成功回饋；liveBackend 時 A1–A3 dock SHALL 以真值與真頁導向（`#a1-workbench`／`#version-diff`／`#federation`）取代 fixture 互動，A1 視區 SHALL 以 `data-prov="demo"` 明標「no-GPU 示意／示範圖」並提供手動 `/ui/open?session=` handoff（不自動 claim）。

#### Scenario: Operator opens A1
- **WHEN** the operator navigates to A1 Governance & Rule Checker
- **THEN** the page mounts `WorkspacePage` with `initialDock="a1"`, showing rule selection, a run CTA, a result scoreboard, issue creation, and BCF export
- **AND** the A1 dock SHALL NOT be described as providing upload/select model or Excel delivery：`grep -rni "excel|xlsx" src/console/unified/` 零命中；`A1DockLive` 僅在 `/health` 探活成功時掛載並提供 library IFC 選取、rule-run 與歷史列表，亦無 Excel 匯出。Excel 交付面位於 `#issues`
- **AND** 該 dock 的互動 SHALL 誠實標示為 fixture 語意（不打 `/api`），SHALL NOT 呈現為 live system evidence；自 `unified-console-runtime-truth` 起此義務限縮於 design-preview／後端離線態，liveBackend 時該 dock SHALL 以真值與真頁導向取代 fixture 互動，SHALL NOT 顯示未經真請求的成功 toast

#### Scenario: Operator opens roadmap apps
- **WHEN** the operator navigates to A4, A5, A6, A7, A8, A9, or A10
- **THEN** the page labels backend capabilities as roadmap or not built and does not present them as live system evidence
- **AND** A5–A10 頁面的控制項 SHALL `disabled` 並依 `data.ts` 標 `p3`／`p4` 與承接 change 原因，SHALL NOT 存在可點但無後端效果的假按鈕

#### Scenario: A1–A3 dock 在 liveBackend 時以真值取代 fixture
- **WHEN** operator 於 liveBackend 狀態開啟 `#a1`／`#a2`／`#a3`
- **THEN** dock 的 CTA SHALL 為 `data-action="nav"`（導向 `#a1-workbench`／`#version-diff`／`#federation`）或 `data-action="api"`（呼叫 coordinator 真端點），SHALL NOT 以 local state 變更模擬「POST … → 202」成功
- **AND** `#a1` 視區 SHALL 標示「no-GPU 示意／示範圖」（`data-prov="demo"`），有 review session 時 SHALL 顯示 `/ui/open?session=<id>` anchor（非 iframe），頁面載入 SHALL NOT 呼叫 claim／attach 端點
