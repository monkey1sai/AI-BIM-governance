## MODIFIED Requirements

### Requirement: primary 治理 viewer SHALL 採範本式全幅語意驗證版面，A1/A2/A3 operation 與 IFC 語意 metadata 清楚分區

primary 治理 viewer SHALL 以全幅多分區版面呈現（模型資訊、IFC 語意、結構樹、GUID⇔Prim 對構表、幾何定位、Pset/空間關係），A1/A2/A3 operation SHALL 收進清楚的操作分頁/區段，既有 rule-run/highlight/issue/BCF/BindingComposer、spectator 權威與 MappingCache/HighlightBridge SHALL 全保留。2D chrome/panel/state SHALL 依 approved design manifest/baseline；coverage SHALL 讀 `route_inventory.status`。若 `#viewer` 為 `reference_missing`，SHALL 誠實列為 fidelity gap且 `Full completion claimed=no`。`docs/frontend/frontend-design-guidelines.md` 只補充 WCAG/security，SHALL NOT 成為平行 token authority。live Kit video frame SHALL 由 first-frame/stage/DataChannel evidence 驗證，不套用 design pixel threshold。

#### Scenario: 全幅 6 分區版面 + 治理操作分頁，既有能力保留

- **WHEN** 真人開 primary 治理 viewer
- **THEN** SHALL 見全幅多分區版面與可操作的 A1/A2/A3 區段，spectator SHALL 維持唯讀權威
- **AND** 若已有 approved viewer screen，2D 非動態區域 SHALL 具兩 viewport visual result；若沒有 SHALL 標 `reference_missing`
- **AND** SHALL 另具 functional/runtime E2E，證明 live frame、stage 與 DataChannel 行為

### Requirement: A1-A10 Pages Preserve Prototype Intent

The frontend SHALL provide an operator-facing page for A1 through A10, with each page aligned to its approved design screen/state while explaining the function purpose, backend dependencies, and honest provenance. Legacy prototypes MAY supplement historical IA but SHALL NOT define production pixel pass/fail, API, or runtime truth.

#### Scenario: Operator opens A1

- **WHEN** the operator navigates to A1 Governance & Rule Checker
- **THEN** the page SHALL align with `workspace.a1.default` at both required viewports
- **AND** functional evidence SHALL independently verify model selection, check flow, scoreboard, issue creation, and BCF/Excel delivery

#### Scenario: Operator opens roadmap apps

- **WHEN** the operator navigates to A5, A6, A7, A8, A9, or A10
- **THEN** the page SHALL align with its `concept.a<n>.default` design screen
- **AND** backend capabilities SHALL remain roadmap/not built until runtime evidence exists; visual parity SHALL NOT make them live system evidence
