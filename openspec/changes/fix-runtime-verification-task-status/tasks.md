## 1. Re-Scope Runtime Evidence State

- [x] 1.1 Re-read `openspec/changes/complete-spec-runtime-verification/tasks.md` and identify any checked task that still reads like successful GPU render or multi-Kit runtime validation.
- [x] 1.2 Re-read `docs/verification/2026-05-08-spec-end-to-end-verification.md` section 6 and confirm the report states single Kit GPU render and dedicated multi-Kit routing as `blocked / not passed`.
- [x] 1.3 Confirm which hardware-dependent tiers remain in scope for this change: single Kit GPU render plus same-Kit primary / spectator concurrent streams; dedicated multi-Kit process routing is a deferred capacity tier unless explicitly re-scoped.
- [x] 1.4 Inspect `_worker` conversion output path and confirm whether `model.usdc` is still placeholder output or a renderable geometry artifact.
- [x] 1.5 Select a renderable USD / USDC fixture or a real conversion output that can be loaded by Kit; do not use header-only IFC or placeholder `model.usdc` as GPU render evidence.

Result: `complete-spec-runtime-verification/tasks.md` had checked GPU and multi-Kit items that could be misread as successful runtime validation. The report already said both tiers were `blocked / not passed`. `_worker/app/store.py` still writes placeholder `model.usdc`. A known renderable fixture exists in the user's main checkout at `C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\bim-models\許良宇圖書館建築_2026.usdc`, but it is not produced by the current `_worker` conversion path.

## 2. Execute Single Kit GPU Runtime Verification

- [x] 2.1 Probe and record the GPU / driver state with `nvidia-smi` or equivalent, including GPU model and driver version when available.
- [x] 2.2 Start or verify the required local services: `_bim-control`, `_worker`, `bim-review-coordinator`, `web-viewer-sample`, and GPU-backed `bim-streaming-server`.
- [x] 2.3 Verify Kit signaling / stream endpoints are reachable on the configured ports, including `49100` / `47998` when using the current local profile.
- [x] 2.4 Run the `_worker -> _bim-control -> bim-review-coordinator -> web-viewer-sample -> bim-streaming-server` path with the renderable artifact.
- [x] 2.5 Capture runtime evidence: `review_request_id` or `session_id`, artifact URLs, stream config, `openedStageResult` or equivalent stage-load success, browser video readiness, non-zero video frame dimensions, and viewport screenshot saved under a repo-local evidence path such as `docs/verification/evidence/<YYYY-MM-DD>-runtime-e2e/`.
- [x] 2.6 Update the verification report so single Kit GPU render is `passed` only when task 2.5 evidence exists; otherwise keep the tier `blocked` / `not passed` and keep the pass task unchecked.

Result: GPU probe found `NVIDIA GeForce RTX 4060 Ti`, driver `580.97`, memory `8188 MiB`. `_bim-control`, `_worker`, coordinator, viewer, and one GPU-backed Kit process were reachable. The service chain was executed with a worker-hosted copy of the known renderable `許良宇圖書館建築_2026.usdc` fixture at `http://127.0.0.1:8005/objects/runtime-e2e/2026-05-08/library_2026.usdc` (SHA256 `60DA4E7BB458A053E3642389420903C8D8715E87957D1C018C7FB4B36A60F4A9`). Runtime evidence for `review_request_samekit_20260508_173656` / `review_session_b2d84c44ae31` reached `readyState=4`, `videoWidth=1920`, `videoHeight=1080`, `srcObject=true`, `bodyHasWaitingText=false`, `bodyHasDataChannelReply=true`, and `bodyHasMakePickableResponse=true`; the primary screenshot is `docs/verification/evidence/2026-05-08-runtime-e2e/same-kit-review_session_b2d84c44ae31-kit_local_001-primary.png` with viewport crop `same-kit-review_session_b2d84c44ae31-kit_local_001-primary-viewport.png`. Single Kit GPU render is now passed for the worker-hosted renderable fixture tier; `_worker`'s IFC conversion adapter remains placeholder and is not claimed as real IFC geometry conversion.

## 3. Execute Same-Kit Concurrent Stream Runtime Verification

- [x] 3.1 Inspect NVIDIA Kit / livestream settings and confirm that same-process concurrency should use `primaryStream` plus indexed `spectatorStream[]`, not two logical `kit_instance_id` values pointing at the same primary stream.
- [x] 3.2 Launch or verify one GPU-backed Kit process with distinct primary and spectator WebRTC ports, then record the primary / spectator stream configs.
- [x] 3.3 Run two concurrent browser sessions against the same `session_id`: primary must prove DataChannel stage-load success, spectator must prove video readiness from the same Kit stage, Socket.IO continuity, and one archived screenshot per stream role.
- [x] 3.4 Keep dedicated multi-Kit process routing as deferred capacity-tier work unless a later change explicitly requires isolated GPU runtimes.

Result: the earlier probe found the false multi-Kit defect correctly: `routing_policy=dedicated_instance` produced `kit_local_001` and `kit_local_002`, but both bindings used the same `127.0.0.1:49100` primary stream config (`distinct_stream_config_count=1`). The implementation is now re-scoped to NVIDIA's same-process stream model. The live run used one Kit process with primary `127.0.0.1:49100` / `47998` and spectator `127.0.0.1:49110` / `48008`. Two isolated Chrome contexts opened `review_session_b2d84c44ae31`; session participants included `runtime_samekit_primary` and `runtime_samekit_spectator`. Primary evidence had DataChannel / stage proof (`bodyHasDataChannelReply=true`, `bodyHasMakePickableResponse=true`) and spectator evidence had video readiness on the same session (`readyState=4`, `videoWidth=1920`, `videoHeight=1080`, `bodyHasWaitingText=false`). Screenshots are `same-kit-review_session_b2d84c44ae31-kit_local_001-primary.png` and `same-kit-review_session_b2d84c44ae31-kit_local_001_spectator_0-spectator.png`, with matching `-viewport.png` crops.

## 4. Resolve Review Findings

- [x] 4.1 Rewrite any checked GPU render task in `complete-spec-runtime-verification/tasks.md` so it remains unchecked until the single Kit GPU evidence from section 2 exists.
- [x] 4.2 Rewrite any checked multi-Kit runtime task in `complete-spec-runtime-verification/tasks.md` so it is re-scoped to same-Kit concurrent stream evidence for this stage, with dedicated multi-Kit process routing explicitly deferred.
- [x] 4.3 Update task status notes to explicitly separate completed contract / stress evidence from GPU runtime tiers that are passed, blocked, failed, or deferred.
- [x] 4.4 If the verification report lacks the live GPU execution evidence from sections 2 or 3, update the report with exact blocker facts without claiming runtime success.

Result: `complete-spec-runtime-verification/tasks.md` now marks single Kit GPU evidence and concurrent runtime evidence complete only after the live GPU run produced browser readiness, `openedStageResult`, non-zero video dimensions, and archived screenshots. The verification report includes this recheck's GPU, worker, fixture, Kit primary / spectator ports, and dedicated multi-Kit deferral facts.

## 5. Validate And Review

- [x] 5.1 Run `openspec validate fix-runtime-verification-task-status`.
- [x] 5.2 Run `openspec validate complete-spec-runtime-verification`.
- [x] 5.3 Run `openspec instructions apply --change complete-spec-runtime-verification --json` and confirm it cannot be interpreted as GPU runtime passed while the GPU evidence tasks remain incomplete.
- [x] 5.4 Run `git diff --check`.
- [x] 5.5 Run GitNexus detect changes or document why this docs-only OpenSpec update has no code symbol impact.

Result: both OpenSpec validations previously passed. After re-scoping the runtime topology, PowerShell parser checks pass for root start/stop scripts and `runtime-e2e-cdp.mjs` passes `node --check`. The live same-Kit primary / spectator E2E run completed and archived screenshots under `docs/verification/evidence/2026-05-08-runtime-e2e/`. Final validation commands were rerun after the report update.
