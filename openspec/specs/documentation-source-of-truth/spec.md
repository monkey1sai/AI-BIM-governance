# documentation-source-of-truth Specification

## Purpose
Defines the repository source-of-truth relationship between workflow v3, the repo-local product design spec/prototype, README entry points, and OpenSpec capability specs.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` MODIFIED `AGENTS.md is the source-of-truth for repo boundary` requirement,加 implementation status note 對應 `AGENTS.md §3.4` + `bim-review-coordinator/CLAUDE.md` MUST NOT 段內的 carve-out(允許 coordinator 在 `POST /api/external/ifc-ready` 同步階段下載 IFC 至 `storage/ifc-cache/<ifc_ready_job_id>/source.ifc` 作臨時通道,非資料權威)。完整 wording 見 `openspec/changes/archive/2026-05-21-fast-ifc-link-demo-loop/specs/documentation-source-of-truth/spec.md`。
## Requirements
### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v3）與 `docs/plans/ai-bim-governance-設計規格.md` / `docs/plans/ai-bim-governance-prototype.html`（repo-local product design artifacts）SHALL 維持互補不替代的分工：workflow v3 是「開發流程入口」（七層架構、Phase 完成度、驗證證據分級、IFC→USD 品質管線、開發協作流程、PR Checklist、服務測試命令、核心資料流 sequence diagram）；設計規格與 prototype 是 A1–A10 功能需求、操作介面語意、可信度標記與雲端 / 客戶落地端分離架構對齊的權威入口。

#### Scenario: 讀者尋找開發流程

- **WHEN** 工程師想了解七層架構、Phase 完成度、驗證證據分層、PR Checklist、服務測試命令或核心資料流 sequence diagram
- **THEN** 應該從 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 進入；設計規格與 prototype MUST 不重述流程細節

#### Scenario: 讀者尋找產品功能需求或操作原型

- **WHEN** 工程師想確認 A1–A10 功能、頁面分群、按鈕語意、可信度標記、3D viewer 如何呈現、或雲端 / 客戶落地端分離架構
- **THEN** 應該從 `docs/plans/ai-bim-governance-設計規格.md` 與 `docs/plans/ai-bim-governance-prototype.html` 進入；workflow v3 MUST 只 cross-reference，不得改寫需求

#### Scenario: 兩份文件在同一主題（如 Phase 3 狀態、候選命名）出現不一致

- **WHEN** workflow v3 與設計規格 / prototype 描述同一 user-facing 功能且兩者不一致
- **THEN** 設計規格 / prototype 為產品需求與操作語意權威；程式碼、contracts、OpenSpec specs 仍為行為正確性權威；workflow v3 必須以對應 OpenSpec change 對齊，不能反向覆蓋

### Requirement: 文件分工調整必須走 OpenSpec change

任何對 workflow v3、設計規格、prototype、README entrypoint 與 OpenSpec specs 之間分工的調整 SHALL 透過 OpenSpec change 流程處理，不直接在 `main` 上 commit。

#### Scenario: 把流程內容移到設計規格或把需求內容移到 workflow v3

- **WHEN** 有人提議把某段流程內容搬到設計規格 / prototype，或把 A1–A10 需求內容搬到 workflow v3
- **THEN** 必須新建 OpenSpec change（branch `codex/openspec/<change-id>`），提出 proposal + tasks 並走 PR review + GitHub Actions 驗證，merge 後 archive

#### Scenario: 對 README.md 的「核心文件入口」段做結構性修改

- **WHEN** 有人提議調整 `README.md` 中「核心文件入口」段的文件列表、角色定義或閱讀順序
- **THEN** 必須走 OpenSpec change 流程，不直接在 main 上修改該段；單純的拼字修正或 url 校正例外

### Requirement: workflow v3 與 product design artifacts 互相 cross-reference 持續成立

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 頂部 metadata 與 §10 source-of-truth 表格 SHALL 包含指向 `docs/plans/ai-bim-governance-設計規格.md` 與 `docs/plans/ai-bim-governance-prototype.html` 的可開啟連結；`docs/plans/ai-bim-governance-設計規格.md` SHALL identify itself and the prototype as the repo-local product requirement source. `README.md` 「核心文件入口」段 SHALL 同時列出 workflow、設計規格、prototype、demo runbook 與 OpenSpec specs 並描述各自角色。

#### Scenario: cross-reference 被誤刪

- **WHEN** PR 修改了 workflow v3 頂部 metadata、§10 表格、設計規格 metadata、prototype path，或 README.md 「核心文件入口」段而導致 cross-reference 不再成立
- **THEN** review 必須要求補回 cross-reference 才能 merge；或必須附對應 OpenSpec change 說明為何要改變分工

### Requirement: Source-of-truth documents reflect B-scheme architecture rework

`AGENTS.md`, `README.md`, `docs/PROJECT_DEVELOPMENT_WORKFLOW.md`, `docs/plans/ai-bim-governance-設計規格.md`, `docs/plans/ai-bim-governance-prototype.html`, and OpenSpec specs SHALL reflect the cloud-edge separation from `https://bim-docs.jackshappybot.com/` page「01 系統架構」/「BIM 模型管理平台 — 系統架構」: the company cloud is the external control-plane; the customer-edge IFC Worker is the external IFC producer; this repo is the customer-edge data-plane runtime where `bim-review-coordinator` owns the external IFC-ready intake and `bim-streaming-server` is the internal IFC→USDC conversion engine. `_worker` and `_bim-control` SHALL be described as removed from product runtime (only test fixtures may simulate the external platform), not as degraded/offline fakes. `bim-review-platform` remains a deployment boundary and not a nested repo.

The markdown `docs/plans/ai-bim-governance-設計規格.md` and tracked interactive prototype `docs/plans/ai-bim-governance-prototype.html` are the repo-local product requirement source. Generated HTML views derived from markdown SHALL be generated on-demand on the contributor's local machine and SHALL NOT be tracked in the repository. The interactive prototype is the only allowed tracked `docs/plans/*.html` source artifact.

#### Scenario: AGENTS and README disagree

- **WHEN** `AGENTS.md` and `README.md` describe different conversion authorities or different intake boundaries
- **THEN** the PR MUST be blocked until both are aligned or the conflict is explicitly documented in the OpenSpec change

#### Scenario: Generated HTML is on demand, but the prototype is tracked

- **WHEN** a plan Markdown is updated
- **THEN** any corresponding generated HTML view MAY be regenerated on-demand from the Markdown on the contributor's local machine
- **AND** generated HTML SHALL NOT be added to the repository
- **AND** `git ls-files docs/plans/*.html` MUST contain no file except `docs/plans/ai-bim-governance-prototype.html`
- **AND** `docs/plans/ai-bim-governance-prototype.html` SHALL remain paired with `docs/plans/ai-bim-governance-設計規格.md`

#### Scenario: PR adds a generated HTML under docs/plans

- **WHEN** a PR introduces `docs/plans/*.html` as tracked file
- **THEN** review MUST verify whether the file is `docs/plans/ai-bim-governance-prototype.html`
- **AND** if it is any other generated HTML, review MUST block the PR until the HTML is removed and `.gitignore` is verified to still cover generated `docs/plans/*.html`
- **AND** the PR MUST NOT bypass this gate by claiming generated HTML is necessary

#### Scenario: Mock services described as removed, not degraded

- **WHEN** a source-of-truth document describes `_worker` or `_bim-control`
- **THEN** it MUST state they are removed from product runtime and only simulated by test fixtures
- **AND** it MUST NOT describe them as a retained offline/optional runtime profile

#### Scenario: bim-review-platform wording is ambiguous

- **WHEN** a document says `bim-review-platform`
- **THEN** it MUST state whether it means deployment boundary, compose profile, module folder, or actual service process
- **AND** it MUST NOT imply nested Git unless a separate approved governance change allows it

### Requirement: Archived change evidence SHALL live next to the archive artifact

Evidence（截圖、JSON dump、chrome events、log capture 等）對於已 archived 的 OpenSpec change，SHALL 存放於 `openspec/changes/archive/<change-id>/evidence/` 並與 change artifact（proposal / design / specs / tasks / acceptance）並列；SHALL NOT 散落在 root `docs/evidence/` 與 archive 並排。

Root `docs/evidence/` 之下 MAY 保留**未 archive** 的當期 evidence；一旦對應 OpenSpec change 進入 archive，evidence dir SHALL 一併搬到 archive sibling。

#### Scenario: PR archive 一個 change 但 evidence 留在 root docs/evidence

- **WHEN** PR archive 一個 OpenSpec change 並把 artifact 搬到 `openspec/changes/archive/<change-id>/`，但對應 evidence 仍在 root `docs/evidence/<topic>/`
- **THEN** review MUST 要求把 evidence 同步搬到 `openspec/changes/archive/<change-id>/evidence/`，或附理由說明為何 evidence 與 archive 分離

#### Scenario: 已 archived change 內部 acceptance.md 引用 evidence

- **WHEN** archived change 內部 `acceptance.md` 引用 evidence path
- **THEN** path SHALL 為相對 path `evidence/<file>`（指向 sibling dir），不得為 root absolute `docs/evidence/<topic>/<file>`

#### Scenario: 新增 evidence 但對應 change 還在 active

- **WHEN** 一個 active OpenSpec change 還在 apply / verify 階段，需要記錄 evidence
- **THEN** evidence MAY 暫存於 root `docs/evidence/<topic>/` 或 active change dir 內；archive 時 SHALL 搬到 archive sibling

### Requirement: Superseded design drafts SHALL point to the authoritative archive

當同一主題的設計文件已被正式 OpenSpec change archive 取代,殘留於 `docs/` 的舊草稿(brainstorming / pre-archive draft)SHALL 在頂部標記 superseded 並指向權威 archive 路徑,SHALL NOT 與 archive 並存而無區別以免讀者誤用過期決策。原草稿 MAY 保留作歷史脈絡,但 MUST NOT 被引用為現行設計權威。

#### Scenario: Pre-archive draft coexists with archived authority

- **WHEN** `docs/` 下存在一份設計草稿,其主題已由 `openspec/changes/archive/<change-id>/` 的正式 spec 取代(例:`docs/superpowers/specs/2026-05-26-one-click-deploy-design.md` 對 `openspec/changes/archive/2026-05-27-add-one-click-deploy-hybrid/`)
- **THEN** 該草稿頂部 SHALL 標記 superseded 並指向該 archive 權威路徑
- **AND** 決策以 archive spec.md 為準,草稿 MUST NOT 被引用為現行設計權威
- **AND** 草稿 MAY 保留供歷史脈絡,archive artifact SHALL NOT 被刪改(immutable)

