# runtime-verification-evidence — Spec Delta (fix-ifc-usdc-hoops-load-failure)

> Delta against `openspec/specs/runtime-verification-evidence/spec.md`。本 change 將 Chrome human-like E2E 與 Kit/WebRTC stage-load evidence 納入 archive gate，避免用 API success 或 React metadata 誤報 demo 閉環完成。

## MODIFIED Requirements

### Requirement: Single Kit render evidence uses real worker artifacts

Single Kit render evidence MUST prove that the browser viewer caused Kit to load the `model.usdc` produced by the active `bim-streaming-server` conversion job for the current IFC-ready run. Evidence MUST include the current `ifc_ready_job_id`, `conversion_job_id`, `review_session_id`, expected stage URL, Kit stage-load evidence, non-zero browser video dimensions, and visual proof.

#### Scenario: Kit stage-load proof matches current conversion job

- **WHEN** a Chrome E2E run opens the viewer for a ready review session
- **THEN** evidence records the expected `model.usdc` URL from coordinator stream config
- **AND** records DataChannel or Kit log proof that the loaded stage URL matches the expected URL
- **AND** records `openedStageResult` or `loadingStateResponse` evidence when available

#### Scenario: React metadata is insufficient

- **WHEN** the viewer displays `model.status="ready"` and the converted `model.usdc` URL in React UI
- **BUT** there is no matching Kit-loaded stage evidence
- **THEN** conversion evidence MAY remain passed
- **AND** single-Kit render evidence MUST remain `not_observed`, `blocked`, or `failed`

#### Scenario: Stale demo stage invalidates visual pass

- **WHEN** browser screenshot or Kit log shows `許良宇圖書館建築_2026.usdc` while the current expected stage URL points to a different conversion job
- **THEN** visual preview evidence MUST NOT be classified as passed
- **AND** the evidence records a `stale_stage_or_mismatch` blocker

### Requirement: Kit and browser readiness evidence is explicit

Kit/WebRTC evidence SHALL include disconnect and reconnect observations when they occur during E2E. A run that disconnects after a few seconds MUST record whether the disconnect was caused by browser lifecycle, AppStreamer lifecycle, Kit WebRTC server, or an unresolved runtime limitation.

#### Scenario: Kit WebRTC server disconnects the client

- **WHEN** Kit logs contain `NVST_R_BUSY, dropping frame` followed by `Client disconnected from WebRTC server`
- **THEN** evidence classifies WebRTC viewer stability as non-passed
- **AND** records the Kit log path, line numbers or excerpts, process age, and active connection summary when available

#### Scenario: Reconnect requires closing the whole browser

- **WHEN** a reload cannot reconnect but closing all Chrome processes allows a new connection
- **THEN** evidence records the behavior as a browser/AppStreamer/Kit lifecycle blocker
- **AND** the implementation MUST either provide a clean reconnect path or keep archive blocked with that deterministic reason

### Requirement: Demo runtime smoke emits reviewable evidence artifacts

Chrome human-like E2E evidence SHALL start from the operator page (`/ui`) and cover the full observable path from IFC-ready job to viewer stage-load. It MUST save evidence artifacts that can be inspected without relying on memory of a manual run.

#### Scenario: E2E starts from coordinator UI

- **WHEN** archive-gate E2E runs
- **THEN** it opens `http://192.168.10.105:8004/ui` or the configured coordinator UI host
- **AND** it observes or triggers the IFC-ready job through UI-visible state
- **AND** it opens the viewer from the UI handoff rather than directly typing an already-known viewer URL only

#### Scenario: E2E evidence artifacts are saved

- **WHEN** E2E completes or stops on a blocker
- **THEN** evidence includes screenshot, HAR or network summary, browser console summary, coordinator runtime snapshot, and Kit/WebRTC evidence summary
- **AND** `acceptance.md` references those artifacts or their deterministic command outputs

