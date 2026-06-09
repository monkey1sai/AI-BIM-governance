## 1. OpenSpec / Superpowers Planning

- [x] 1.1 Create OpenSpec proposal, design, specs, and tasks for product-governance-console-integration
- [x] 1.2 Create a Superpowers implementation plan under docs/superpowers/plans

## 2. Frontend Contract Tests

- [x] 2.1 Add render tests for the full product console shell and prototype navigation groups
- [x] 2.2 Add render tests for A1, 3D Viewer, conversion scheduling, session management, Kit/GPU fleet, and MinIO pages

## 3. Product Console Integration

- [x] 3.1 Mount EdgeConsole as the actual `/ui` / `/console` operator console entry while preserving viewer `?session=` attach behavior
- [x] 3.2 Extend route detection and page routing for prototype routes: home, a1-a10, viewer, gpu, conv, sessions, instances, minio, issues, reports, runtime, admin, spec
- [x] 3.3 Update left navigation to match prototype groups: Workspace, Core Governance, Omniverse Runtime, Coordinator / Edge Control, System
- [x] 3.4 Update Chat USD Agent side panel to show page-aware prompts and tool-trace style evidence while staying disabled for real state-changing actions

## 4. Page Implementation

- [x] 4.1 Implement A1GovernanceWorkbenchPage using the prototype five-step flow and link to existing A1 Rule Center behavior
- [x] 4.2 Implement ViewerPresentationPage with 3D viewer capability matrix and existing WebRTC/DataChannel boundaries
- [x] 4.3 Implement ConversionSchedulingPage using existing ifc-ready/runtime status data where available and honest gaps for queue controls
- [x] 4.4 Implement SessionManagementPage with primary/spectator endpoint states, first-frame gate, stale reclaim policy, and audit rules
- [x] 4.5 Implement KitGpuFleetPage with GPU/Kit node model, drain/restart intent rules, and migration warning
- [x] 4.6 Implement MinioDataPage with bucket/project/model/version/file relationships and generated `model.usdc` state
- [x] 4.7 Implement Reports/Admin/Spec lightweight pages so prototype routes do not fall back to unrelated overview content

## 5. Verification

- [x] 5.1 Run targeted Vitest console tests
- [x] 5.2 Run `npm run build:ui`
- [x] 5.3 Run browser E2E against the rebuilt console and save screenshots / logs under artifacts/e2e
- [x] 5.4 Rebuild or validate Docker web plane and Nvidia Kit / OS runtime path, saving command logs and any blockers under artifacts/e2e or artifacts/runtime
- [x] 5.5 Run GitNexus detect_changes and record affected scope
