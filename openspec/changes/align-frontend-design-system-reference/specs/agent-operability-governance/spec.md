## MODIFIED Requirements

### Requirement: Agent 邊界 SHALL 對齊 A1–A10 產品定位

Repo agent contract SHALL 將 A1–A10 識別為主要產品開發項目，SHALL 使用 repo-pinned `desigin-system` reference 作為 production 2D UX/IA/visual states，並 SHALL 使用 TARGET/contracts 與 code/tests 作為 behavior 與 runtime truth。外部 design source SHALL NOT 覆寫 API、enum、security、authority 或 runtime lifecycle。

#### Scenario: Agent 開始 user-facing governance work

- **GIVEN** agent 被要求修改 user-facing governance capability
- **WHEN** agent 讀取 repo contract
- **THEN** agent SHALL 將工作對應至相關 A1–A10 項目與 approved design screen/state
- **AND** agent SHALL 在宣稱完成前同時查閱 design fidelity 與 frontend operability guidance
- **AND** agent SHALL NOT 將 backend/API、visual-only 或 runtime-only completion 視為完整 user-facing completion

### Requirement: User-facing completion SHALL 可從前端操作

每項 user-facing capability SHALL 通過兩個獨立 gates：(1) Windows runner 上 Chromium DPR1 的 approved design screen/state，viewport 為 `1440x900` 與 `1920x1080`，每個 viewport pixel diff ratio `<=0.01`，且 required semantic states 為 100%；(2) functional browser flow，包含 route、visible controls、default fixture、real backend API、loading/success/failure/retry states、runtime identifiers、screenshot/trace/network evidence，以及適用時的 Kit first-frame/stage/DataChannel evidence。Design scope SHALL 從 changed paths 加上較嚴格的 base/head manifest union 推導，不得由 PR prose 選取。

#### Scenario: 使用者從 browser UI 驗證 capability

- **GIVEN** development server 與 default fixture 可用
- **WHEN** 使用者開啟文件指定的 route 並點擊文件指定的 action
- **THEN** 系統 SHALL 呼叫 real backend API，顯示誠實 visible states 與產生的 domain/runtime IDs
- **AND** branch-protected Playwright SHALL 針對 current checkout 執行精確 manifest semantic cases 並產生 design result；PR/external JSON SHALL NOT 作為 gate input
- **AND** PR SHALL 包含獨立 functional browser evidence
- **AND** `reference_missing`、pixel ratio 超過 1%、semantic result 不完整或缺少 runtime evidence SHALL 阻止 full-completion claim
- **AND** live WebRTC/GPU frames SHALL NOT 以 design pixel threshold 判定

#### Scenario: Shared product bundle 同時影響 approved 與 missing routes

- **GIVEN** changed paths 解析至 approved screens 與 `reference_missing` routes
- **WHEN** PR evidence 接受檢查
- **THEN** `Design gate status` SHALL 為 `mixed`，每個 manifest-approved screen SHALL 為 required，且每個 missing route/surface SHALL 揭露
- **AND** `Full completion claimed` SHALL 為 `no`
- **AND** functional/runtime evidence SHALL 維持獨立 required

#### Scenario: Product surface 沒有 approved design reference

- **GIVEN** changed paths 只解析至 manifest `reference_missing` surface
- **WHEN** PR evidence 接受檢查
- **THEN** `Design gate status` SHALL 為 `partial_reference_missing`，design result/comparison/artifacts SHALL 為 `reference_missing`，且 full completion SHALL 為 `no`
- **AND** 當 functional/runtime gate 通過時，誠實的 bug、security 或 partial feature work MAY 繼續
- **AND** legacy screenshot SHALL NOT 提升為 approved design result

#### Scenario: Semantic variants 不完整

- **GIVEN** semantic contract status 不可執行，或 implemented cases 與 required cases 不同
- **WHEN** approved 或 mixed frontend product job 執行
- **THEN** design job SHALL 採 fail-closed
- **AND** gate infrastructure 或 golden existence SHALL NOT 回報為 production 99% alignment
