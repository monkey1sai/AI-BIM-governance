# agent-operability-governance Specification

## Purpose
本 capability 收斂 repo agent 的操作性治理規則：agent 進行 user-facing 治理開發時，行為邊界 SHALL 對齊 A1–A10 產品定位（以設計站「05 BIM治理與模型檢核」/「06 操作介面總覽」為定位與操作性語意參考、程式碼與 contract 為行為權威）；user-facing 能力的「完成」SHALL 以前端可操作（frontend-operable，含 browser E2E evidence）為準，不接受 backend-only done；deploy / runtime 行為 SHALL 流經 canonical 腳本（`scripts/deploy.ps1` golden path），新增 root-level start/smoke/check 腳本預設視為邊界風險。
## Requirements
### Requirement: Agent boundary SHALL align A1-A10 product positioning

The repo agent contract SHALL identify `https://bim-docs.jackshappybot.com/` page「05 BIM治理與模型檢核」A1-A10 as the main product development items for this repo, and page「06 操作介面總覽」as the user-operation reference for UI routes, buttons, progress, and validation flows. The design site SHALL guide product positioning and operability semantics, while code and contracts remain the behavior source of truth.

#### Scenario: Agent starts user-facing governance work

- **GIVEN** an agent is asked to modify a user-facing governance capability
- **WHEN** the agent reads the repo contract
- **THEN** the agent SHALL map the work to the relevant A1-A10 product item
- **AND** the agent SHALL consult the frontend operability guidance before claiming done
- **AND** the agent SHALL NOT treat backend/API completion as full user-facing completion.

### Requirement: User-facing completion SHALL be frontend-operable

Every user-facing capability SHALL be verifiable from a frontend screen. Completion SHALL require a documented frontend route, visible controls/buttons, default fixture data, loading/success/failure/retry UI states, relevant runtime identifiers, and browser E2E evidence where applicable.

#### Scenario: User verifies a capability from browser UI

- **GIVEN** the development server is running
- **AND** default fixture data is available
- **WHEN** the user opens the documented frontend route
- **AND** clicks the documented action button
- **THEN** the system SHALL call the real backend API
- **AND** the frontend SHALL display loading, success, and failure states
- **AND** the resulting domain object SHALL be visible in the UI
- **AND** the PR SHALL include browser E2E command and screenshot or trace evidence when the capability is user-facing.

### Requirement: Deployment behavior SHALL flow through canonical scripts

`scripts/deploy.ps1` SHALL be the canonical one-click deploy / demo entrypoint. Runtime, Docker, Kit, viewer, env, port, conversion-service, or demo launch changes SHALL update or explicitly verify this deploy path. New root-level `scripts/start-*.ps1`, `scripts/smoke-*.ps1`, `scripts/check-*.ps1`, `scripts/*-docker.ps1`, or `scripts/deploy-*.ps1` SHALL be prohibited by default unless registered and justified in the script contract.

#### Scenario: PR changes runtime or deploy topology

- **GIVEN** a PR changes runtime, Docker, Kit, viewer, env, port, conversion-service, or demo launch behavior
- **WHEN** the PR is prepared
- **THEN** it SHALL update or explicitly verify `scripts/deploy.ps1`
- **AND** it SHALL report `.\scripts\deploy.ps1 -DryRun` or explain why it could not be run
- **AND** it SHALL update `scripts/script-registry.json` and `scripts/SCRIPT_CONTRACT.md` if a root-level script is added.

### Requirement: Agent SHALL 對每個完成的 work item 走 buffered ship-cycle 自動化

Agent 完成一個可驗證的 work item 後 SHALL 依 `.claude/workflows/ship-item.md` 定義的 ship-cycle 自動 commit → push → 開 PR → 觀測 CI 與 reviewer comment → 在官方 gate（pr-review-agent + CodeRabbit）全綠且當前 head 無新 substantive P1/P2 時 merge（merge commit、non-squash，保留 lifecycle `subject_commit` ancestry）並 closeout。Agent SHALL NOT merge 過 production code 的真 P1/P2，SHALL NOT 偽裝 CI 綠；non-production 產物（evidence/docs scaffolding）的 advisory nit 在官方 gate 全綠時 MAY judgment-merge。

#### Scenario: 完成 work item 後自動 ship 並守 buffered gate

- **WHEN** agent 完成一個 work item 並 commit 到 feature branch
- **THEN** agent SHALL push、開 PR、`gh pr checks --watch` 等 CI、再留 ~90-120s reviewer buffer
- **AND** 僅在官方 gate 全綠且當前 head 無新 substantive P1/P2 時 SHALL merge（merge commit、non-squash，保留 lifecycle ancestry）並 closeout
- **AND** 有新 substantive 發現時 SHALL 修復並對每個 push 重跑 buffer cycle，SHALL NOT 只看 check 狀態就 merge

#### Scenario: 不 merge 過 production code 真 P1/P2

- **WHEN** reviewer 在 CI 變綠後對 production code 貼出新的 P1/P2
- **THEN** agent SHALL NOT merge，SHALL 先修復再重跑 ship-cycle

### Requirement: Design gate SHALL use a closed policy and ref-bound tracked HTML source collection

The design gate SHALL define its current HTML source set from the Git-tracked result of `git ls-files -- 'docs/plans/*.html'`. Base/head collection SHALL use the equivalent ref-bound Git tree query and SHALL NOT use a working-tree directory scan.

The initial policy registry SHALL contain exactly:

- `ai-bim-frontend-backend-design` → `docs/plans/AI-BIM 前後端設計文件.dc.html` → `architecture_behavior`
- `ai-bim-console-hifi` → `docs/plans/AI-BIM Console Hi-Fi.dc.html` → `console_hifi_visual`

Each source SHALL have a unique `source_id`, repo-relative path, and `source_role`. The collector SHALL retain the requested ref, resolved commit, Git blob OID, and SHA-256 of the raw Git blob bytes as source-collection integrity data. Base-only sources SHALL remain visible when deleted from head. These integrity fields SHALL NOT be represented as field-level provenance or as a status classifier.

Engineering policy SHALL be versioned at `scripts/config/design-gate-policy.json` under a closed schema. It SHALL preserve the currently verified Windows/Chromium, DPR1, viewport, locale/timezone, animation, pixel comparison, semantic parity, and full-completion eligibility values, and SHALL NOT contain a self-referential `policy_digest`.

Invalid policy schema, missing or unknown keys, duplicate source identity, unregistered or role-ambiguous sources, external paths, origin projections, untracked files, ignored files, or unresolved base/head collection SHALL fail closed. The validator SHALL NOT use PR prose, screenshots, caller-supplied digests, working-tree bytes, or manual booleans as authority. Manifest, golden, baseline, capture, and rebaseline surfaces SHALL remain read-only.

#### Scenario: Validate the current ref-bound source registry

- **GIVEN** a valid closed policy registers the two Git-tracked HTML sources
- **WHEN** the collector resolves the current checkout or a named Git ref
- **THEN** each result SHALL contain the registered source ID, path, and role
- **AND** its commit, blob OID, and SHA-256 SHALL match the raw Git blob bytes at that ref
- **AND** the collector SHALL NOT read untracked or ignored HTML as authority.

#### Scenario: Preserve base-only source deletion visibility

- **GIVEN** a registered HTML source exists in base and is deleted or renamed in head
- **WHEN** the collector evaluates the base/head source sets
- **THEN** the base-only source SHALL remain visible in the collection result
- **AND** the deletion or rename SHALL NOT shrink the governed source set silently.

#### Scenario: Fail closed for an unregistered or untrusted source

- **GIVEN** an HTML input is external, origin-projected, untracked, ignored, unregistered, or role-ambiguous
- **WHEN** the collector validates that input
- **THEN** validation SHALL fail with the matching source error
- **AND** no caller-supplied digest, PR prose, screenshot, or manual boolean SHALL substitute for Git authority
- **AND** the collector SHALL NOT emit successful eligibility.

#### Scenario: Fail closed for an invalid closed policy

- **GIVEN** the policy is missing, malformed, has an unsupported schema, contains an unknown or missing required key, duplicates a source identity, or contains `policy_digest`
- **WHEN** the policy validator evaluates it
- **THEN** validation SHALL fail with the matching schema error
- **AND** no manifest field or caller-provided value SHALL replace the invalid policy
- **AND** the manifest, golden, baseline, capture, and rebaseline surfaces SHALL remain unchanged.

