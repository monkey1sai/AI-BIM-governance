## ADDED Requirements

### Requirement: Demo smoke verifies LAN handoff and same-session multi-viewer evidence

Demo runtime smoke SHALL include a same-session LAN multi-viewer tier that verifies both browser-visible handoff and concurrent viewer evidence for one ready review session. This tier SHALL be evaluated after the existing single-viewer closed loop has a ready session and Kit/WebRTC endpoint.

The smoke SHALL preserve separate statuses for `viewer_handoff_lan_url`, `single_kit_multi_viewer`, and `dedicated_multi_kit`. A pass in LAN handoff or single-Kit multi-viewer MUST NOT imply dedicated multi-Kit pass.

#### Scenario: LAN viewer URL is browser-visible

- **WHEN** a ready IFC-ready job exposes `viewer_url`
- **THEN** the smoke verifies that `/ui/open?session=<review_session_id>` redirects to the configured viewer host
- **AND** the redirect target does not use `127.0.0.1` unless the smoke explicitly runs in localhost-only mode

#### Scenario: Two viewers open one session

- **WHEN** the smoke opens two browser pages for the same coordinator-generated viewer URL
- **THEN** both pages use the same `review_session_id`
- **AND** both pages report non-error session bootstrap
- **AND** the evidence records participant/viewer count, Kit endpoint, expected stage URL, and per-page WebRTC readiness

#### Scenario: Webwright captures reviewable screenshots

- **WHEN** the same-session multi-viewer smoke is executed with Microsoft Webwright
- **THEN** the output artifact includes per-viewer screenshots, logs, target URLs, `review_session_id`, and pass/fail classification
- **AND** the screenshot paths are referenced from the change verification summary

#### Scenario: Single-Kit failure remains actionable

- **WHEN** the second viewer cannot obtain WebRTC video or stage match from the same Kit endpoint
- **THEN** the smoke classifies `single_kit_multi_viewer` as `failed` or `blocked`
- **AND** the evidence records the failure code, browser diagnostics, and whether the next fix is viewer handoff, coordinator session state, or Kit/WebRTC runtime behavior
