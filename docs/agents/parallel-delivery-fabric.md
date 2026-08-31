# Parallel Delivery Fabric operator policy

Document version: `parallel-delivery-fabric-operator-policy/v1`

Requirement map version: `parallel-delivery-fabric-acceptance-requirements/v1`

Requirement map SHA-256: `ea2c14aa511a7ced3a95af174252ff6dbe9335b388aba3c6ead2a29ed740667d`

This is a descriptive, shadow-only operator policy. It records the approved
acceptance obligations and their authority boundaries. The local
`parallel-delivery-fabric-static-policy` gate verifies this source contract,
but neither the document nor that gate creates any runtime, remote, review,
merge, deployment, host, recovery, or activation action.

## Operating boundary

The Fabric remains shadow-only for merge, review cutover, and autonomous
promotion. Session admission is not count-capped: disjoint writers with an
independent branch, worktree, and declared touch-set are admitted. Same-branch
contention and overlapping or unknown touch-sets remain blockers. Direct
stack delivery and autonomous promotion still require an externally attested,
base-pinned activation record. This document cannot create that record or
advance a review phase.

The local CLI permits exactly `submit`, `advance`, `reconcile`, `drain`,
`release`, and `inspect`. Its default delivery status remains
`HELD_EXTERNAL_ACTIVATION`. Releasing a writer lease does not delete its
branch or worktree; task resources remain `RETAINED_FOR_REVIEW` until a
separately authorized lifecycle action. Session count is not a capacity gate.
Only a separately attested physical Kit/WebRTC resource limit may return
`WRITER_CAPACITY`.

## Activation record and review migration

Activation record tuple: `phase,base_sha,policy_digest,writer_cap,external_check_name,external_app_id,activated_at`

Closed one-way phases: `LEGACY_GUARDED -> SHADOW_DUAL -> CUTOVER_ARMED -> CANARY_ACTIVE -> AUTONOMOUS_ACTIVE`

CheckRun source pins: `repository,app_id,check_name,base_sha,policy_digest`

Migration prerequisites: `settings_lease,rollback_snapshot,post_change_authoritative_reread,add_before_remove,disposable_canary_delivered`

Distinct authority roles: `machine_check_app,promotion_executor,delivery_executor`

The record is evidence metadata, never a credential or candidate-issued
authority. The exact repository/App/check/base/policy CheckRun tuple, an
external settings lease, immutable rollback snapshot, authoritative post-change
reread, and add-before-remove sequence are all required before the legacy gate
can change. Aliases, skipped or regressed phases, and local phase changes have
no authority. Any missing prerequisite means no authority.

The machine-check App, promotion executor, and delivery executor must not be combined.
AC-34 remains indirectly carried by Task11B's source-pinned approval-equivalent check.

CANARY_ACTIVE admits only disposable canary evidence and remains non-terminal; it is not final authority.
Only disposable_canary_delivered=true permits the next one-way transition to AUTONOMOUS_ACTIVE and removal of the legacy gate. Missing or false disposable canary evidence must not cut over.

The requirement map is normative-only, not a result ledger. Every row has the
same closed fields: AC identifier, semantic label, required gate kinds, source
authority, local-or-external evidence origin, side-effect class, activation
requirement, and authority dependencies. It contains no candidate result,
completion state, passing assertion, or activation claim. A candidate cannot
fill a status, select an authority, or reinterpret the required gates.

The existing standalone evidence reducer is deliberately safe-closed: even a
well-formed candidate/context pair can reach only advisory eligibility held for
`TRUSTED_CONTEXT_AUTHORITY_REQUIRED`. It has no standalone `COMPLETE` path.
Only a later prior-base-owned authority wrapper may decide whether to consume
that advisory result.

## Evidence and authority rules

AC-01, AC-03, AC-08, and AC-22 are external-evidence obligations. Local
fixtures and source inspection can test contract boundaries, but they cannot
prove the external canary, actual execution context, or per-head interaction.

For a user-facing or runtime-required candidate, AC-22 requires both canonical
Playwright evidence and independent Computer Use evidence bound to the same
exact head and manifest. Neither verifier may substitute for the other.

AC-10 names the runtime-capacity authority as a dependency; a local capacity
simulation is not authority to allocate a real third runtime seat. AC-24 names
the runtime-preflight authority and remains **AC-24 HELD** until the required
authority can provide its independent record. The HELD label here is an
operator boundary, not a candidate-controlled map result.

Task9 D2 owns the external promotion/activation handoff for AC-13, AC-14,
AC-25, AC-32 through AC-35, AC-38, and AC-42. The post-merge Task11B work
owns source-pinned review-migration activation for AC-14, AC-33, AC-34,
AC-36, and AC-38, while preserving add-before-remove semantics. Their exact
overlap is AC-14, AC-33, AC-34, and AC-38. No local test, mock, or
documentation change may cross either boundary.

## Non-actions and recovery limits

Do not use `safe.directory`, alter ACLs, change ownership, scan or terminate
processes, prune worktrees, or perform cleanup to resolve an uncertain context
or a held gate. Unknown, stale, mismatched, or unavailable evidence stays held.

Retention is non-destructive: task resources remain available for review when
a writer seat is safely released. A real rollback is externally governed and
must restore the prior required gate before any newer gate is disabled. This
policy creates neither a rollback record nor a recovery command.

## Two known Node RED observations

These are implementation observations, not acceptance results and not proof of
the target state:

- `test-admission.mjs:665` expects `QUEUED_FOR_LEASE` and observed
  `HELD_SCOPE_CONFLICT`.
- `test-promotion-bridge.mjs:1373` expects `MERGED_NOT_DELIVERED` and observed
  `PREMERGE_EVIDENCE_INVALID`.

They remain visible so an operator does not treat a broad test invocation as a
clean readiness signal. The normative map must not be altered to mask either
RED observation.

## Change control

The map digest is pinned by the isolated static policy test. A map edit is a
normative contract edit: update the exact test expectation and this document
together, then obtain a new review. It must never be revised to turn the
current dirty HEAD into a pass claim.
