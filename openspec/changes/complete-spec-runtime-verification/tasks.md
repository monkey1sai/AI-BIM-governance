## 1. Evidence Baseline

- [ ] 1.1 Re-read `docs/verification/2026-05-08-spec-end-to-end-verification.md` and confirm the current unresolved items still match this change scope.
- [ ] 1.2 Re-read `docs/contracts/local-dev-runbook.md` and confirm the smoke check list includes `bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1`.
- [ ] 1.3 Record the active machine constraints: GPU availability, Kit SDK availability, available Kit signaling ports, and whether a valid geometry IFC / USD fixture is present.

## 2. Non-GPU Stage Loading Contract

- [ ] 2.1 Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\bim-streaming-server\scripts\tests\test-stage-loading-contract.ps1`.
- [ ] 2.2 If the contract smoke passes, update the verification report so `bim-streaming-server` stage-loading contract is marked as verified at the `contract` tier.
- [ ] 2.3 If the contract smoke fails, capture the failing token / assertion and keep the verification report marked as failed instead of hardware-blocked.

## 3. Single Kit GPU Render Evidence

- [ ] 3.1 Select or create a valid geometry fixture; do not use the header-only `storage/sample.ifc` smoke fixture as render evidence.
- [ ] 3.2 Run the `_worker -> _bim-control -> bim-review-coordinator -> web-viewer-sample -> bim-streaming-server` flow with the valid fixture.
- [ ] 3.3 Capture `review_request_id`, `session_id`, artifact URLs, video readiness, non-zero video dimensions, `openedStageResult`, and viewport screenshot evidence.
- [ ] 3.4 Update the verification report with `passed`, `blocked`, or `failed` for single Kit GPU render, including exact prerequisites when blocked.

## 4. Dedicated Multi-Kit Routing Evidence

- [ ] 4.1 Confirm whether two or more Kit instances can be launched with distinct signaling ports.
- [ ] 4.2 If multi Kit topology is unavailable, record `blocked` with the missing topology requirement and do not treat `0xC0F22219` on a single `local_fixed` instance as a routing failure.
- [ ] 4.3 If multi Kit topology is available, create a `dedicated_instance` review session and confirm distinct `kit_instance_bindings[]` and stream configs.
- [ ] 4.4 Validate concurrent browser readiness and Socket.IO collaboration continuity across the shared `session_id`.

## 5. Stress Evidence

- [ ] 5.1 Define the large IFC stress fixture size and acceptance threshold before running the test.
- [ ] 5.2 Run large IFC conversion / readiness verification and record conversion duration, readiness transitions, status, and viewer behavior while `processing`.
- [ ] 5.3 Define the Socket.IO concurrency client count and acceptance threshold before running the test.
- [ ] 5.4 Run Socket.IO concurrency stress and record client count, event types, broadcast success criteria, failures, and coordinator health.

## 6. Validation And Review

- [ ] 6.1 Run `openspec validate complete-spec-runtime-verification`.
- [ ] 6.2 Confirm `git diff` only contains this OpenSpec change and intentional verification report updates.
- [ ] 6.3 Before commit, run GitNexus detect changes or document why it is unavailable for this docs-only OpenSpec change.
- [ ] 6.4 Commit and push the branch `codex/openspec/complete-spec-runtime-verification`.
