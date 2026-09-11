# ai-coding-governance Specification

## Purpose

本 capability 定義本 repo 的 AI coding governance maturity gate：agent 不只要能讀 docs 與手動跑 code，還要能從 issue / PR / CI / CODEOWNERS / branch protection 形成可審查、可回滾、可驗證的自動化閉環。

## Requirements

### Requirement: Repo SHALL provide agent-readable issue intake and ownership

The repository SHALL provide structured GitHub issue forms for agent tasks, runtime bugs, and governance changes. Blank issues SHALL be disabled. CODEOWNERS SHALL cover repo-wide ownership plus governance-sensitive areas.

#### Scenario: Agent starts from an issue

- **GIVEN** a maintainer creates an implementation issue
- **WHEN** the issue is opened from the repo issue template
- **THEN** it SHALL include requirement source, acceptance criteria, validation commands, evidence expectations, and affected scope.
- **AND** GitHub SHALL be able to request owner review through CODEOWNERS for governance-sensitive paths.

### Requirement: Pull requests SHALL carry machine-checkable AI coding evidence

Pull requests that change governance, frontend/user-facing, or deploy/runtime paths SHALL fill the matching PR evidence table. The PR review workflow SHALL check the PR body before running the review agent.

#### Scenario: Governance PR omits evidence

- **GIVEN** a PR changes `AGENTS.md`, `.github/**`, `docs/plans/**`, `docs/agents/**`, PR review scripts, or agent workflow files
- **WHEN** the PR body omits linked issue, requirement source, owner review, GitNexus evidence, gstack evidence, agent-workflow rollback, or required checks
- **THEN** the PR body evidence checker SHALL fail.

### Requirement: Required checks SHALL run on every PR

Workflows intended for branch-protection required checks SHALL run on every PR and emit an explicit result. They SHALL NOT use workflow-level `paths` / `paths-ignore` filters that could leave required checks pending or bypass governance-only changes.

#### Scenario: Docs-only governance PR

- **GIVEN** a PR only changes governance documentation or workflow policy
- **WHEN** branch protection requires `agent-governance` and `pr-review-agent`
- **THEN** both workflows SHALL produce check results.
- **AND** path-specific logic, if needed, SHALL occur inside jobs or scripts.

### Requirement: Level 5 remote enforcement SHALL be enabled outside the repo files

Repo files SHALL prepare the checks, templates, and owner mappings. GitHub branch protection or rulesets SHALL require the checks, pull request review, CODEOWNER review, stale review dismissal, latest-push approval, conversation resolution, and shall disallow force-push/delete on `main`.

#### Scenario: Maintainer evaluates AI coding maturity

- **GIVEN** the repo-local governance artifacts are present
- **AND** GitHub branch protection requires the documented checks and owner review
- **AND** the PR checks are green
- **WHEN** the maintainer scores the repo against the AI coding maturity rubric
- **THEN** the repo MAY be scored at Level 5 for AI coding governance.
- **AND** product/runtime evidence gaps SHALL still be reported separately from the AI coding governance score.

### Requirement: Active workflow routing SHALL preserve deterministic drift checks after spec-to-done retirement

已退役的 spec-to-done 技能及 writer SHALL 不再可被 discovery 或用來派工。`std-plan.js`、`std-implement.js`、`std-evidence.js`、`std-evidence-closeout.js`、`plan-next-spec-to-done-aware.js`、`spec-to-done-adversarial-verify.js` SHALL 僅保留零派工相容入口，不再要求生成舊 ROUTING 區塊。仍啟用的 scanner workflow SHALL 繼續以 canonical `routing.json`、`scripts/gen_routing.py` 與 deterministic tests 保證路由不漂移；不得藉退役停用共用 gate。

#### Scenario: Retired workflows cannot dispatch or mutate state

- **GIVEN** 任一已退役 workflow 與任意輸入參數
- **WHEN** 呼叫相容入口
- **THEN** 它 SHALL 固定回傳 `retired_workflow` 與 `agentCallsUsed=0`
- **AND** SHALL 不呼叫 agent、不讀取執行 capability、不建立或追加 run state。

#### Scenario: Active scanner routing drift remains rejected

- **GIVEN** `routing.json` 與仍啟用 scanner 的 codegen ROUTING 區塊
- **WHEN** 區塊或 call-site tier 與 canonical routing 不一致
- **THEN** `scripts/gen_routing.py --check` SHALL exit non-zero，`tests/test_routing_consistency.py` SHALL fail。
- **AND** 已退役入口 SHALL 被 codegen 明確排除，退役行為由 `tests/test_spec_workflow_lean.mjs` 驗證。

#### Scenario: Historical readers do not restore an execution lane

- **GIVEN** 歷史 state、machine/Fabric contract 或 task-packet/v2 的 Lane S 資料
- **WHEN** 保留的 reader 執行格式驗證
- **THEN** SHALL 保留原有拒絕條件，且 SHALL NOT 授予 dispatch、resume、merge 或部署權限。
- **AND** 新任務 SHALL 使用 F/B/G；task-packet CLI 對含 S 的成功結果 SHALL 標示 `retired_lane_validation_only: true` 並維持 `authorization_granted: false`。

#### Scenario: Invalid model/effort combination is rejected before generation

- **GIVEN** `routing.json` declares `allowed_efforts` per model
- **WHEN** a tier declares a model+effort combination outside `allowed_efforts` (for example `sonnet` with `xhigh`)
- **THEN** `scripts/gen_routing.py` SHALL raise and refuse to generate, so an illegal combination cannot reach a workflow script.
