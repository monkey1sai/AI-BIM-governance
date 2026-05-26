## MODIFIED Requirements

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

## ADDED Requirements

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
