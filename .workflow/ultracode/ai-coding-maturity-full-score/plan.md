# AI Coding Maturity Full Score

## Goal

Re-score the repo's AI coding maturity using the downloaded checklist and all `docs/plans` files as requirements, then add the smallest repo-local governance artifacts needed to close Level 4/5 gaps where possible.

## Success criteria

- Read `C:\Users\IOT\Downloads\AI-BIM-governance 深度檢視 Checklist.md`.
- Treat every file under `docs/plans/` as product requirement/spec input.
- Produce a conservative score and explain what changed from the prior Level 3.5 audit.
- Add a Superpowers implementation plan under `docs/superpowers/plans/`.
- Implement repo-local Level 4/5 governance improvements without deployment or publishing.
- Verify edited artifacts with targeted static checks.
- Clearly separate local repo gaps from remote GitHub settings that cannot be enforced by file edits alone.

## Current context

Current branch: `codex/rewrite-readme-entrypoint`.

The working tree already contains a rewritten `README.md`, previous Ultracode audit artifacts, and unrelated untracked E2E artifacts. This run must not revert or clean unrelated work.

## Constraints

- Traditional Chinese response by default.
- Repo-local `AGENTS.md` is source of truth.
- Do not commit, push, publish, deploy, delete, or modify secrets.
- Keep diffs minimal and reversible.
- Use Superpowers planning for the implementation path.
- Use native subagents for bounded read-only packet analysis where useful.
- Do not claim full remote Level 5 unless branch protection/ruleset state is verified.

## Risk level

Medium. This touches GitHub workflow/governance files and scripts, but not runtime service code.

## Approval gates

No approval required for safe local file edits and static checks.

Approval would be required for GitHub branch protection changes, publishing, deployment, deletion, force operations, or broad codemods. None are in scope.

## Mode

Delegated mode. The user explicitly invoked `$ultracode`; native Codex subagents are available and useful for read-only cross-checks.

## Work packets

- `01-checklist-rescore`: compare current repo evidence against the downloaded checklist and rubric.
- `02-docs-plans-requirements`: summarize `docs/plans` as requirements and extract governance implications.
- `03-level4-ci-gap`: inspect current CI/test/lint/smoke automation and propose minimal Level 4 artifacts.
- `04-level5-agent-governance-gap`: inspect issue/PR/agent governance and propose minimal Level 5 artifacts.
- `05-implementation-review`: after local edits, review whether implemented artifacts match requirements.

## Integration policy

Accept only evidence backed by files, commands, or explicit checklist/spec text. Prefer conservative scoring when local repo artifacts do not prove remote enforcement.

## Verification plan

- Validate JSON/YAML-like files can be parsed or are structurally sane where practical.
- Run PowerShell syntax checks for new scripts.
- Run targeted tests for new governance script behavior.
- Run `git diff --check` on edited files.
- Do not run full deployment, GPU/Kit, browser E2E, or remote GitHub mutations.

## Completion criteria

- Updated `integration.md`, `final-report.md`, and `state.json`.
- Created/updated Superpowers plan and repo-local governance artifacts.
- Final response includes score, changed files, verification, skipped checks, risks, and remaining remote-only steps.
