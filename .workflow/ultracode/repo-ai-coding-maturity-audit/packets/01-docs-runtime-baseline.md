# Packet 01-docs-runtime-baseline: Docs and Runtime Baseline

## Objective

Assess whether the repo satisfies Level 1, Level 2, and Level 3 of the user's maturity rubric.

## Context

The audit is read-only. The parent session will integrate the final score.

## Sources

- `README.md`
- `AGENTS.md`
- `docs/agents/*.md`
- `docs/contracts/local-dev-runbook.md`
- `docs/runbooks/*.md`
- `docs/demo/*.md`
- `scripts/*.ps1`
- `scripts/tests/*.ps1`

## Ownership

Read-only. Do not edit files.

## Do

- Identify evidence for code presence, README/deploy/environment docs, runbooks, DryRun, health checks, fake/contract tests.
- Cite file paths and line numbers when possible.
- State whether Level 3 is fully met, partially met, or not met.

## Do not

- Edit files.
- Run destructive commands.
- Duplicate CI/Level 5 analysis handled by other packets.

## Expected output

- Summary
- Evidence
- Risks
- Recommended parent action

## Verification

Use file inspection and grep only.

## Handoff format

Markdown summary under headings: `Summary`, `Evidence`, `Risks`, `Recommendation`.
