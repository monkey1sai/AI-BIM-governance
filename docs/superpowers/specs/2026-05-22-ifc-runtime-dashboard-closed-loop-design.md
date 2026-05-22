# IFC Runtime Dashboard Closed Loop Design

## Goal

Close the demo gap between a successful IFC→USDC conversion result and a human-observable browser viewport that proves Kit loaded the correct converted artifact. The operator page at `/ui` must show IFC-ready download progress, conversion job state, review session state, Kit/WebRTC state, viewer count, and deterministic blockers.

## Current Evidence

- The user-provided 341MB IFC can be downloaded and converted through the fallback path; conversion result exposes `model.usdc` and sidecars.
- Coordinator session `review_session_761f0c316079` points to `stream_conv_20260522080140_dfa11d33/model.usdc`.
- User observation shows the browser viewport still rendering stale `許良宇圖書館建築_2026.usdc`.
- Kit log has no stage-load evidence for `stream_conv_20260522080140_dfa11d33`.
- Kit log repeatedly shows `NVST_R_BUSY, dropping frame` followed by `Client disconnected from WebRTC server`.

## Requirement Summary

The system must separate these tiers:

1. IFC-ready intake and download.
2. Internal conversion and artifact readiness.
3. Review session and viewer handoff.
4. DataChannel stage-load request.
5. Kit loaded-stage confirmation.
6. WebRTC video readiness and disconnect/reconnect behavior.

A pass in one tier must not imply a pass in another.

## Options Considered

### Option A — Patch Viewer Only

Add stricter viewer logic to force `openStageRequest` and show disconnect state.

Trade-off: This helps the visible symptom, but `/ui` still cannot explain which layer is failing.

### Option B — Dashboard First, Then Viewer Lifecycle

Add read-only coordinator runtime endpoints and redesign `/ui` to expose every tier. Then update viewer stage-load and reconnect behavior.

Trade-off: Slightly more work, but it gives operators a reliable control tower and makes Chrome E2E evidence reviewable.

### Option C — Restart Kit Per Job

Allocate a fresh Kit process for each conversion/session to avoid stale stage state.

Trade-off: This may be correct later, but it changes runtime orchestration and GPU lifecycle more broadly than this PR should.

## Recommended Design

Use Option B.

`/ui` becomes the first-place operator dashboard:

- Current/recent IFC-ready jobs with download status and paths.
- Conversion job status, model/mapping URLs, quality metrics.
- Review session id, participant count, viewer URL.
- Kit endpoint, port/listener status, last Kit/WebRTC evidence.
- Expected stage URL versus observed loaded stage URL.
- Explicit blocker labels such as `stale_stage_or_mismatch`, `webrtc_disconnected`, `kit_busy_dropping_frames`.

Viewer changes stay narrowly scoped:

- Expected stage URL comes from `stream_config.stage_composition.primary.url`.
- Stage ready is true only when Kit evidence matches that URL.
- AppStreamer stop/terminate updates visible state and provides reconnect/remount.
- Stale `/api/assets` demo entries cannot override the session primary artifact.

## Chrome E2E Contract

Archive-gate E2E must use Chrome/Chromium and follow a human path:

1. Open `http://192.168.10.105:8004/ui`.
2. Submit or select an IFC-ready job.
3. Observe download and conversion state in `/ui`.
4. Open viewer from `/ui`.
5. Wait for WebRTC start.
6. Wait for stage-load evidence.
7. Assert loaded stage URL equals the conversion `model.usdc` URL.
8. Assert video dimensions are non-zero.
9. Save screenshot/HAR/console/runtime snapshots.
10. Reload/reconnect and assert recovery or record deterministic blocker.

## Non-goals

- Do not reintroduce `_worker` or `_bim-control` runtime.
- Do not make coordinator parse/render USD.
- Do not make `/ui` a long-term production monitoring platform.
- Do not archive until the full browser/Kit/WebRTC evidence is current and reviewable.

