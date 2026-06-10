# EdgeConsole Primary UI Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coordinator `/ui` serve the EdgeConsole bundle in test deployment while preserving `/dev-console` and `/ui/open`.

**Architecture:** The coordinator Docker image builds `web-viewer-sample/dist-ui` during image build and copies it to `/workspace/console-dist`. `compose.runtime-manager.yml` points `CONSOLE_DIST_DIR` at that image-owned directory and avoids a host bind mount that could hide the bundle after `git clean -fdx`. `scripts/deploy.ps1` verifies the Vite shell and at least one `/ui/assets/*` bundle asset after `-Build`.

**Tech Stack:** PowerShell deploy scripts, Docker Compose, Node 20, Vite React build, Express static serving, Vitest/Supertest.

---

## File Map

- `infra/docker/coordinator-web-plane.Dockerfile`: dedicated coordinator runtime image with frontend build stage.
- `compose.runtime-manager.yml`: coordinator build target and `CONSOLE_DIST_DIR` environment.
- `scripts/deploy.ps1`: post-build web-plane verification for `/ui` shell and bundle assets.
- `scripts/tests/test-edge-console-deploy-contract.ps1`: script-level contract for Docker/compose/deploy wiring.
- `bim-review-coordinator/tests/dev-console.test.ts`: route-level smoke for `CONSOLE_DIST_DIR` branch.
- `docs/superpowers/specs/2026-06-10-edge-console-primary-ui-deploy-design.md`: spec corrections discovered by QA review.

---

### Task 1: Image-Owned EdgeConsole Bundle

**Files:**
- Create: `infra/docker/coordinator-web-plane.Dockerfile`
- Modify: `compose.runtime-manager.yml`

- [x] **Step 1: Add a coordinator-specific Dockerfile**

Expected Dockerfile shape:

```dockerfile
FROM node:20-bookworm-slim AS console-build
WORKDIR /workspace/web-viewer-sample
COPY web-viewer-sample/package*.json web-viewer-sample/.npmrc ./
RUN npm install -g npm@^10
RUN npm config --global set engine-strict true
RUN npm install
COPY web-viewer-sample/ /workspace/web-viewer-sample/
RUN npm run build:ui

FROM node:20-bookworm-slim
WORKDIR /workspace/bim-review-coordinator
COPY bim-review-coordinator/package*.json ./
RUN npm install
COPY bim-review-coordinator/ /workspace/bim-review-coordinator/
COPY --from=console-build /workspace/web-viewer-sample/dist-ui /workspace/console-dist
ENV CONSOLE_DIST_DIR=/workspace/console-dist
EXPOSE 8004
```

- [x] **Step 2: Point coordinator compose build at the dedicated Dockerfile**

Expected compose fragment:

```yaml
coordinator:
  build:
    context: .
    dockerfile: infra/docker/coordinator-web-plane.Dockerfile
```

- [x] **Step 3: Remove any host mount for `web-viewer-sample/dist-ui`**

Expected: `compose.runtime-manager.yml` must not contain `web-viewer-sample/dist-ui:/workspace/console-dist`.

- [x] **Step 4: Verify compose config**

Run:

```powershell
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit.example config --quiet
```

Expected: exit code `0`.

---

### Task 2: Deploy Verification Contract

**Files:**
- Modify: `scripts/deploy.ps1`
- Create: `scripts/tests/test-edge-console-deploy-contract.ps1`

- [x] **Step 1: Add text and asset probes**

Expected PowerShell functions:

```powershell
function Probe-Text {
    param([string] $Name, [string] $Url, [string] $Pattern)
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $content = [string]$r.Content
    return [pscustomobject]@{ Ok = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400 -and $content -match $Pattern); Content = $content }
}

function Probe-UiAsset {
    param([string] $Name, [string] $UiUrl, [string] $Html)
    $match = [regex]::Match($Html, '(?:src|href)="(?<asset>/ui/assets/[^"]+\.(?:js|css))"')
    if (-not $match.Success) { return $false }
    $ui = [uri]$UiUrl
    $assetUrl = "$($ui.Scheme)://$($ui.Authority)$($match.Groups['asset'].Value)"
    return Probe-Url -Name $Name -Url $assetUrl
}
```

- [x] **Step 2: Wire probes into Phase 5 after coordinator health**

Expected: Phase 5 adds `coordinator-ui-edge-console-shell` if `/ui` HTML does not contain `/ui/assets/`, and `coordinator-ui-edge-console-asset` if the referenced JS/CSS asset is not reachable.

- [x] **Step 3: Add a PowerShell contract test**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-edge-console-deploy-contract.ps1
```

Expected: `[PASS] edge-console-deploy-contract`.

---

### Task 3: Route-Level Smoke For Console Dist Branch

**Files:**
- Modify: `bim-review-coordinator/tests/dev-console.test.ts`

- [x] **Step 1: Add a test fixture with a fake Vite bundle**

Add a temp `console-dist/index.html` containing `/ui/assets/index-test.js`, and a matching `assets/index-test.js`.

- [x] **Step 2: Assert route behavior**

Expected assertions:

```ts
expect(await request(app.app).get("/ui")).toMatch Vite shell text;
expect(await request(app.app).get("/ui/assets/index-test.js")).status === 200;
expect(await request(app.app).get("/dev-console")).text contains "Review Coordinator";
expect(await request(app.app).get("/ui/open?session=bad")).status === 400;
expect(await request(app.app).get("/ui/open?session=review_session_console_dist")).status === 302;
```

- [x] **Step 3: Run the focused coordinator test**

Run:

```powershell
cd bim-review-coordinator
npx vitest run tests/dev-console.test.ts
```

Expected: all tests in `dev-console.test.ts` pass.

---

### Task 4: Build And Runtime Verification

**Files:**
- No source edits expected.

- [x] **Step 1: Build the web-viewer UI bundle**

Run:

```powershell
cd web-viewer-sample
npm run build:ui
```

Expected: Vite emits `dist-ui/index.html` and `/assets/*.js|css`.

- [x] **Step 2: Build the coordinator Docker image**

Run:

```powershell
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit.example build coordinator
```

Expected: image build logs include `RUN npm run build:ui` and the image is produced.

- [x] **Step 3: Probe the image-owned `/ui` runtime**

Run an isolated `docker run` that starts `npm run dev` in the image and fetches:

```txt
GET http://127.0.0.1:8004/health
GET http://127.0.0.1:8004/ui
GET http://127.0.0.1:8004/ui/assets/<first-js-or-css>
```

Expected: `/health`, `/ui`, and the first bundle asset return `200`.

---

### Task 5: Browser QA Evidence

**Files:**
- Modify: `web-viewer-sample/index.html`
- Create: `web-viewer-sample/src/console/indexHtml.test.ts`

- [x] **Step 1: Serve the built coordinator image for browser QA**

Run the coordinator image with host port `8004` available, or use an equivalent local coordinator serving the built `dist-ui`.

- [x] **Step 2: Add a failing HTML contract test for the browser QA favicon 404**

Run before the fix:

```powershell
cd web-viewer-sample
npx vitest run --no-cache src/console/indexHtml.test.ts
```

Expected before fix: fail because `index.html` contains `/vite.svg`.

- [x] **Step 3: Remove the root-relative Vite favicon**

Expected `web-viewer-sample/index.html` no longer contains:

```html
<link rel="icon" type="image/svg+xml" href="/vite.svg" />
```

- [x] **Step 4: Re-run the HTML contract test**

Run:

```powershell
cd web-viewer-sample
npx vitest run --no-cache src/console/indexHtml.test.ts
```

Expected: `1 passed`.

- [x] **Step 5: Use gstack browse/qa against `/ui#/a1`**

Verify:

```txt
page loads
AI · BIM Governance is visible
A1 route content is visible
console errors are empty or explained
network failures are empty or explained
desktop screenshot saved
mobile screenshot saved
```

- [x] **Step 6: Verify adjacent routes**

Verify:

```txt
/dev-console shows Review Coordinator
/ui/open?session=bad returns 400
/ui/open?session=review_session_console_dist returns 302
```

---

### Task 6: Completion Gate

**Files:**
- No source edits expected unless earlier verification exposes a defect.

- [x] **Step 1: Run fresh final checks**

Run:

```powershell
git -c safe.directory=C:/Users/IOT/.codex/worktrees/db05/AI-BIM-governance diff --check
gitnexus detect-changes --repo AI-BIM-governance-db05
```

Expected: no whitespace errors; GitNexus reports only expected scope or no indexed symbol changes.

- [x] **Step 2: Commit any new plan/test changes**

Run:

```powershell
git add docs/superpowers/plans/2026-06-10-edge-console-primary-ui-deploy.md bim-review-coordinator/tests/dev-console.test.ts
git commit -m "test(deploy): 驗證 EdgeConsole 主頁路由"
```

Expected: a small, reviewable commit.

---

### Task 7: A1 Operable Integration

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Modify: `web-viewer-sample/src/console/console.test.tsx`

- [x] **Step 1: Add a failing A1 integration test**

Run before implementation:

```powershell
cd web-viewer-sample
npx vitest run --no-cache src/console/console.test.tsx
```

Expected before fix: fail because `A1GovernanceWorkbenchPage` lacks `data-testid="a1-real-ifc-slice"` and `data-testid="a1-rule-center-slice"`.

- [x] **Step 2: Embed existing operable slices into A1**

Expected `A1GovernanceWorkbenchPage` includes:

```tsx
<section data-testid="a1-real-ifc-slice">
  <RealIfcConsolePage />
</section>
<section data-testid="a1-rule-center-slice">
  <IssuesRuleCenterPage />
</section>
```

- [x] **Step 3: Expose rule-run IDs in the rule center**

Expected `IssuesRuleCenterPage` renders visible fields:

```tsx
<Field k="rule_run_id" v={runId ?? "—"} prov="asbuilt" />
<Field k="rule_run_status" v={busy ? "running" : run?.status ?? "idle"} prov="asbuilt" />
```

- [x] **Step 4: Re-run the focused A1 test**

Run:

```powershell
cd web-viewer-sample
npx vitest run --no-cache src/console/console.test.tsx
```

Expected: `25 passed`.
