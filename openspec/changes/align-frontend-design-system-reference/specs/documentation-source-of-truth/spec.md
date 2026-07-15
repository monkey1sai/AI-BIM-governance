## MODIFIED Requirements

### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v4）與 `docs/plans/docs-plans-README.md` 導向的 TRUTH/TARGET/PROCESS/BACKLOG SHALL 維持互補不替代的分工：workflow v4 是開發流程入口；`TRUTH.md` 記現況，TARGET-* 定義行為需求，`BACKLOG.md` 排序 gap／OPEN，`PROCESS.md` 定義 dual-gate DoD。唯讀 `C:\Repos\design\desigin-system` 是 2D authoring authority；CI/PR/merge SHALL 只讀 repo-pinned manifest/baselines。兩份 prototypes SHALL 保留為 legacy IA／OpenUSD runtime companions，SHALL NOT 作 production 2D pass/fail 或 API/coding 權威。

#### Scenario: 讀者尋找開發流程

- **WHEN** 工程師想了解架構、Phase 脈絡、驗證證據分層、PR Checklist、服務測試命令或核心資料流
- **THEN** 應從 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 進入
- **AND** plans TARGET 與 design snapshot SHALL NOT 重述完整開發流程

#### Scenario: 讀者尋找需求、現況或 2D design reference

- **WHEN** 工程師想確認 A1–A10 需求、頁面操作、建成狀態、缺口排序或 production 2D 樣貌
- **THEN** 應從 `docs/plans/docs-plans-README.md` 進入並依 ownership 讀 TRUTH/TARGET/BACKLOG/PROCESS
- **AND** production 2D coverage SHALL 由 manifest `route_inventory[]`／screens 驗證，semantic/pixel result SHALL 由 branch-protected current-checkout Playwright output＋validator 裁決
- **AND** TRUTH SHALL 記錄 production result 是否 observed；golden 存在或 gate infrastructure 完成 SHALL NOT 推定 pass
- **AND** workflow v4 MUST 只 cross-reference，不得改寫需求、design result 或 runtime 現況

#### Scenario: workflow、TARGET、design 或 runtime truth 不一致

- **WHEN** workflow v4、TARGET、design source 與 runtime code 描述同一 user-facing capability 且不一致
- **THEN** TARGET/contracts SHALL 裁決行為，approved design snapshot SHALL 裁決 2D fidelity
- **AND** runtime 現況 SHALL 以 code＋tests/evidence 驗證，TRUTH 必須誠實同步
- **AND** design demo data SHALL NOT 覆寫 runtime truth

### Requirement: workflow v3 與 product design artifacts 互相 cross-reference 持續成立

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 頂部 metadata 與 source-of-truth 表 SHALL 連到 plans 入口、TRUTH/TARGET/PROCESS/BACKLOG、design manifest/baselines 與兩份 legacy companions；`README.md` SHALL 列出相同 ownership，active consumers SHALL NOT 讀取已刪除的六份舊正本。

#### Scenario: active consumer 指向被刪舊正本

- **WHEN** active README、workflow、skill、OpenSpec delta、demo 或 SaaS keep doc 引用六份舊正本任一檔名
- **THEN** change MUST 被阻擋直到引用改指新 owning source
- **AND** 歷史 archive/evidence MAY 保留舊引用

#### Scenario: design reference 與 legacy companions 保持可發現

- **WHEN** 讀者從 README、workflow v4 或 plans entry 尋找產品樣貌
- **THEN** approved manifest/baselines SHALL 可發現，且兩份 legacy prototypes SHALL 仍可開啟
- **AND** legacy prototypes SHALL 明標不作 2D pass/fail authority
- **AND** machine supporting artifacts SHALL NOT 成為第八份人類需求正本
