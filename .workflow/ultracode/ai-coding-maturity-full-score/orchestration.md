# Orchestration

## Parent critical path

The parent session owns the final score, the Superpowers plan, all file edits, integration, and verification.

## Packets

- `01-checklist-rescore`: read-only checklist scoring.
- `02-docs-plans-requirements`: read-only requirements extraction from `docs/plans`.
- `03-level4-ci-gap`: read-only CI gap analysis.
- `04-level5-agent-governance-gap`: read-only agent governance gap analysis.
- `05-implementation-review`: read-only review after implementation.

## Delegation

Use Codex explorer agents for independent read-only packets. Parent implements local artifacts after integrating discovery.

## Agents

- Explorer A: checklist rescore.
- Explorer B: docs/plans requirements.
- Explorer C: CI gap analysis.
- Explorer D: Level 5 governance gap analysis.

## Wait points

Wait after parent does file inventory and creates the Superpowers plan. Wait again after implementation for review if needed.

## Fallback

If delegation fails, execute packet work in the parent session and mark the packet source in `state.json`.

## Verification order

1. Read checklist and docs/plans inventory.
2. Spawn independent read-only agents.
3. Integrate findings into a Superpowers implementation plan.
4. Implement local repo artifacts.
5. Run targeted static checks and script tests.
6. Update integration and final report.
