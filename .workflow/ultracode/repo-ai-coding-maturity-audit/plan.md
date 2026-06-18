# Repo AI Coding Maturity Audit

## Goal

Assess this repo's AI coding governance maturity against the user's Level 1-5 rubric:

- Level 1: code exists, manual operation only.
- Level 2: README, deploy commands, basic environment notes.
- Level 3: runbook, DryRun, health checks, fake/contract tests.
- Level 4: CI/CD plus lint/type/test/smoke automation.
- Level 5: agents can read issues, change code, run tests, and open PRs.

## Success criteria

- Give one conservative current level and explain why.
- Identify evidence for each achieved level.
- Identify missing pieces for the next level.
- Cross-check via multiple independent read-only packets.
- Avoid changing product code or making claims not backed by files.

## Current context

Current branch: `codex/rewrite-readme-entrypoint`.

The repo already has a rewritten root README in the working tree. This audit must not commit, push, deploy, or modify product runtime files.

## Constraints

- Traditional Chinese response by default.
- Repo-local `AGENTS.md` is source of truth.
- Read-only audit except Ultracode workflow artifacts.
- Do not touch secrets or real `.env` values.
- Do not run destructive commands.
- Do not claim full E2E or deployment health unless verified.

## Risk level

Low. This is an audit and documentation/governance analysis.

## Approval gates

No approval required for read-only inspection and local workflow artifacts.

Approval would be required for committing, pushing, publishing, deleting, or deploying. None are in scope.

## Mode

Delegated mode. The user explicitly invoked `$ultracode` and requested multi-agent cross adversarial verification.

## Work packets

- `01-docs-runtime-baseline`: check Level 1-3 evidence in README, AGENTS, docs, runbooks, scripts.
- `02-ci-automation-baseline`: check Level 4 evidence in workflows, scripts, package manifests, test commands.
- `03-agent-pr-governance`: check Level 5 evidence in issue/PR/agent workflows, review agents, ship-cycle docs, Codex/GitNexus/gstack governance.

## Integration policy

Accept claims only when backed by file paths or command evidence. If packets disagree, prefer the more conservative score unless the stronger claim has better evidence.

## Verification plan

- Inspect root and workflow files.
- Run cheap static checks only: file existence, grep, status, and command discovery.
- Use current dry-run/test evidence from this session where relevant.

## Completion criteria

Produce a concise maturity score, missing-gap list, and next-step roadmap.
