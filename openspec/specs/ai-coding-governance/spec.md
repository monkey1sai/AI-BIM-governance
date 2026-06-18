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
