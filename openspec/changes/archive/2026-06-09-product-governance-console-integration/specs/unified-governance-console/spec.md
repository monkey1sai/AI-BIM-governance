## ADDED Requirements

### Requirement: Product Governance Console Shell
The web frontend SHALL present `/ui` and `/console` as a complete AI-BIM Governance operator console with grouped navigation for Workspace, Core Governance, Omniverse Runtime, Coordinator / Edge Control, and System.

#### Scenario: Operator opens the product console
- **WHEN** the operator opens `/ui` without a `session` query
- **THEN** the frontend renders the full governance console shell with top runtime status, grouped left navigation, central workspace, and Chat USD Agent side panel

#### Scenario: Viewer session attach remains separate
- **WHEN** the browser opens `/ui?session=review_session_x`
- **THEN** the frontend does not mount the operator console and preserves the existing viewer attach path

### Requirement: A1-A10 Pages Preserve Prototype Intent
The frontend SHALL provide an operator-facing page for A1 through A10, with each page explaining the function purpose, expected UI presentation, backend dependencies, and honest provenance.

#### Scenario: Operator opens A1
- **WHEN** the operator navigates to A1 Governance & Rule Checker
- **THEN** the page shows the guided flow upload/select model, automatic check, result scoreboard, issue creation, and BCF/Excel delivery

#### Scenario: Operator opens roadmap apps
- **WHEN** the operator navigates to A4, A5, A6, A7, A8, A9, or A10
- **THEN** the page labels backend capabilities as roadmap or not built and does not present them as live system evidence

### Requirement: Viewer Presentation Page
The frontend SHALL include a 3D Viewer presentation page that tells the operator what the live viewer can show and which operations are backed by existing WebRTC/DataChannel behavior.

#### Scenario: Operator opens 3D Viewer page
- **WHEN** the operator navigates to the 3D Viewer presentation page
- **THEN** the page lists stage loading, selection, focus, highlight, mapping table, semantic panel, first-frame evidence, and DataChannel limitations

### Requirement: Coordinator Edge Control Pages
The frontend SHALL include Coordinator pages for IFC→USD conversion scheduling, Session management, Kit/GPU fleet, and MinIO data relationships.

#### Scenario: Operator opens conversion scheduling
- **WHEN** the operator navigates to IFC→USD conversion scheduling
- **THEN** the page shows intake source, queue, conversion authority, mapping coverage, writeback, and Kit notification lifecycle using existing data when available

#### Scenario: Operator opens session management
- **WHEN** the operator navigates to Session management
- **THEN** the page shows primary/spectator endpoint states, first-frame evidence gate, heartbeat, stale reclaim policy, and controlled action rules

#### Scenario: Operator opens Kit/GPU fleet
- **WHEN** the operator navigates to Kit/GPU fleet
- **THEN** the page shows that 1 GPU maps to 1 Kit stream, draining prevents new sessions, and migration means terminate plus recreate rather than seamless movement

#### Scenario: Operator opens MinIO data
- **WHEN** the operator navigates to MinIO data
- **THEN** the page shows bucket, project/model/version structure, source files, parsed files, generated `model.usdc`, and pending gaps without pretending to be a real S3 browser

### Requirement: Honest Evidence and Provenance
Every user-facing capability shown in the product console SHALL mark whether the evidence is implemented, artifact-tested, demo data, backend pending, or roadmap.

#### Scenario: Operator inspects a not-built action
- **WHEN** a capability is not backed by current API/runtime behavior
- **THEN** the UI disables the action or labels it as pending/roadmap and explains the missing backend or evidence
