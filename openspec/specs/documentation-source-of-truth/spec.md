# documentation-source-of-truth Specification

## Purpose
Defines the repository source-of-truth relationship between workflow v3, the repo-local product design spec/prototype, README entry points, and OpenSpec capability specs.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` MODIFIED `AGENTS.md is the source-of-truth for repo boundary` requirement,加 implementation status note 對應 `AGENTS.md §3.4` + `bim-review-coordinator/CLAUDE.md` MUST NOT 段內的 carve-out(允許 coordinator 在 `POST /api/external/ifc-ready` 同步階段下載 IFC 至 `storage/ifc-cache/<ifc_ready_job_id>/source.ifc` 作臨時通道,非資料權威)。完整 wording 見 `openspec/changes/archive/2026-05-21-fast-ifc-link-demo-loop/specs/documentation-source-of-truth/spec.md`。
## Requirements
### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v3）與 `docs/plans/docs-plans-README.md` 導向的 TRUTH/TARGET/PROCESS/BACKLOG＋兩份 prototype SHALL 維持互補不替代的分工：workflow v3 是開發流程入口；`TRUTH.md` 記現況，`TARGET-contracts.md`／`TARGET-shell.md`／`TARGET-viewer.md` 定義需求，`BACKLOG.md` 排序 gap／OPEN 決策，`PROCESS.md` 定義 DoD；兩份 prototype 是可點擊產品樣貌錨。

#### Scenario: 讀者尋找開發流程

- **WHEN** 工程師想了解七層架構、Phase 脈絡、驗證證據分層、PR Checklist、服務測試命令或核心資料流
- **THEN** 應從 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 進入
- **AND** plans TARGET 與 prototype SHALL NOT 重述完整開發流程

#### Scenario: 讀者尋找需求、現況或操作原型

- **WHEN** 工程師想確認 A1–A10 需求、頁面操作、建成狀態、缺口排序或 viewer 樣貌
- **THEN** 應從 `docs/plans/docs-plans-README.md` 進入並依 ownership 讀 TRUTH/TARGET/BACKLOG/PROCESS
- **AND** 殼層與 viewer 樣貌 SHALL 分別以兩份 tracked prototype 為錨
- **AND** workflow v3 MUST 只 cross-reference，不得改寫需求或 runtime 現況

#### Scenario: workflow 與 TARGET 或 runtime truth 不一致

- **WHEN** workflow v3 與 TARGET/prototype 描述同一 user-facing 需求且不一致
- **THEN** TARGET/prototype 為目標需求權威
- **AND** runtime 現況 SHALL 以 code＋tests/contracts 驗證，TRUTH 必須誠實同步而不得反向覆蓋 runtime

### Requirement: 文件分工調整必須走 OpenSpec change

任何對 workflow v3、TRUTH/TARGET/PROCESS/BACKLOG、prototype、README entrypoint 與 OpenSpec specs 之間分工的調整 SHALL 透過 OpenSpec change 流程處理，不直接在 `main` 上 commit。

#### Scenario: 把流程內容移到 TARGET 或把需求內容移到 workflow v3

- **WHEN** 有人提議把某段流程內容搬到 TARGET / prototype，或把 A1–A10 需求內容搬到 workflow v3
- **THEN** 必須新建 OpenSpec change（branch `codex/openspec/<change-id>`），提出 proposal + tasks 並走 PR review + GitHub Actions 驗證，merge 後 archive

#### Scenario: 對 README.md 的「產品與需求文件」段做結構性修改

- **WHEN** 有人提議調整 `README.md` 中「產品與需求文件」段的文件列表、角色定義或閱讀順序
- **THEN** 必須走 OpenSpec change 流程，不直接在 main 上修改該段；單純的拼字修正或 url 校正例外

### Requirement: workflow v3 與 product design artifacts 互相 cross-reference 持續成立

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 頂部 metadata 與 source-of-truth 表 SHALL 連到 `docs/plans/docs-plans-README.md`、TRUTH/TARGET/PROCESS/BACKLOG 與兩份 prototypes；`README.md` 的產品文件入口 SHALL 列出相同 ownership，active agent workflows／OpenSpec deltas／demo docs SHALL NOT 讀取已刪除的六份舊正本。

#### Scenario: active consumer 指向被刪舊正本

- **WHEN** active README、workflow、skill、OpenSpec delta、demo 或 SaaS keep doc 引用六份舊正本任一檔名
- **THEN** change MUST 被阻擋直到引用改指新 owning source
- **AND** 歷史 archive/evidence MAY 保留舊引用；archive-managed canonical spec 若已有本 change 的完整 MODIFIED delta，MAY 在 active change 期間保留 predecessor wording，但 merge 後 MUST 由 archive closeout 立即落地，期間由 `docs-plans-README.md` 救援表提供去向

#### Scenario: 兩份 prototype 保持可發現

- **WHEN** 讀者從 README、workflow v3 或 plans entry 尋找產品樣貌
- **THEN** `ai-bim-governance-prototype.html` 與 `ai-bim-geo-viewer-prototype.html` SHALL 都可開啟
- **AND** 不得只列其中一份或把 generated HTML 當第三份 requirement source

### Requirement: Source-of-truth documents reflect B-scheme architecture rework

`AGENTS.md`、`README.md`、workflow v3、plans entry、TRUTH/TARGET、兩份 prototype 與 OpenSpec specs SHALL 一致描述 B-scheme：外部公司雲端是 control-plane；外部客戶落地端 IFC Worker 是 IFC producer；本 repo 是 customer-edge data-plane；coordinator owns IFC-ready intake；streaming-server owns internal IFC→USDC conversion。`_worker`／`_bim-control` 不得被描述為 product runtime。

兩份 tracked prototypes 是唯一允許提交的 `docs/plans/*.html` source artifacts；其他由 Markdown 產生的 HTML SHALL on-demand 生成且 SHALL NOT tracked。

#### Scenario: tracked plans HTML 清單

- **WHEN** reviewer 執行 `git ls-files docs/plans/*.html`
- **THEN** 結果 SHALL 恰為 `docs/plans/ai-bim-governance-prototype.html` 與 `docs/plans/ai-bim-geo-viewer-prototype.html`
- **AND** 任何第三份 generated HTML MUST 在 merge 前移除

#### Scenario: cloud-edge ownership 保持一致

- **WHEN** 任一 active source-of-truth 文件描述 conversion authority、IFC-ready intake、模型 payload 或 retired services
- **THEN** 它 SHALL 與 B-scheme ownership 一致
- **AND** 模型 payload SHALL 留在 customer-edge data-plane，外部雲端只接 metadata/control-plane 資訊

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

