## ADDED Requirements

### Requirement: Fabric activation shall be record-gated

The Fabric SHALL treat an activation record as the only evidence that advances its live review and delivery authority. The record SHALL contain, in order, `phase`, `base_sha`, `policy_digest`, `writer_cap`, `external_check_name`, `external_app_id`, and `activated_at`. These fields are identifiers and evidence metadata only; no credential, token, or mutable delivery authority may be stored in the record.

`writer_cap` on the activation record describes review and `direct_stack` authority only. Session admission SHALL NOT use writer count as a blocker. Until an activation record is validated, the `direct_stack` path SHALL be `HELD` and the existing counted review SHALL remain live.

#### Scenario: An inactive record cannot open direct_stack

- **WHEN** a plan lacks a validated activation record for its exact base and policy digest
- **THEN** disjoint session writers with independent branch, worktree, and touch-set may be admitted, and every `direct_stack` request is `HELD`

### Requirement: Session admission shall isolate by branch, worktree, and touch-set

The Fabric SHALL admit any number of writer sessions that each declare an independent sibling worktree, an independent branch other than `main` or `master`, and an explicit touch-set. Occupied writer-seat count SHALL NOT queue or hold admission.

Same-branch requests SHALL be `QUEUED_FOR_LEASE` with reason `BRANCH_CONTENTION`. Overlapping touch-sets SHALL be `QUEUED_FOR_LEASE` with reason `RESOURCE_CONFLICT`. Unknown overlap SHALL be `QUEUED_FOR_LEASE` with reason `SCOPE_OVERLAP_UNKNOWN`. `.agents/board` coordinates perception only and SHALL NOT authorize writes, approval, or merge.

#### Scenario: A third disjoint writer is admitted

- **WHEN** two writers already occupy leases with disjoint branches, worktrees, and touch-sets
- **THEN** a third writer with a disjoint branch, worktree, and touch-set is `ADMITTED`

#### Scenario: Same-branch writers cannot proceed in parallel

- **WHEN** an admitted lease still holds a branch and a second request uses that same branch
- **THEN** admission returns `QUEUED_FOR_LEASE` with reason `BRANCH_CONTENTION`

### Requirement: Review activation phases shall be closed and one-way

The only accepted phase enum is exactly `LEGACY_GUARDED -> SHADOW_DUAL -> CUTOVER_ARMED -> CANARY_ACTIVE -> AUTONOMOUS_ACTIVE`. Aliases, case variants, unknown values, skipped phases, and regressions SHALL be rejected. Queue, trust-root, and policy fixtures SHALL reject these invalid values before they can produce a delivery decision.

The migration SHALL be add-before-remove: a source-pinned external CheckRun must be observed active for the exact repository, app ID, check name, base SHA, and policy digest before the prior counted review can be retired. Cutover also requires an external-settings lease, an immutable rollback snapshot, and a post-change re-read of the external configuration. `CANARY_ACTIVE` is disposable evidence only; only a succeeding one-way transition may reach `AUTONOMOUS_ACTIVE`.

#### Scenario: A review alias is submitted

- **WHEN** a queue input uses `CANARY`, `ACTIVE`, or any value other than the closed enum
- **THEN** the policy fixture rejects it and the delivery remains `HELD`

### Requirement: Phase 0 shall preserve historical governance evidence

The historical lifecycle ledger is byte-frozen. Future fixpoint and reconciliation closure work is superseded by a single ordinary protected PR with the normal exact-head, CODEOWNER, branch-protection, and required-check gates; the Fabric SHALL not create a second lifecycle or external terminal vocabulary.

#### Scenario: A closure change is proposed

- **WHEN** a future governance closure is needed
- **THEN** it uses one ordinary protected PR and leaves the historical ledger byte-identical
