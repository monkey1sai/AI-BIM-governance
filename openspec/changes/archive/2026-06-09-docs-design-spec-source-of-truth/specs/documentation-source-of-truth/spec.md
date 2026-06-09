## MODIFIED Requirements

### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v3）與 `docs/plans/ai-bim-governance-設計規格.md` / `docs/plans/ai-bim-governance-prototype.html`（repo-local product design artifacts）SHALL 維持互補不替代的分工：workflow v3 是「開發流程入口」；設計規格與 prototype 是 A1–A10 功能需求、操作介面語意、可信度標記與雲端 / 客戶落地端分離架構對齊的權威入口。程式碼、contracts、OpenSpec specs 仍是行為正確性的權威。

#### Scenario: 讀者尋找產品功能需求或操作原型

- **WHEN** 工程師想確認 A1–A10 功能、頁面分群、按鈕語意、可信度標記、3D viewer 如何呈現、或雲端 / 客戶落地端分離架構
- **THEN** 應該從 `docs/plans/ai-bim-governance-設計規格.md` 與 `docs/plans/ai-bim-governance-prototype.html` 進入
- **AND** workflow v3 MUST 只 cross-reference，不得改寫需求

### Requirement: Source-of-truth documents reflect B-scheme architecture rework

`AGENTS.md`, `README.md`, `docs/PROJECT_DEVELOPMENT_WORKFLOW.md`, `docs/plans/ai-bim-governance-設計規格.md`, `docs/plans/ai-bim-governance-prototype.html`, and OpenSpec specs SHALL reflect the cloud-edge separation from `https://bim-docs.jackshappybot.com/` page「01 系統架構」/「BIM 模型管理平台 — 系統架構」: the company cloud is the external control-plane; the customer-edge IFC Worker is the external IFC producer; this repo is the customer-edge data-plane runtime where `bim-review-coordinator` owns the external IFC-ready intake and `bim-streaming-server` is the internal IFC→USDC conversion engine.

The markdown `docs/plans/ai-bim-governance-設計規格.md` and tracked interactive prototype `docs/plans/ai-bim-governance-prototype.html` are the repo-local product requirement source. Generated HTML views derived from markdown SHALL be generated on-demand on the contributor's local machine and SHALL NOT be tracked in the repository. The interactive prototype is the only allowed tracked `docs/plans/*.html` source artifact.

#### Scenario: Generated HTML is on demand, but the prototype is tracked

- **WHEN** a plan Markdown is updated
- **THEN** any corresponding generated HTML view MAY be regenerated on-demand from the Markdown on the contributor's local machine
- **AND** generated HTML SHALL NOT be added to the repository
- **AND** `git ls-files docs/plans/*.html` MUST contain no file except `docs/plans/ai-bim-governance-prototype.html`
- **AND** `docs/plans/ai-bim-governance-prototype.html` SHALL remain paired with `docs/plans/ai-bim-governance-設計規格.md`
