## RENAMED Requirements

- FROM: `### Requirement: A1-A10 Pages Preserve Prototype Intent`
- TO: `### Requirement: A1–A10 頁面 SHALL 保留原型意圖`

## MODIFIED Requirements

### Requirement: primary 治理 viewer SHALL 採範本式全幅語意驗證版面，A1/A2/A3 operation 與 IFC 語意 metadata 清楚分區

Primary 治理 viewer SHALL 依 tracked `AI-BIM 前後端設計文件.dc.html` 的 canonical `#/workspace?dock=...` IA 與 tracked `AI-BIM Console Hi-Fi.dc.html` 的 Workspace screen/state 呈現；A1/A2/A3 operation、Stage tree、WebRTC viewport、IFC 語意與 issue區段 SHALL 清楚分區。既有 rule-run/highlight/issue/BCF/BindingComposer、spectator 權威與 MappingCache/HighlightBridge SHALL 保留。Manifest/baseline只能作 HTML-derived gate artifact。live Kit video frame SHALL 由 first-frame/stage/DataChannel evidence驗證，不套用 design pixel threshold。

#### Scenario: Workspace 版面與治理操作保留

- **WHEN** 真人開啟 canonical `#/workspace?dock=a1`
- **THEN** 2D chrome、Workspace layout 與 A1 dock SHALL 對齊 tracked Hi-Fi HTML 可回溯的 screen/state
- **AND** spectator SHALL 維持唯讀權威
- **AND** 兩個 required viewports SHALL 有 HTML-derived visual result
- **AND** functional/runtime E2E SHALL 另行證明 real API、live frame、stage 與 DataChannel 行為

#### Scenario: HTML 尚未定義新增 viewer surface

- **GIVEN** lineage Alignment、Attempts、Audit 或其他 panel尚未出現在 tracked HTML
- **WHEN** 該 surface 的 frontend change接受 design gate檢查
- **THEN** surface SHALL 標為 `reference_missing` 或 `mixed`
- **AND** manifest、local CSS、legacy screenshot 或外部 prototype SHALL NOT 自行批准該 screen
- **AND** `Full completion claimed` SHALL 為 `no`，直到 tracked HTML 補齊並重建 derivatives

### Requirement: A1–A10 頁面 SHALL 保留原型意圖

前端 SHALL 依 tracked design HTML 為 A1 至 A10 提供對應操作 surface：A1–A4 在 `#/workspace?dock=...`，A5–A10 在 `#/app/:slug` Concept Preview。每個 surface SHALL 說明功能目的、後端相依性與誠實 provenance。任何 screen/state ID、manifest entry或golden都必須可回溯至 HTML；不得使用 repo 外 design source 定義 production pixel pass/fail、API 或 runtime truth。

#### Scenario: 操作人員開啟 A1

- **WHEN** 操作人員前往 A1 Governance & Rule Checker
- **THEN** route SHALL 收斂至 `#/workspace?dock=a1`，並對齊 tracked Hi-Fi Workspace/A1 state
- **AND** functional evidence SHALL 獨立驗證模型選取、檢核流程、scoreboard、issue 建立與 BCF/Excel 交付

#### Scenario: 操作人員開啟 roadmap apps

- **WHEN** 操作人員前往 A5、A6、A7、A8、A9 或 A10
- **THEN** route SHALL 使用 `#/app/:slug` 並對齊 tracked Hi-Fi Concept Preview 對應 state
- **AND** 在 runtime evidence 存在前，後端能力 SHALL 維持 roadmap/not built；visual parity SHALL NOT 使其成為 live system evidence
