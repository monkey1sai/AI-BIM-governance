# Change: Establish the Parallel Delivery Fabric activation boundary

## Why

The approved Parallel Delivery Fabric design is a target state, while merge, `direct_stack`, and counted-review retirement remain activation-gated. A single canonical OpenSpec change is needed so that no design document, queue adapter, or review migration can silently activate delivery authority. Session writers are isolated by independent branch, worktree, and touch-set; writer count is not an admission blocker.

## What Changes

- Define a non-secret activation record that is the only source of authority for review-cutover and `direct_stack` advancement.
- Admit any number of disjoint session writers; hold `direct_stack` and retain the counted review until the record proves the external CheckRun is active.
- Define the one-way review phases, source-pinned add-before-remove migration, and rejected aliases that future queue and trust-root implementations must enforce.
- Reconcile the legacy autonomous-delivery delta with the Lean single-PR closure policy without changing its historical lifecycle ledger.

## Impact

- Affects governance/OpenSpec contracts, session admission, and their deterministic tests; it does not enable GitHub mutations, autonomous merge, or deployment.
