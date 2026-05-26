## ADDED Requirements

### Requirement: PR review agent runs for every reviewable pull request

The repository SHALL run an automated PR review agent gate for every reviewable pull request targeting the protected integration branch.

#### Scenario: PR is opened or updated

- **WHEN** a pull request is opened, reopened, marked ready for review, or updated with new commits
- **THEN** the PR review agent gate runs against the current head SHA
- **AND** the gate records the base ref, head ref, base SHA, head SHA, PR number, trigger event, and run timestamp

#### Scenario: Draft PR is updated

- **WHEN** a draft pull request receives new commits
- **THEN** the PR review agent MAY run in report-only mode
- **AND** it MUST NOT mark the merge gate passed until the pull request is ready for review

### Requirement: PR review agent publishes reviewable evidence

The PR review agent SHALL publish a machine-readable report and a human-readable summary for each run.

#### Scenario: Review report is created

- **WHEN** the PR review agent completes
- **THEN** it produces a JSON report containing `status`, `risk_level`, `changed_paths`, `openspec_changes`, `validation_commands`, `checks`, `blockers`, `warnings`, `human_review_notes`, and `gitnexus`
- **AND** it publishes a markdown summary as a PR comment, status check summary, or workflow artifact

#### Scenario: Report generation fails

- **WHEN** the agent cannot produce a report that identifies what was checked
- **THEN** the gate status MUST be `failed`
- **AND** the PR output MUST say that review evidence is unavailable

### Requirement: PR review agent preserves human approval boundaries

The PR review agent SHALL NOT replace human review, CODEOWNERS, branch protection, or merge authorization.

#### Scenario: Automated gate passes

- **WHEN** all required checks pass and the agent marks the review gate as `passed`
- **THEN** the PR still requires any configured human review, CODEOWNERS approval, branch protection, and merge policy
- **AND** the agent MUST NOT merge the pull request automatically

#### Scenario: Automated GitHub review is emitted

- **WHEN** the implementation chooses to write a GitHub review event
- **THEN** the review body MUST state that it is an automated gate verdict
- **AND** it MUST NOT dismiss, override, or substitute required human approvals

### Requirement: Deterministic checks run before optional AI judgment

The PR review agent SHALL base pass/block decisions on deterministic checks before using any optional AI reviewer output.

#### Scenario: Deterministic checks pass and AI adapter is unavailable

- **WHEN** all required deterministic checks pass and the optional AI adapter is unavailable
- **THEN** the gate MAY return `passed` or `warning` according to configured policy
- **AND** the report MUST record that AI review was skipped and why

#### Scenario: Deterministic checks fail

- **WHEN** any required deterministic check fails
- **THEN** optional AI reviewer output MUST NOT convert the gate to `passed`
- **AND** the report MUST list the failed command or check as a blocker

### Requirement: PR review agent validates OpenSpec alignment

The PR review agent SHALL verify that PRs containing non-trivial behavior, architecture, workflow, API, data-flow, or repo-boundary changes are backed by an OpenSpec change or an explicit documented exception.

#### Scenario: PR includes OpenSpec change artifacts

- **WHEN** changed paths include `openspec/changes/<change-id>/`
- **THEN** the agent runs `openspec validate <change-id>`
- **AND** the report records the validation command, result, and change id

#### Scenario: Behavior change has no OpenSpec change

- **WHEN** changed paths indicate production code, workflow, API, data-flow, repo-boundary, or verification policy changes without an OpenSpec change
- **THEN** the gate status MUST be `blocked`
- **AND** the report MUST ask for an OpenSpec change id or a documented exception

### Requirement: PR review agent enforces repo boundary guardrails

The PR review agent SHALL check PRs for changes that violate the repo boundary rules documented in `AGENTS.md`, README, and OpenSpec specs.

#### Scenario: Retired runtime is reintroduced

- **WHEN** a PR adds startup, health check, smoke, runtime dependency, or required workflow references that treat retired `_worker`, `_bim-control`, `_s3_storage`, `_conversion-service`, or `_conversion-server` as current product runtime
- **THEN** the gate status MUST be `blocked`
- **AND** the report MUST identify the path and boundary rule that was violated

#### Scenario: Runtime boundary changes are documented

- **WHEN** a PR changes responsibilities between `bim-review-coordinator`, `bim-streaming-server`, `web-viewer-sample`, external IFC Worker, or external company cloud
- **THEN** the report MUST identify the affected owner boundary
- **AND** the gate MUST require matching OpenSpec requirement or design documentation before it can pass

### Requirement: PR review agent blocks secret and environment-value changes

The PR review agent SHALL block unsafe secret, credential, private key, and real environment-value modifications.

#### Scenario: Secret-like file is modified

- **WHEN** a PR modifies private keys, credentials, token files, or existing `.env` secret values
- **THEN** the gate status MUST be `blocked`
- **AND** the report MUST identify the file path without printing the secret value

#### Scenario: Environment example is updated

- **WHEN** a PR modifies `.env.example` or adds documented placeholder variables without real secret values
- **THEN** the gate MAY pass if other checks pass
- **AND** the report MUST record the env contract change for human review

### Requirement: PR review agent selects smallest necessary validation

The PR review agent SHALL choose validation commands from changed paths and record skipped checks with reasons.

#### Scenario: Service-owned code changes

- **WHEN** changed paths touch `bim-review-coordinator/`, `web-viewer-sample/`, `bim-streaming-server/`, `tests/`, or `scripts/`
- **THEN** the agent selects the smallest useful test, build, smoke, or parse check for the affected owner
- **AND** the report records the command, working directory, result, and owner

#### Scenario: Required validation cannot run in the environment

- **WHEN** a required check needs unavailable GPU, Kit SDK, browser automation, network, or credentials
- **THEN** the agent records the check as `blocked`, `deferred`, or `not_required` according to the changed paths
- **AND** it MUST NOT claim that unavailable validation passed

#### Scenario: Required local tooling is unavailable during rollout

- **WHEN** the GitHub-hosted runner lacks a local validation tool such as OpenSpec or GitNexus
- **AND** the workflow has an explicit tooling-only rollout exception
- **THEN** the agent records the check as `skipped` with a warning
- **AND** it MUST NOT claim that unavailable validation passed

### Requirement: PR review agent integrates GitNexus impact evidence

The PR review agent SHALL collect GitNexus change detection or record a clear unavailable reason before the gate passes code changes.

#### Scenario: Code paths changed and GitNexus succeeds

- **WHEN** changed paths include source code or scripts and GitNexus detect changes succeeds
- **THEN** the report records affected symbols, affected flows, risk level, and whether the result is within the expected scope

#### Scenario: Code paths changed and GitNexus is unavailable

- **WHEN** changed paths include source code or scripts and GitNexus detect changes is stale, unavailable, or fails
- **THEN** the gate status MUST be `blocked` unless the PR includes an explicit docs-only or tooling-only exception
- **AND** the report MUST record the command or tool status that failed

### Requirement: PR review agent classifies risk and blockers consistently

The PR review agent SHALL classify each run as `passed`, `warning`, `blocked`, or `failed`, and each risk as `low`, `medium`, `high`, or `critical`.

#### Scenario: High or critical risk is unresolved

- **WHEN** deterministic checks, GitNexus evidence, path policy, or AI reviewer output identifies unresolved HIGH or CRITICAL risk
- **THEN** the gate status MUST be `blocked`
- **AND** the report MUST list the mitigation needed before merge

#### Scenario: Only non-blocking warnings remain

- **WHEN** required checks pass and only non-blocking warnings remain
- **THEN** the gate status MAY be `warning`
- **AND** the report MUST list which warnings require human attention
