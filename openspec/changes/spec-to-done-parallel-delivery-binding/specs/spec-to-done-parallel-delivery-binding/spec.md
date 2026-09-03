## ADDED Requirements

### Requirement: Repo session admission shall not impose a writer-count limit

Parallel Delivery Fabric SHALL admit any number of writer sessions when each session uses an independent branch and sibling worktree and no branch/worktree/scope conflict is detected. `requested_capacity.writers` SHALL describe only a plan-local execution request, activation-record `writer_cap` SHALL describe only review／`direct_stack` authority, and neither field SHALL be used as a repo session-admission cap.

#### Scenario: A third isolated writer starts

- **WHEN** two writer sessions are active and a third session presents an independent branch, sibling worktree, and non-conflicting scope
- **THEN** the third session is admitted without inspecting occupied writer count as a blocker

### Requirement: Each Fabric-managed spec-to-done run shall bind one delivery slice

A Fabric-managed `spec-to-done` run SHALL bind exactly one `plan_id`, `generation`, `task_id`, `lease_id`, `owner_session`, provider, `scope_digest`, `baseline_sha`, branch, and worktree identity. The run SHALL have exactly one writer within that binding, while other independent bindings MAY execute concurrently.

#### Scenario: Two independent spec-to-done slices execute concurrently

- **WHEN** Fabric admits two tasks with distinct bindings and isolated branches/worktrees
- **THEN** each task runs its own single-writer `spec-to-done` lifecycle without imposing a repo-wide writer cap

#### Scenario: A binding tuple drifts

- **WHEN** any plan, generation, task, lease, scope, baseline, branch, or worktree identity differs from the binding packet
- **THEN** the run is rejected fail closed and SHALL NOT substitute a new tuple

### Requirement: Fabric-managed state shall have a unique binding-derived identity

The system SHALL derive a lowercase SHA-256 `binding_id` from the canonical immutable binding tuple and SHALL store the binding packet at `artifacts/spec-to-done/bindings/{binding_id}.json`. Its durable state SHALL use `artifacts/spec-to-done/{slug}--{binding_id}-state.md`, and every managed checkpoint SHALL preserve the same `fabricBindingId`.

Standalone runs without a Fabric binding SHALL remain valid at the legacy `artifacts/spec-to-done/{slug}-state.md` path.

#### Scenario: Parallel tasks reuse the same slug

- **WHEN** two Fabric tasks use the same spec slug but have different task or lease identities
- **THEN** their different binding digests produce different state paths and neither state can overwrite the other

#### Scenario: A legacy standalone state is validated

- **WHEN** a pre-binding standalone state contains no Fabric binding fields and uses the legacy canonical path
- **THEN** the validator applies the existing standalone contract without fabricating a Fabric lease

### Requirement: Allowed paths shall remain inside the Fabric touch-set

Every Fabric-managed run SHALL declare canonical, unique repo-relative `allowed_paths` that preserve case-sensitive Git path identity. The binding validator SHALL prove every allowed path is covered by the selected Fabric task's path, glob, or rename resources. The state validator SHALL prove every committed path from the bound `baseline_sha` through the bound current HEAD is exactly present in `allowed_paths`, including both endpoints of a rename. Missing, ambiguous, shared-only, uncovered, or out-of-scope committed path authority SHALL return `scope_drift`; the workflow SHALL NOT expand the touch-set automatically.

#### Scenario: An implementation path is outside the task scope

- **WHEN** `allowed_paths` contains a path not covered by the bound task scope
- **THEN** binding validation returns `scope_drift` before P3 and no file is modified

#### Scenario: A committed path exceeds the binding touch-set

- **WHEN** the NUL-delimited committed diff from the bound baseline through the bound current HEAD contains a path not exactly present in `allowed_paths`
- **THEN** state validation returns `scope_drift` and the run cannot progress

#### Scenario: Scope authority is not path-resolvable

- **WHEN** the task declares only a shared contract or symbol and provides no explicit path/glob/rename resource for an allowed file
- **THEN** the path is treated as unproven and the run remains HELD

### Requirement: HELD shall retain the Fabric lease and local resume shall fail closed

When a Fabric-managed `spec-to-done` run becomes HELD, it SHALL stop only that delivery slice, retain the bound lease, and request Fabric to represent the execution context as `SUSPECT`. It SHALL NOT call release, reclaim, create a replacement lease, or use `NEW_RUN@P0` to move the run to another worktree.

A managed `RESUMED` checkpoint SHALL require Fabric-verified `RESUME_INTENT` and an authority-bound replacement execution context with the exact plan/task/lease/scope/branch/worktree/head tuple. Until that authority exists, validation SHALL return a durable execution-authority hold.

#### Scenario: A managed run is held

- **WHEN** any P0–P6 gate returns HELD for a Fabric-managed run
- **THEN** the run stops, its lease is retained or marked `SUSPECT`, and no local release or replacement is performed

#### Scenario: A session tries to resume locally

- **WHEN** a managed state appends `RESUMED` without Fabric-verified rebind authority
- **THEN** validation rejects the transition with a durable execution-authority hold and does not start another implementer

### Requirement: Binding evidence shall not grant delivery authority

The binding packet SHALL be non-secret control metadata and SHALL NOT authorize push, approve, merge, deploy, process termination, branch-protection mutation, review migration, or `direct_stack`. Those operations SHALL remain subject to their existing activation and external authority gates.

#### Scenario: A valid binding requests direct_stack

- **WHEN** a binding packet is structurally valid but no canonical Fabric activation record authorizes `direct_stack`
- **THEN** `direct_stack` remains HELD and the binding can authorize only the bounded local delivery slice
