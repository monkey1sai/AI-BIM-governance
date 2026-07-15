## MODIFIED Requirements

### Requirement: primary 治理 viewer SHALL 採範本式全幅語意驗證版面，A1/A2/A3 operation 與 IFC 語意 metadata 清楚分區

primary 治理 viewer SHALL 以全幅多分區版面呈現（模型資訊、IFC 語意、結構樹、GUID⇔Prim 對構表、幾何定位、Pset/空間關係），A1/A2/A3 operation SHALL 收進清楚的操作分頁/區段，既有 rule-run/highlight/issue/BCF/BindingComposer、spectator 權威與 MappingCache/HighlightBridge SHALL 全保留。2D chrome/panel/state SHALL 依 approved design manifest/baseline；coverage SHALL 讀 `route_inventory.status`。若 `#viewer` 為 `reference_missing`，SHALL 誠實列為 fidelity gap且 `Full completion claimed=no`。`docs/frontend/frontend-design-guidelines.md` 只補充 WCAG/security，SHALL NOT 成為平行 token authority。live Kit video frame SHALL 由 first-frame/stage/DataChannel evidence 驗證，不套用 design pixel threshold。

#### Scenario: 全幅 6 分區版面 + 治理操作分頁，既有能力保留

- **WHEN** 真人開 primary 治理 viewer
- **THEN** SHALL 見全幅多分區版面與可操作的 A1/A2/A3 區段，spectator SHALL 維持唯讀權威
- **AND** 若已有 approved viewer screen，2D 非動態區域 SHALL 具兩 viewport visual result；若沒有 SHALL 標 `reference_missing`
- **AND** SHALL 另具 functional/runtime E2E，證明 live frame、stage 與 DataChannel 行為

### Requirement: A1–A10 頁面 SHALL 保留原型意圖

前端 SHALL 為 A1 至 A10 各提供一個操作人員頁面；每個頁面 SHALL 對齊其 approved design screen/state，並說明功能目的、後端相依性與誠實 provenance。legacy prototypes MAY 補充歷史 IA，但 SHALL NOT 定義 production pixel pass/fail、API 或 runtime truth。

#### Scenario: 操作人員開啟 A1

- **WHEN** 操作人員前往 A1 Governance & Rule Checker
- **THEN** 頁面 SHALL 在兩個 required viewports 對齊 `workspace.a1.default`
- **AND** functional evidence SHALL 獨立驗證模型選取、檢核流程、scoreboard、issue 建立與 BCF/Excel 交付

#### Scenario: 操作人員開啟 roadmap apps

- **WHEN** 操作人員前往 A5、A6、A7、A8、A9 或 A10
- **THEN** 頁面 SHALL 對齊其 `concept.a<n>.default` design screen
- **AND** 在 runtime evidence 存在前，後端能力 SHALL 維持 roadmap/not built；visual parity SHALL NOT 使其成為 live system evidence
