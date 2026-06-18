# Packet 02-ci-automation-baseline: CI and Automation Baseline

## Objective

Assess whether the repo satisfies Level 4: CI/CD plus lint/type/test/smoke automation.

## Context

The audit is read-only. The parent session will integrate the final score.

## Sources

- `.github/workflows/*`
- `package.json` files
- `requirements.txt` files
- `scripts/verify-all.ps1`
- `scripts/tests/*.ps1`
- `docs/agents/sub-repo-verify-commands.md`
- `docs/agents/github-workflow.md`
- `docs/runbooks/*.md`

## Ownership

Read-only. Do not edit files.

## Do

- Identify actual CI workflow files and whether they run meaningful lint/type/test/smoke checks.
- Identify local automation scripts that could support Level 4 even if CI is incomplete.
- Distinguish "documented commands exist" from "CI actually enforces them."
- Cite evidence with paths and line numbers when possible.

## Do not

- Edit files.
- Run long test suites.
- Treat documented intent as CI enforcement without workflow evidence.

## Expected output

- Summary
- Evidence
- Risks
- Recommended parent action

## Verification

Use file inspection and grep only.

## Handoff format

Markdown summary under headings: `Summary`, `Evidence`, `Risks`, `Recommendation`.
