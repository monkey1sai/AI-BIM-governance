# Orchestration

## Parent critical path

The parent session owns the final maturity score, conflict resolution, and final answer.

## Packets

- `01-docs-runtime-baseline`: read-only docs/runbook/script maturity.
- `02-ci-automation-baseline`: read-only CI/test/lint/smoke automation maturity.
- `03-agent-pr-governance`: read-only Level 5 agent/issue/PR governance maturity.

## Delegation

Use Codex native explorer agents. All packets are read-only.

## Agents

- Explorer A: `01-docs-runtime-baseline`.
- Explorer B: `02-ci-automation-baseline`.
- Explorer C: `03-agent-pr-governance`.

## Wait points

Wait after parent performs basic repo inspection. Then integrate all three packet results.

## Fallback

If native delegation fails, execute the packets in the parent session and mark `native_agent_used=false` in `state.json`.

## Verification order

1. Confirm current branch and working tree.
2. Inspect source-of-truth docs and workflow files.
3. Integrate packet findings.
4. Write `integration.md` and `final-report.md`.
5. Reply with score, gaps, and recommended next actions.
