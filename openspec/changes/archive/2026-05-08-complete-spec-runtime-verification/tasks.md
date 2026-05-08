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
- [x] 3.2 Attempt the `_worker -> _bim-control -> bim-review-coordinator -> web-viewer-sample -> bim-streaming-server` flow with the valid fixture and record the exact pass / blocked boundary.
- [x] 3.3 Attempt to capture `review_request_id`, `session_id`, artifact URLs, video readiness, non-zero video dimensions, `openedStageResult`, and viewport screenshot evidence; if render prerequisites are unavailable, record the blocked evidence-gathering point instead of claiming GPU render success.
- [x] 3.4 Update the verification report with `passed`, `blocked`, or `failed` for single Kit GPU render, including exact prerequisites when blocked.

Status recorded as blocked after re-verification: a valid IFC fixture exists, but current `_worker` emits placeholder `model.usdc`, no Kit stream listener was present on `49100` / `47998` during review recheck, stream port `47998` was not reachable during apply, and no renderable viewport screenshot evidence was captured. Tasks 3.2 / 3.3 are complete only as blocked-evidence capture, not as successful GPU render validation.

## 4. Dedicated Multi-Kit Routing Evidence

- [x] 4.1 Plan or inspect a root `scripts/` orchestration entrypoint for launching or checking two or more Kit instances with distinct signaling ports.
- [x] 4.2 If multi Kit topology is unavailable, record `blocked` with the missing topology requirement and do not treat `0xC0F22219` on a single `local_fixed` instance as a routing failure.
- [x] 4.3 Verify whether multi Kit topology is available for a `dedicated_instance` review session; if unavailable, record the topology blocker instead of claiming distinct `kit_instance_bindings[]` runtime confirmation.
- [x] 4.4 Validate concurrent browser readiness and Socket.IO collaboration continuity across the shared `session_id` only when multiple Kit endpoints exist; otherwise record that runtime validation remains blocked.

Status recorded as blocked after re-verification: root `scripts/start-all.ps1` launches only one streaming server process, `bim-streaming-server/scripts/start-streaming-server.ps1` uses fixed `49100` / `47998` ports, and no root `scripts/` entrypoint currently launches two or more Kit instances with distinct signaling ports. Tasks 4.3 / 4.4 are complete only as topology-blocker classification, not as successful multi-Kit runtime validation.

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
