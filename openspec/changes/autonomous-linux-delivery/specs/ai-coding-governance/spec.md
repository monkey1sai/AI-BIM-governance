## MODIFIED Requirements

### Requirement: Repo SHALL provide agent-readable issue intake and ownership

The repository SHALL provide structured GitHub issue forms for agent tasks, runtime bugs, and governance changes. Blank issues SHALL be disabled. CODEOWNERS SHALL cover repo-wide ownership plus governance-sensitive areas as ownership documentation and routing metadata, but SHALL NOT be a counted approval or merge-authority source after autonomous delivery activation.

#### Scenario: Agent starts from an issue

- **GIVEN** a maintainer creates an implementation issue
- **WHEN** the issue is opened from the repo issue template
- **THEN** it SHALL include requirement source, acceptance criteria, validation commands, evidence expectations, and affected scope.
- **AND** machine governance SHALL be able to resolve the responsible owner boundary for governance-sensitive paths without requiring a human approval vote.

### Requirement: Pull requests SHALL carry machine-checkable AI coding evidence

Pull requests that change governance, frontend/user-facing, or deploy/runtime paths SHALL fill the matching PR evidence table. The PR review workflow SHALL check the PR body before running the review agent. Required evidence SHALL describe exact-head machine adjudication, applicable deterministic／product gates and delivery expectations; it SHALL NOT require a human／CODEOWNER approval field as merge evidence after autonomous delivery activation.

#### Scenario: Governance PR omits evidence

- **GIVEN** a PR changes `AGENTS.md`, `.github/**`, `docs/plans/**`, `docs/agents/**`, PR review scripts, or agent workflow files
- **WHEN** the PR body omits linked issue, requirement source, GitNexus evidence, applicable adversarial review evidence, agent-workflow rollback, self-referential bootstrap impact, or required checks
- **THEN** the PR body evidence checker SHALL fail.
- **AND** the checker SHALL NOT demand a human／CODEOWNER approval event as a substitute for missing machine evidence.

### Requirement: Level 5 remote enforcement SHALL be enabled outside the repo files

Repo files SHALL prepare the checks, templates, ownership mappings, exact-head machine adjudication contracts and deployment evidence schema. After one-time autonomous delivery activation, GitHub branch protection or rulesets SHALL require strict source-pinned machine checks, stale-result invalidation, latest-head evaluation, conversation resolution, enforce-admins, and disallow force-push／delete on `main`; required approving review count SHALL be `0` and CODEOWNER review SHALL NOT be required. Merge authority SHALL belong to an agent-inaccessible external GitHub App that performs exact-head compare-and-swap only after all required checks pass. Before external provisioning, negative／positive live attestation and authoritative settings reread are complete, the repository SHALL remain below autonomous Level 5 and the merge path SHALL be `HELD` rather than self-authorized.

#### Scenario: Maintainer evaluates AI coding maturity after autonomous activation

- **GIVEN** the repo-local governance artifacts are present
- **AND** GitHub branch protection requires the documented source-pinned machine checks without required human／CODEOWNER approval
- **AND** the external App, trusted executor, credential boundary and canonical Linux delivery path have passed live negative and positive attestation
- **AND** the exact-head PR checks are green
- **WHEN** the maintainer scores the repo against the AI coding maturity rubric
- **THEN** the repo MAY be scored at Level 5 for autonomous AI coding governance.
- **AND** product/runtime delivery gaps SHALL still be reported separately from the AI coding governance score.

#### Scenario: External authority或live attestation缺失

- **WHEN** expected App source、branch-protection state、credential isolation、trusted runner或canonical Linux delivery attestation任一無法由server-authoritative evidence證明
- **THEN** autonomous merge status SHALL為 `HELD`
- **AND** repo-owned workflow、agent credential、approval bot或admin bypass SHALL NOT substitute the missing authority
- **AND** the repo SHALL NOT claim autonomous Level 5.
