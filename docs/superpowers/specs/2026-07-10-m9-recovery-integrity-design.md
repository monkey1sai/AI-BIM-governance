# M9 Recovery Integrity Design

日期：2026-07-10
性質：spec design
狀態：implemented and locally verified

## Problem

Maintenance Apply stores `.snapshot-*` inside the same `CodexHome` later used
as the recovery target. The previous recovery cleanup deleted that snapshot
before restore, so Recover could not prove or restore the pre-Apply tree.

## Required behavior

- Apply records the exact snapshot tree hash in both `applying` and `staged`
  journal states.
- Recover validates the recorded snapshot hash before mutating the live target.
- In-root snapshots are copied to a verified recovery stage before cleanup.
- Restored content is hash-verified before the journal becomes `committed`.
- A recorded hash mismatch fails closed, leaves the live target unchanged, and
  does not falsely commit the journal.
- The M9 test participates in the aggregate maintenance test discovery.

## Acceptance evidence

- Focused M9 recovery integrity test passes.
- Transaction regression test passes for the existing sibling-snapshot case.
- Aggregate maintenance harness reports `passed count 10; failed count 0`.
- PowerShell 5 rejection / PowerShell 7 harness contract passes.

Runtime behavior remains authoritative in the PowerShell implementation and
executable tests; this document records the design and acceptance intent.
