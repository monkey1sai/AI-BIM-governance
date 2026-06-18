# Packet 03-agent-pr-governance: Agent and PR Governance

## Objective

Assess whether the repo satisfies Level 5: agent-readable issue/workflow, agent can modify code, run tests, and open PRs.

## Context

The audit is read-only. The parent session will integrate the final score.

## Sources

- `AGENTS.md`
- `docs/agents/github-workflow.md`
- `docs/agents/gitnexus-usage.md`
- `.claude/workflows/*`
- `scripts/pr-review-agent.ps1`
- `docs/PR_REVIEW_AGENT.md` if present
- `docs/superpowers/`, `.superpowers/`, `.codex/skills/`
- `.github/workflows/*`
- Any issue templates / PR templates under `.github/`

## Ownership

Read-only. Do not edit files.

## Do

- Find evidence for agent-readable issue/plan workflow.
- Find evidence for automatic review agents, PR creation/ship workflow, GitNexus/gstack gates.
- Distinguish "agent can do it if instructed" from "repo has reliable automation that makes it repeatable."
- Identify blockers to calling this fully Level 5.
- Cite paths and line numbers when possible.

## Do not

- Edit files.
- Open PRs.
- Commit, push, publish, or deploy.

## Expected output

- Summary
- Evidence
- Risks
- Recommended parent action

## Verification

Use file inspection and grep only.

## Handoff format

Markdown summary under headings: `Summary`, `Evidence`, `Risks`, `Recommendation`.
