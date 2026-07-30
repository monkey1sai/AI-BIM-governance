# Tasks: Introduce Executable Architecture Contracts

## Phase 1 — Desired architecture and canonical validation

- [x] 1.1 Add `architecture/architecture-contract.json` with service, browser, data residency, readiness, invariant, delta, and exception contracts.
- [x] 1.2 Add Draft-07 JSON Schemas for architecture contract and architecture delta.
- [x] 1.3 Add the change's own `architecture/deltas/introduce-executable-architecture-contracts.json`.
- [x] 1.4 Implement standard-library semantic validation for cross-object constraints.
- [x] 1.5 Add fail-closed unit/contract tests for canonical success and negative cases.
- [x] 1.6 Wire architecture paths into the existing verification manifest's root-contract, agent-governance, and security dispatch.
- [x] 1.7 Document source-of-truth positioning, agent workflow, exceptions, and ratchet rollout.

## Phase 1 closeout still required in the real checkout

- [x] 1.8 Run `openspec validate introduce-executable-architecture-contracts --strict`.
- [ ] 1.9 Run canonical `scripts/verify-all` planning and affected gates in the real Windows checkout.
- [ ] 1.10 Run GitNexus `detect-changes --scope compare --base-ref main` and record the result.
- [x] 1.11 Independent architecture review confirms the contract preserves current repo boundaries and does not over-claim observed conformance.

### Closeout evidence — 2026-07-30

- 1.8 passed change-specific strict validation; `openspec validate --all --strict` also passed 71 items with 0 failures.
- 1.9 remains open: `verify-all -PlanOnly` selected root contracts, agent governance, and secret/security gates; root contracts passed 181 tests and both secret/security checks passed, but the canonical run failed on pre-existing agent-skill integrity drift outside this change.
- 1.10 remains open: the command ran with the current checkout selected explicitly, but the index was stale and untracked payload files were not mapped; `No changes detected` is advisory, not an accepted gate pass.
- 1.11 passed independent review after schema-instance enforcement was added and its missing-required/additional-property counterexamples were proven fail-closed.

## Phase 2 — Observed architecture ratchet

- [ ] 2.1 Export service/module dependency observations from GitNexus into a deterministic report.
- [ ] 2.2 Compare desired, intended, and observed dependency edges.
- [ ] 2.3 Establish an approved baseline for existing cycles and forbidden edges.
- [ ] 2.4 Fail on any new dependency edge not declared by contract + delta.
- [ ] 2.5 Fail on any increase in cycle count or baseline violations.

## Phase 3 — Language-specific structural contracts

- [ ] 3.1 Add TypeScript dependency-cruiser rules for UI/application/client/domain boundaries.
- [ ] 3.2 Add Python Import Linter contracts for API/application/domain/infrastructure layers.
- [ ] 3.3 Route the new structural checks through `verification-manifest.json`.

## Phase 4 — Executable lifecycle contracts

- [ ] 4.1 Define `review-session` state machine.
- [ ] 4.2 Define `endpoint-lease` state machine.
- [ ] 4.3 Define `stage-binding` state machine.
- [ ] 4.4 Add model-based tests for forbidden shortcuts and evidence-gated transitions.

## Phase 5 — Continuous architecture learning

- [ ] 5.1 Classify recurring `$improve-codebase-architecture` findings.
- [ ] 5.2 Promote recurring findings to invariants, validators, or structural tests.
- [ ] 5.3 Publish architecture quality grade and baseline trend without auto-merging repairs.
