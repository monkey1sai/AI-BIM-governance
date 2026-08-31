# Change: Establish the Parallel Delivery Fabric activation boundary

## Why

The approved Parallel Delivery Fabric design is a target state, while the repository's live governance remains one writer and counted review. A single canonical OpenSpec change is needed so that no design document, queue adapter, or review migration can silently activate that target state.

## What Changes

- Define a non-secret activation record that is the only source of authority for writer-cap and autonomous-review advancement.
- Keep the live path at `writer_cap=1`, hold `direct_stack`, and retain the counted review until the record proves the external CheckRun is active.
- Define the one-way review phases, source-pinned add-before-remove migration, and rejected aliases that future queue and trust-root implementations must enforce.
- Reconcile the legacy autonomous-delivery delta with the Lean single-PR closure policy without changing its historical lifecycle ledger.

## Impact

- Affects governance/OpenSpec contracts and their deterministic tests only in Phase 0; it does not enable GitHub mutations, autonomous merge, deployment, or a second live writer.
