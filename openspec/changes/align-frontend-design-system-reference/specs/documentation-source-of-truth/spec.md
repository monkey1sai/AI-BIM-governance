## RENAMED Requirements

- FROM: `### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority`
- TO: `### Requirement: Workflow v4 and product design artifacts have distinct, non-overlapping authority`
- FROM: `### Requirement: workflow v3 與 product design artifacts 互相 cross-reference 持續成立`
- TO: `### Requirement: workflow v4 與 product design artifacts 互相 cross-reference 持續成立`

## MODIFIED Requirements

### Requirement: Workflow v4 and product design artifacts have distinct, non-overlapping authority

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 是開發流程入口；`docs/plans/docs-plans-README.md` 是設計與規格導覽；current checkout 中所有 Git-tracked `docs/plans/*.html` 是 design gate 唯一權威輸入；code＋tests/contracts 是現行 runtime behavior truth。Manifest、route inventory、semantic cases、goldens 與 CI results SHALL 只是 HTML-derived validation artifacts。Repo 外 design workspace、已刪七檔與 arbitrary screenshot SHALL NOT 成為 parallel authority。

#### Scenario: 讀者尋找開發流程

- **WHEN** 工程師想了解架構、Phase 脈絡、驗證證據分層、PR checklist、服務測試命令或核心資料流
- **THEN** 應從 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 或 owning agent sub-file進入
- **AND** tracked HTML 與衍生 design snapshot SHALL NOT 重述或覆寫完整開發流程

#### Scenario: 讀者尋找需求、現況或 2D design reference

- **WHEN** 工程師想確認 A1–A10 需求、canonical route、頁面操作或 production 2D 樣貌
- **THEN** 應從 `docs/plans/docs-plans-README.md` 進入並讀取 tracked HTML
- **AND** production coverage SHALL 由可回溯至 HTML 的 `route_inventory[]`／screens 驗證，semantic/pixel result SHALL 由 branch-protected current-checkout Playwright output＋validator 裁決
- **AND** 建成現況 SHALL 直接由 code＋tests/evidence 查證；golden存在、spec完成或 gate infrastructure 完成 SHALL NOT 推定 product pass

#### Scenario: workflow、HTML、衍生 artifact 或 runtime truth 不一致

- **WHEN** workflow、tracked HTML、manifest／golden與 runtime code 描述同一 user-facing capability 且不一致
- **THEN** tracked HTML SHALL 裁決 design gate target，code＋tests/contracts SHALL 裁決 current behavior
- **AND** manifest／golden若無法重建為 HTML 的忠實衍生物 SHALL 被拒絕
- **AND** 差異 SHALL 標為 implementation gap或stale derivative，不得以其中一層虛構另一層已完成
- **AND** HTML demo data SHALL NOT 覆寫 runtime truth

### Requirement: workflow v4 與 product design artifacts 互相 cross-reference 持續成立

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`、`README.md` 與 `docs/plans/docs-plans-README.md` SHALL 互相交叉連結並列出相同 ownership：tracked `docs/plans/*.html` 為 design authority、manifest/baselines 為 derivatives、code＋tests為 current behavior。Active consumers SHALL NOT 依賴已刪文件或 repo 外 design path。

#### Scenario: active consumer 指向被刪舊正本或外部 design authority

- **WHEN** active README、workflow、skill、OpenSpec delta、demo、script 或 CI引用已刪正本，或把 repo 外 path當 design gate source
- **THEN** change MUST 被阻擋直到引用改指 tracked `docs/plans/*.html` 或正確 runtime owner
- **AND** 歷史 archive/evidence MAY 保留舊引用，但 SHALL 明標 historical

#### Scenario: HTML design source 與 machine derivatives 保持可發現

- **WHEN** 讀者從 README、workflow 或 plans entry尋找產品樣貌與 gate evidence
- **THEN** 兩份現行 tracked HTML 與由其產生的 manifest/baselines SHALL 可發現
- **AND** manifest/baselines SHALL 記錄 source paths/hashes並明標 derived
- **AND** machine supporting artifacts SHALL NOT 成為另一份人類需求正本
