# demo-fast-mvp-orchestration — Spec Delta (fix-ifc-usdc-hoops-load-failure)

> Delta against `openspec/specs/demo-fast-mvp-orchestration/spec.md`。本 change 將 `/ui` 從三卡 happy-path demo 擴充為 closed-loop runtime dashboard，讓 operator 能直接觀察 IFC-ready download、conversion、review session、Kit/WebRTC 與 viewer 狀態。

## ADDED Requirements

### Requirement: Coordinator /ui provides closed-loop runtime dashboard

`bim-review-coordinator` `/ui` SHALL continue to support the fast MVP happy path for submitting an IFC-ready payload, polling the job, and opening the viewer. In addition, `/ui` SHALL present a first-viewport runtime dashboard that separates IFC-ready intake, IFC download, internal conversion job, artifact readiness, review session binding, Kit/WebRTC endpoint state, and viewer/session participation. The dashboard MUST NOT treat a stale `/api/assets` demo entry as proof that the current session has loaded the current conversion artifact.

#### Scenario: Operator sees IFC-ready and download state

- **WHEN** an operator opens `/ui` after or during a `POST /api/external/ifc-ready` run
- **THEN** the dashboard displays the current or recent `ifc_ready_job_id`, `source_ifc_ref`, `download_status`, `download_failure`, `local_path`, and `host_local_path`
- **AND** it distinguishes `pending`, `downloading`, `downloaded`, and `failed`

#### Scenario: Operator sees conversion job state

- **WHEN** an IFC-ready job has been dispatched to `bim-streaming-server`
- **THEN** the dashboard displays `conversion_job_id`, `conversion_status`, `conversion_authority`, `artifact_manifest_ref`, `model.usdc` URL, mapping URL, and quality summary when available
- **AND** it distinguishes conversion readiness from viewer/render readiness

#### Scenario: Operator sees review session and viewer state

- **WHEN** coordinator has created a local review session for a ready conversion
- **THEN** the dashboard displays `review_session_id`, `viewer_url`, participant count, configured Kit endpoint, and viewer/open status fields
- **AND** it makes clear which `model.usdc` URL is the expected stage for that session

#### Scenario: Stale demo asset is visible only as debug context

- **WHEN** `/api/assets` still contains legacy demo assets such as `許良宇圖書館建築_2026.usdc`
- **THEN** those assets MAY appear in a debug/details section or selector
- **AND** the dashboard MUST NOT mark the current closed-loop run as passed because a legacy demo asset is visible or rendered

## MODIFIED Requirements

### Requirement: Fast MVP runbook SHALL include hybrid Docker web-plane path

Fast MVP documentation and `/ui` runtime dashboard SHALL distinguish the Docker web-plane from the host-native Kit/WebRTC plane. The dashboard SHALL show that `8004` and `5173` may be containerized while `49100` / `47998` / `49101` remain host-native for this demo path.

#### Scenario: Dashboard shows hybrid boundary

- **WHEN** the hybrid Docker web-plane mode is running
- **THEN** `/ui` displays coordinator/viewer service reachability separately from Kit/WebRTC and conversion authority reachability
- **AND** it MUST NOT imply that a healthy Docker web-plane proves GPU/Kit viewport readiness

