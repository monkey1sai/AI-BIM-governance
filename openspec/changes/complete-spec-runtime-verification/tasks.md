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
- [x] 3.3 Record blocked evidence when render prerequisites are unavailable, including fixture identity, worker artifact type, Kit listener state, and missing browser visual proof.
- [x] 3.4 Capture successful single Kit GPU evidence: `review_request_id`, `session_id`, artifact URLs, video readiness, non-zero video dimensions, `openedStageResult` or equivalent stage success, and archived viewport screenshot for a renderable USD / USDC loaded through the current service chain.
- [x] 3.5 Update the verification report with `passed`, `blocked`, or `failed` for single Kit GPU render, including exact prerequisites when blocked.

Status updated after same-Kit runtime re-verification: current `_worker` IFC conversion still emits placeholder `model.usdc`, so this is not claimed as real IFC geometry conversion. The runtime pass uses a worker-hosted known renderable USDC fixture at `http://127.0.0.1:8005/objects/runtime-e2e/2026-05-08/library_2026.usdc` (SHA256 `60DA4E7BB458A053E3642389420903C8D8715E87957D1C018C7FB4B36A60F4A9`). For `review_session_b2d84c44ae31`, primary browser evidence reached `readyState=4`, `videoWidth=1920`, `videoHeight=1080`, `srcObject=true`, `bodyHasDataChannelReply=true`, `bodyHasMakePickableResponse=true`, and `bodyHasWaitingText=false`; screenshot evidence is archived under `docs/verification/evidence/2026-05-08-runtime-e2e/`.

## 4. Same-Kit Concurrent Stream Evidence

- [x] 4.1 Confirm the correct Kit concurrency model for this stage: one Kit process exposing `primaryStream` plus indexed `spectatorStream[]`, rather than two logical bindings pointed at the same primary stream.
- [x] 4.2 Record dedicated multi-Kit process routing as deferred capacity-tier work and do not treat `0xC0F22219` on a single primary stream as a same-Kit spectator failure.
- [x] 4.3 Update startup / browser verification helpers so one Kit process can expose distinct primary and spectator WebRTC ports.
- [x] 4.4 Validate successful same-Kit concurrent runtime with primary and spectator stream configs, two concurrent browser pages, primary DataChannel stage-load success, spectator video readiness, one archived screenshot per stream role, and Socket.IO collaboration continuity across the shared `session_id`.

Status passed after re-scoping and live E2E: the original probe found a false multi-Kit binding (`kit_local_001` / `kit_local_002` both on `127.0.0.1:49100`). NVIDIA's current Kit stream model supports same-process primary and spectator streams, so this stage validates one GPU-backed Kit process with primary `49100` / `47998` and spectator `49110` / `48008`. The run for `review_session_b2d84c44ae31` opened two browser contexts on the same session, recorded both participants through coordinator, captured primary DataChannel / stage evidence, captured spectator video readiness, and archived screenshots for both stream roles.

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
