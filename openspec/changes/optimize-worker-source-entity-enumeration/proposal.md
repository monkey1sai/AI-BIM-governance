## Why

Canonical `storage/*.ifc` batch verification currently times out on the first 89MB fixture after `ifc_open`, with the last known phase stuck at `source_entity_enumeration`. This blocks single-fixture evidence, visual preview, and the full 13-file baseline lock even though timeout diagnostics are now recorded.

## What Changes

- Optimize `_worker` IFC source entity enumeration so canonical fixtures can progress past the current bottleneck without weakening all-IFC-entity coverage semantics.
- Add measurable before/after timing evidence for `source_entity_enumeration`, including entity counts, elapsed duration, and timeout/budget diagnostics.
- Preserve existing artifact intake, conversion job, lineage, mapping, and review viewer handoff contracts.
- Keep `minimum_coverage_locked=false` unless the full canonical batch still satisfies the archived baseline requirements.
- Do not introduce viewer, coordinator, Kit runtime, WebRTC, GPU, auth, session lifecycle, or production batch-job responsibilities into `_worker`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `worker-artifact-pipeline`: require `_worker` source entity enumeration to be profiled and optimized for canonical IFC fixtures while preserving all-entity coverage and stable IFC-to-USD traceability.
- `runtime-verification-evidence`: require optimization evidence to record before/after source entity enumeration timing and the canonical single-fixture rerun result.

## Impact

- Owner: `_worker`.
- Likely code paths: `_worker/app/converters.py`, `_worker/app/batch_verification.py`, and focused `_worker/tests/*`.
- Data structures: conversion quality metrics and batch verification evidence may gain source entity enumeration diagnostics; existing fields must remain backward-compatible.
- CLI: `scripts/verify_storage_batch.py` may be used for validation; no required CLI breaking change is expected.
- Dependencies: no new production dependency unless a measured standard-library or existing IfcOpenShell/USD path cannot solve the bottleneck.
- Runtime boundary: visual preview remains outside `_worker` and must continue through `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` after conversion succeeds.
