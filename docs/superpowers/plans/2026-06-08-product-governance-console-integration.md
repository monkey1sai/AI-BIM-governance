# Product Governance Console Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 prototype 定義的完整 AI-BIM Governance 操作台落到現有 React/Vite frontend，保留既有 A1/A2/A3/runtime/viewer 功能，並產出 rebuild + E2E 證據。

**Architecture:** `web-viewer-sample` owns browser UI。`EdgeConsole` 成為 `/ui` / `/console` 主操作台，既有 viewer attach `?session=` 仍交給 `<App/>`。Coordinator / conversion / Kit / MinIO 頁只顯示狀態、治理規則與 audited intent wording，不直接執行 heavy conversion、Kit restart 或 WebRTC rendering。

**Tech Stack:** React 18, Vite, TypeScript, Vitest renderToString tests, Playwright/browser E2E, existing coordinator/governance clients.

---

### Task 1: Contract Tests

**Files:**
- Modify: `web-viewer-sample/src/console/console.test.tsx`

- [x] **Step 1: Write failing tests**

Add render tests requiring:
- full product console shell nav groups
- A1 five-step flow wording
- 3D viewer DataChannel capability matrix
- conversion/session/Kit-GPU/MinIO pages

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
New-Item -ItemType Directory -Force .tmp
$env:TEMP=(Resolve-Path .tmp).Path
$env:TMP=$env:TEMP
npm test -- src/console/console.test.tsx
```

Expected before implementation: FAIL because new page exports/routes are missing.

### Task 2: Route and Shell Integration

**Files:**
- Modify: `web-viewer-sample/src/main.tsx`
- Modify: `web-viewer-sample/src/console/routing.ts`
- Modify: `web-viewer-sample/src/console/routing.test.ts`
- Modify: `web-viewer-sample/src/console/EdgeConsole.tsx`
- Modify: `web-viewer-sample/src/console/data.ts`

- [ ] **Step 1: Mount EdgeConsole for operator routes**

Change `main.tsx` to import and render `EdgeConsole` for `isOperatorConsolePath(...)`, preserving `<App/>` for viewer session attach.

- [ ] **Step 2: Extend short hash routing**

Route hashes must include:

```txt
home, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10,
viewer, gpu, conv, sessions, instances, minio,
issues, reports, runtime, admin, spec,
overview, coordinator, intake, review, semantic,
version-diff, federation, apps
```

- [ ] **Step 3: Replace flat nav with prototype groups**

Use nav groups:

```txt
工作台
核心治理
OMNIVERSE RUNTIME
落地端控制台
SYSTEM
```

Each nav item must route to a concrete page or intentional alias.

### Task 3: Page Implementations

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Modify: `web-viewer-sample/src/console/data.ts`
- Modify: `web-viewer-sample/src/console/edge-console.css`

- [ ] **Step 1: Implement A1GovernanceWorkbenchPage**

Render five-step operator flow: upload/select model, automatic check, result scoreboard, issue creation, BCF/Excel delivery. Link to existing A1 Rule Center with text that `governance-service :49102` is the rule-run authority.

- [ ] **Step 2: Implement ViewerPresentationPage**

Render 3D viewer capabilities: stage loading, first frame evidence, DataChannel ready, openStage, focusPrim, selectPrims, clearHighlight, highlightPrimsRequest, semantic table, mapping table.

- [ ] **Step 3: Implement ConversionSchedulingPage**

Use existing `coordinatorClient.listIfcReady` and `runtimeStatus` where available. Show pipeline `MinIO source -> queue -> IFC→USD -> write model.usdc -> notify Kit`, mapping coverage, queue controls as pending.

- [ ] **Step 4: Implement SessionManagementPage**

Show primary/spectator endpoint pool, first-frame gate, heartbeat, stale reclaim, open URL rules, force release confirmation/audit rule.

- [ ] **Step 5: Implement KitGpuFleetPage**

Show Kit/GPU nodes, 1 GPU = 1 stream, drain, restart intent, pending sessions, migration as terminate + recreate.

- [ ] **Step 6: Implement MinioDataPage**

Show `bim-control` bucket, project/category/version tree, `model.ifc`, `model.rvt`, `elements.json`, `geometries.json`, chunks, `spatial_tree.json`, and planned `model.usdc`.

- [ ] **Step 7: Implement lightweight Reports/Admin/Spec pages**

Avoid routing unknown prototype tabs back to overview silently.

### Task 4: Verification

**Files / artifacts:**
- Create/update: `artifacts/e2e/*`
- Create/update: `artifacts/runtime/*`

- [x] **Step 1: Run targeted tests**

```powershell
New-Item -ItemType Directory -Force .tmp
$env:TEMP=(Resolve-Path .tmp).Path
$env:TMP=$env:TEMP
npm test -- src/console/console.test.tsx src/console/routing.test.ts src/console/OperatorConsole.test.tsx
```

- [x] **Step 2: Build UI bundle**

```powershell
npm run build:ui
```

- [x] **Step 3: Browser E2E**

Serve the rebuilt bundle through the existing coordinator or Vite preview. Open `/ui`, navigate shell + pages, save screenshot and browser console evidence under `artifacts/e2e`.

- [x] **Step 4: Docker web + Nvidia Kit / OS runtime validation**

Use repo scripts/compose files where available. Save exact commands, logs, screenshots, and if Kit/WebRTC first-frame evidence is unavailable, save the blocker rather than claiming full E2E.

Result (2026-06-08):
- `npm test -- src/console/console.test.tsx src/console/routing.test.ts src/console/OperatorConsole.test.tsx` passed: 44 tests.
- `npm run build:ui` passed; Vite emitted `dist-ui`.
- Product console E2E passed against rebuilt Docker deployment at `http://127.0.0.1:8004/ui`.
- `scripts/deploy.ps1 -Force -Build` passed: Docker coordinator/viewer rebuilt, host-native conversion and Kit already running with matching runtime parameters.
- Live viewer evidence passed first-frame observation for `review_session_0d3d03e7a541`: video 1920x1080, `readyState=4`, `srcObject=true`, screenshot `artifacts/e2e/live-viewer-review_session_0d3d03e7a541.png`.
- Remaining runtime truth gap: viewer UI showed `Stage truth mismatch`; do not claim stage-match readiness until loaded-stage equality / `openedStageResult` sequencing is fixed.

- [x] **Step 5: GitNexus detect changes**

Run `gitnexus detect_changes` / MCP detect_changes and record risk before final handoff.

Result (2026-06-08):
- GitNexus `detect_changes(scope=all)` reported `risk_level=medium`.
- Affected processes: `RenderBody -> ProvTag`, `RenderBody -> Col`.
- No HIGH / CRITICAL risk reported.
