## RENAMED Requirements

- FROM: `### Requirement: Agent boundary SHALL align A1-A10 product positioning`
- TO: `### Requirement: Agent 邊界 SHALL 對齊 A1–A10 產品定位`
- FROM: `### Requirement: User-facing completion SHALL be frontend-operable`
- TO: `### Requirement: 使用者介面功能的完成狀態 SHALL 可由前端操作驗證`

## MODIFIED Requirements

### Requirement: Agent 邊界 SHALL 對齊 A1–A10 產品定位

Repo agent contract SHALL 將 A1–A10 識別為主要產品開發項目，並 SHALL 以 current checkout 中所有 Git-tracked `docs/plans/*.html` 作為 design gate 的唯一 UX／IA／visual／interaction reference。Manifest、route inventory、semantic cases 與 goldens SHALL 被視為 HTML-derived machine artifacts；code＋tests/contracts SHALL 作為現行 behavior 與 runtime 現況的查證面（現況證據，非需求權威；需求權威依 doc-first 為 `docs/plans` 正本）。Repo 外 design path、任意 screenshot 或衍生 artifact SHALL NOT 覆寫 HTML、API、enum、security、authority 或 runtime lifecycle。

#### Scenario: Agent 開始 user-facing governance work

- **GIVEN** agent 被要求修改 user-facing governance capability
- **WHEN** agent 讀取 repo contract 與 `docs/plans/docs-plans-README.md`
- **THEN** agent SHALL 將工作對應至 tracked HTML 定義的 canonical route、screen、state 與相關 A1–A10 項目
- **AND** agent SHALL 驗證 machine reference 能回溯至同一 checkout 的 HTML
- **AND** agent SHALL 在宣稱完成前同時查閱 design fidelity 與 frontend operability guidance
- **AND** agent SHALL NOT 將 backend/API、visual-only、spec-only 或 runtime-only completion 視為完整 user-facing completion

#### Scenario: HTML 與衍生 design artifact 漂移

- **GIVEN** tracked HTML hash／normalized contract 已變更、HTML-derived manifest field 無法回溯到 tracked HTML，或 policy-derived manifest field 無法回溯到 versioned policy path／digest
- **WHEN** agent 或 CI 判定 design scope
- **THEN** design gate SHALL 採fail closed
- **AND** agent SHALL 重建衍生 artifacts，不能以 repo 外來源或舊 golden 接受 drift

#### Scenario: 同一 change 同時移動 design authority 與 product target

- **GIVEN** changed paths同時包含tracked `docs/plans/*.html` 與production frontend
- **WHEN** agent或CI判定design scope
- **THEN** status SHALL 為 `design_source_and_product_mixed_fail_closed`
- **AND** change SHALL 拆成先落地的 `design_source_update_only`／rebaseline lane與後續product lane
- **AND**同一 subject commit MUST NOT 產生product `passed` 或full-completion claim

#### Scenario: Change 只修改 gate infrastructure

- **GIVEN** changed paths只包含extractor、policy、validator、CI或negative tests
- **WHEN** design gate執行
- **THEN** status SHALL 為 `gate_infrastructure_only`
- **AND** change SHALL 驗證schema與negative cases，但 MUST NOT 產生product visual pass

### Requirement: 使用者介面功能的完成狀態 SHALL 可由前端操作驗證

每項 user-facing capability SHALL 通過兩個獨立 gates：(1) 從 tracked HTML 派生且可回溯的 design fidelity gate，在 Windows runner、Chromium DPR1、`1440x900` 與 `1920x1080` 下每個 viewport pixel diff ratio `<=0.01`，required semantic cases 100%；(2) functional browser flow，包含 canonical route、visible controls、default fixture、real backend API、loading/success/failure/retry states、domain／runtime identifiers、screenshot/trace/network evidence，以及適用時的 Kit first-frame/stage/DataChannel evidence。Design scope SHALL 從 changed paths 與較嚴格的 base/head HTML-derived manifest 聯集推導，不得由 PR prose 選取。

#### Scenario: 使用者從 browser UI 驗證 capability

- **GIVEN** development server 與 default fixture 可用
- **WHEN** 使用者開啟 HTML 指定的 canonical route 並點擊指定 action
- **THEN** 系統 SHALL 呼叫 real backend API，顯示誠實 visible states 與產生的 domain/runtime IDs
- **AND** branch-protected Playwright SHALL 針對 current checkout 執行 HTML-derived semantic cases並產生 design result；PR/external JSON SHALL NOT 作為 gate input
- **AND** PR SHALL 包含獨立 functional browser evidence
- **AND** `reference_missing`、pixel ratio 超過 1%、semantic result 不完整或缺少 runtime evidence SHALL 阻止 full-completion claim
- **AND** live WebRTC/GPU frames SHALL NOT 以 design pixel threshold 判定

#### Scenario: Shared product bundle 同時影響 approved 與 missing routes

- **GIVEN** changed paths 解析至 HTML-approved screens 與 `reference_missing` routes
- **WHEN** PR evidence 接受檢查
- **THEN** `Design gate status` SHALL 為 `mixed`，每個 HTML-approved screen SHALL 為 required，且每個 missing route/surface SHALL 揭露
- **AND** `Full completion claimed` SHALL 為 `no`
- **AND** functional/runtime evidence SHALL 維持獨立 required

#### Scenario: Product surface 沒有 HTML design reference

- **GIVEN** changed paths 只解析至 tracked HTML 未定義的 surface
- **WHEN** PR evidence 接受檢查
- **THEN** `Design gate status` SHALL 為 `partial_reference_missing`，design result/comparison/artifacts SHALL 為 `reference_missing`，且 full completion SHALL 為 `no`
- **AND** 當 functional/runtime gate 通過時，誠實的 bug、security 或 partial feature work MAY 繼續
- **AND** manifest、legacy screenshot 或外部 prototype SHALL NOT 自行提升為 approved design result

#### Scenario: Semantic variants 不完整

- **GIVEN** HTML-derived semantic contract 不可執行，或 implemented cases 與 required cases 不同
- **WHEN** approved 或 mixed frontend product job 執行
- **THEN** design job SHALL 採fail closed
- **AND** gate infrastructure、manifest entry 或 golden existence SHALL NOT 回報為 production design alignment
