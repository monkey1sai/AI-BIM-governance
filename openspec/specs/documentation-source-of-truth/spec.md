# documentation-source-of-truth Specification

## Purpose
Defines the repository source-of-truth relationship between workflow v3, the SaaS roadmap, README entry points, and OpenSpec capability specs.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` MODIFIED `AGENTS.md is the source-of-truth for repo boundary` requirement,加 implementation status note 對應 `AGENTS.md §3.4` + `bim-review-coordinator/CLAUDE.md` MUST NOT 段內的 carve-out(允許 coordinator 在 `POST /api/external/ifc-ready` 同步階段下載 IFC 至 `storage/ifc-cache/<ifc_ready_job_id>/source.ifc` 作臨時通道,非資料權威)。完整 wording 見 `openspec/changes/archive/2026-05-21-fast-ifc-link-demo-loop/specs/documentation-source-of-truth/spec.md`。
## Requirements
### Requirement: Workflow v3 and SaaS roadmap have distinct, non-overlapping authority

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v3）與 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`（SaaS 路線圖）SHALL 維持互補不替代的分工：workflow v3 是「開發流程入口」（七層架構、Phase 完成度、驗證證據 4 層分級、IFC→USD 品質管線 7 步、開發協作流程、PR Checklist、服務測試命令、核心資料流 sequence diagram），SaaS 路線圖是「OpenSpec 候選 / NVIDIA Reference 採用決策 / §11.4 Multi-Kit Instance 並行官方定義 / 硬體配置 / MCP 查詢結果」的權威。

#### Scenario: 讀者尋找開發流程

- **WHEN** 工程師想了解七層架構、Phase 完成度、驗證證據分層、PR Checklist、服務測試命令或核心資料流 sequence diagram
- **THEN** 應該從 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 進入；SaaS 路線圖 MUST 不重述這些內容

#### Scenario: 讀者尋找 OpenSpec 候選編號或 NVIDIA 採用決策

- **WHEN** 工程師想確認 OpenSpec 候選 #1-#9 / #1A / #2A 的精確 spec id、KPI、§13 NVIDIA Reference 採用決策、§11.4 Multi-Kit Instance 並行的官方定義、§9.0-§9.8 硬體配置或 §11 MCP 查詢結果
- **THEN** 應該從 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 進入；workflow v3 MUST 不重述這些內容，只能 cross-reference

#### Scenario: 兩份文件在同一主題（如 Phase 3 狀態、候選命名）出現不一致

- **WHEN** workflow v3 與 SaaS 路線圖描述同一主題且兩者不一致
- **THEN** roadmap 為 OpenSpec 候選命名與技術決策的權威；workflow v3 必須以對應 OpenSpec change 對齊 roadmap，不能反向覆蓋

### Requirement: 文件分工調整必須走 OpenSpec change

任何對 workflow v3 與 SaaS 路線圖之間分工的調整（例如把某類內容從 workflow v3 移到 roadmap，或反之）SHALL 透過 OpenSpec change 流程處理，不直接在 `main` 上 commit。

#### Scenario: 把流程內容從 roadmap 移到 workflow v3

- **WHEN** 有人提議把某段內容從 roadmap 搬到 workflow v3（或反向）
- **THEN** 必須新建 OpenSpec change（branch `codex/openspec/<change-id>`），提出 proposal + tasks 並走 PR review + GitHub Actions 驗證，merge 後 archive

#### Scenario: 對 README.md 的「核心文件入口」段做結構性修改

- **WHEN** 有人提議調整 `README.md` 中「核心文件入口」段的文件列表、角色定義或閱讀順序
- **THEN** 必須走 OpenSpec change 流程，不直接在 main 上修改該段；單純的拼字修正或 url 校正例外

### Requirement: workflow v3 與 roadmap 互相 cross-reference 持續成立

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 頂部 metadata 與 §10 source-of-truth 表格 SHALL 包含指向 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 的可開啟連結；`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §1 SHALL 包含指向 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 的可開啟連結。`README.md` 「核心文件入口」段 SHALL 同時列出兩者並描述各自角色。

#### Scenario: cross-reference 被誤刪

- **WHEN** PR 修改了 workflow v3 頂部 metadata、§10 表格、roadmap §1 引言段，或 README.md 「核心文件入口」段而導致雙向 cross-reference 不再成立
- **THEN** review 必須要求補回 cross-reference 才能 merge；或必須附對應 OpenSpec change 說明為何要改變分工

### Requirement: Source-of-truth documents reflect B-scheme architecture rework

`AGENTS.md`, `README.md`, `docs/PROJECT_DEVELOPMENT_WORKFLOW.md`, `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`, and OpenSpec specs SHALL reflect the cloud-edge separation: the company cloud is the external control-plane; the customer-edge IFC Worker is the external IFC producer; this repo is the customer-edge data-plane runtime where `bim-review-coordinator` owns the external IFC-ready intake and `bim-streaming-server` is the internal IFC→USDC conversion engine. `_worker` and `_bim-control` SHALL be described as removed from product runtime (only test fixtures may simulate the external platform), not as degraded/offline fakes. `bim-review-platform` remains a deployment boundary and not a nested repo.

The roadmap markdown `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` is the source of truth; HTML views derived from the markdown SHALL be generated on-demand on the contributor's local machine and SHALL NOT be tracked in the repository. Any other plan markdown under `docs/plans/` MAY have an HTML derived view; the HTML SHALL also be generated on-demand and SHALL NOT be tracked.

#### Scenario: AGENTS and README disagree

- **WHEN** `AGENTS.md` and `README.md` describe different conversion authorities or different intake boundaries
- **THEN** the PR MUST be blocked until both are aligned or the conflict is explicitly documented in the OpenSpec change

#### Scenario: Roadmap HTML is generated on demand, not tracked

- **WHEN** the roadmap Markdown is updated
- **THEN** the corresponding HTML view MAY be regenerated on-demand from the Markdown on the contributor's local machine
- **AND** the HTML SHALL NOT be added to the repository (`git ls-files docs/plans/*.html` MUST be empty)
- **AND** the Markdown remains the source of truth

#### Scenario: PR re-adds a tracked HTML under docs/plans

- **WHEN** a PR introduces `docs/plans/*.html` as tracked file
- **THEN** review MUST block the PR until the HTML is removed and `.gitignore` is verified to still cover `docs/plans/*.html`
- **AND** the PR MUST NOT bypass this gate by claiming the HTML is necessary; HTML is always derived

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

