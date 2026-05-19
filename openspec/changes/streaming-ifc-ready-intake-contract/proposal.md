## Why

`bim-streaming-server` already hosts `POST /api/conversions/ifc-to-usdc` and accepts an `ifc_ready`-shaped request produced by `bim-review-coordinator`, but the internal contract does not yet make service auth, idempotency replay/conflict behavior, and 4xx rejection cases explicit. This slice formalizes that existing streaming-side handoff without expanding streaming into the official external IFC-ready entry point.

## What Changes

- Add streaming-side contract tests for auth, idempotency, and request rejection around `POST /api/conversions/ifc-to-usdc`.
- Add optional service-token enforcement for the internal coordinator -> streaming request path.
- Make idempotency explicit by accepting `idempotency_key`, falling back to `event_id`, returning the existing job for compatible retries, and rejecting conflicting reuse.
- Document verification evidence for the streaming-only slice.
- Non-goal: do not modify `_worker` or `_bim-control` product logic; do not move the official external intake away from `bim-review-coordinator`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `streaming-ifc-usdc-conversion-authority`: clarify the internal conversion API contract for service auth, idempotency, and 4xx request outcomes.

## Impact

- Code: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py`
- Tests: `bim-streaming-server/tests/test_conversion_authority_api.py`
- Docs/evidence: `docs/verification/2026-05-19-streaming-ifc-ready-intake-contract.md`
- API: `POST /api/conversions/ifc-to-usdc` gains optional internal service-token enforcement when configured; default unset token preserves current local test behavior.
- Data structure: conversion jobs record `idempotency_key` and a request fingerprint to guard duplicate retries.
- Dependencies: none.
