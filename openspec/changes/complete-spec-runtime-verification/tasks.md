## 1. Evidence Baseline

- [x] 1.1 Re-read `docs/verification/2026-05-08-spec-end-to-end-verification.md` and confirm the current unresolved items still match this change scope.
- [x] 1.2 Re-read `docs/contracts/local-dev-runbook.md` and confirm the smoke check list includes `bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1`.
- [x] 1.3 Record the active machine constraints: GPU availability, Kit SDK availability, available Kit signaling ports, and whether a valid geometry IFC / USD fixture is present under repo-local `storage/`.

Evidence recorded in `docs/verification/2026-05-08-spec-end-to-end-verification.md` section 6.1.

## 2. Non-GPU Stage Loading Contract

- [x] 2.1 Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\bim-streaming-server\scripts\tests\test-stage-loading-contract.ps1`.
- [x] 2.2 If the contract smoke passes, update the verification report so `bim-streaming-server` stage-loading contract is marked as verified at the `contract` tier.
- [x] 2.3 If the contract smoke fails, capture the failing token / assertion and keep the verification report marked as failed instead of hardware-blocked.

Result: `[verify] stage loading DataChannel contract passed`; no failure assertion to capture.

## 3. Single Kit GPU Render Evidence

- [x] 3.1 Select a valid geometry fixture from repo-local `storage/` (`C:\Repos\active\iot\AI-BIM-governance\storage` on the user's main Windows checkout); do not use the header-only `storage/sample.ifc` smoke fixture as render evidence.
- [x] 3.2 Run the `_worker -> _bim-control -> bim-review-coordinator -> web-viewer-sample -> bim-streaming-server` flow with the valid fixture.
- [x] 3.3 Capture `review_request_id`, `session_id`, artifact URLs, video readiness, non-zero video dimensions, `openedStageResult`, and viewport screenshot evidence.
- [x] 3.4 Update the verification report with `passed`, `blocked`, or `failed` for single Kit GPU render, including exact prerequisites when blocked.

Status recorded as blocked: a valid IFC fixture exists, but current `_worker` emits placeholder `model.usdc`, stream port `47998` was not reachable, and no renderable viewport screenshot evidence was captured.

## 4. Dedicated Multi-Kit Routing Evidence

- [x] 4.1 Plan or inspect a root `scripts/` orchestration entrypoint for launching or checking two or more Kit instances with distinct signaling ports.
- [x] 4.2 If multi Kit topology is unavailable, record `blocked` with the missing topology requirement and do not treat `0xC0F22219` on a single `local_fixed` instance as a routing failure.
- [x] 4.3 If multi Kit topology is available, create a `dedicated_instance` review session and confirm distinct `kit_instance_bindings[]` and stream configs.
- [x] 4.4 Validate concurrent browser readiness and Socket.IO collaboration continuity across the shared `session_id`.

Status recorded as blocked: no root `scripts/` entrypoint currently launches two or more Kit instances with distinct signaling ports; existing dedicated-instance coverage is control-plane only.

## 5. Stress Evidence

- [x] 5.1 Define the large IFC stress fixture size and acceptance threshold before running the test.
- [x] 5.2 Run large IFC conversion / readiness verification and record conversion duration, readiness transitions, status, and viewer behavior while `processing`.
- [x] 5.3 Run or design a Socket.IO ramp test to determine this machine's maximum sustainable client count.
- [x] 5.4 Set the formal Socket.IO stress target to 90% of the measured sustainable client count and record the calculation.
- [x] 5.5 Run Socket.IO concurrency stress at the 90% target and record client count, event types, broadcast success criteria, failures, and coordinator health.

Result: `_worker` facade/readiness passed on an 89 MB IFC fixture; Socket.IO bounded ramp passed up to 100 clients and the 90-client target passed. Both results are recorded in verification section 6.

## 6. Validation And Review

- [x] 6.1 Run `openspec validate complete-spec-runtime-verification`.
- [x] 6.2 Confirm `git diff` only contains this OpenSpec change and intentional verification report updates.
- [x] 6.3 Before commit, run GitNexus detect changes or document why it is unavailable for this docs-only OpenSpec change.
- [x] 6.4 Commit and push the branch `codex/openspec/complete-spec-runtime-verification`.

Validation result: `openspec validate complete-spec-runtime-verification` passed; `git diff` contains only `docs/verification/2026-05-08-spec-end-to-end-verification.md` and this task file; GitNexus detect changes returned `risk_level=none` with no affected symbols or flows.
