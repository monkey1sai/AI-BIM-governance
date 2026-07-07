# Artifact Persistence Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make A1 rule-runs and Review Room reject stale local artifacts before they fail inside governance-service or the viewer, and persist edge-local IFC/USDC/mapping health in a way that matches the cloud-control-plane / edge-data-plane architecture.

**Architecture:** The deployed test checkout `D:\Users\deploy\AI-bim-geo` is treated as the tenant-zero edge site code checkout. Durable edge payload state moves to an edge runtime data root outside the git-cleaned checkout; coordinator records edge-local artifact records and health snapshots there. Cloud-facing data remains metadata-only: it may receive tenant/site IDs, model version IDs, hashes, sizes, status booleans, timestamps, and failure classes, but never IFC/USD payload bytes or host absolute paths.

**Tech Stack:** TypeScript coordinator services with Node `fs` / `http` / `https`, existing JSON atomic-swap ledger pattern from `ConversionLedger`, existing Express coordinator routes, existing Vitest + Supertest tests, existing React Edge Console clients. No new production dependency.

## Global Constraints

- `AI-BIM-governance` remains a cloud-control-plane + edge-data-plane product. IFC/USD payload stays on the edge site.
- H6 metadata-only boundary remains intact: cloud stores only whitelisted metadata; IFC/USD bytes, model geometry, Pset values, raw mapping payload, and edge host absolute paths do not leave the edge.
- The local deployment test area is the first edge site: code checkout `D:\Users\deploy\AI-bim-geo`, durable runtime data root `D:\Users\deploy\AI-bim-geo-data`.
- A1 must not trust browser-supplied paths or raw MinIO object keys. A1 rule-run for MinIO/session-backed files must go through `POST /api/governance/rule-runs/for-session/:sessionId`.
- `conversion_status: "ready"` and `download_status: "downloaded"` are not sufficient proof that files still exist. Runtime use must check artifact health at use time.
- Do not modify `governance-service` for the first slice unless coordinator cannot produce a precise stale-artifact response.
- Any code-symbol edit requires GitNexus impact before editing and GitNexus detect_changes before commit.
- Browser-visible / external IFC-ready DTOs must not expose `local_path` or `host_local_path`; host absolute paths stay edge-internal only.
- Health probes must not become a filesystem oracle: canonicalized source IFC paths must remain under `EDGE_RUNTIME_DATA_ROOT\storage`, and probes must reject `..`, alternate drives, UNC paths, symlink/reparse-point escapes, and paths outside the expected artifact shape.
- URL health probes must use an explicit allowlist helper: exact normalized conversion API origin or tenant-zero loopback only; no credentials, no redirects, no arbitrary LAN/link-local/internal metadata endpoints.
- List/runtime projections must not synchronously probe every job on every request. Bulk projections use the latest persisted snapshot unless a bounded TTL/concurrency guard is implemented.

## Assumptions

- The existing `ConversionLedger` is the durable conversion observation ledger, not the full artifact health ledger.
- The first implementation should reuse its single JSON file + `.tmp` atomic rename persistence pattern, but use a separate artifact health ledger to avoid overloading conversion history with volatile reachability probes.
- `D:\Users\deploy\AI-bim-geo` may be reset and cleaned by `scripts/dev/rebuild-test-deploy.ps1 -Build`; therefore durable payload records must not depend on ignored files inside that checkout.
- `source_ifc_exists`, `model_usdc_reachable`, and `mapping_reachable` are edge-local truth fields. The cloud projection may receive their boolean values and timestamps, not their host path inputs.

## Success Criteria

- A stale session whose `host_local_path` no longer exists returns `409 stale_session_artifact` from coordinator before hitting governance-service.
- `GET /api/external/ifc-ready` and `GET /api/review-sessions/:sessionId/stream-config` expose an `artifact_health` object with at least `source_ifc_exists`, `model_usdc_reachable`, `mapping_reachable`, `checked_at`, and `stale_reason`.
- Edge runtime data survives deployment checkout rebuild because it is stored under `D:\Users\deploy\AI-bim-geo-data`, not under the git-cleaned checkout.
- Edge cloud projection contains no payload bytes and no host absolute paths.
- A1 UI disables MinIO/session-backed rule-run when `source_ifc_exists !== true`; Review Room marks model/mapping stale when `model_usdc_reachable` or `mapping_reachable` is false.

## Data Architecture

### Edge Runtime Data Root

Deploy-time environment contract:

```txt
EDGE_SITE_ID=site_local_deploy
EDGE_RUNTIME_DATA_ROOT=D:\Users\deploy\AI-bim-geo-data
RUNTIME_STORAGE_ROOT=D:\Users\deploy\AI-bim-geo-data\storage
STORAGE_HOST_ROOT=D:\Users\deploy\AI-bim-geo-data\storage
STREAMING_CONVERSION_ARTIFACTS_ROOT=D:\Users\deploy\AI-bim-geo-data\artifacts
CONVERSION_LEDGER_STORE_PATH=D:\Users\deploy\AI-bim-geo-data\ledgers\conversion-ledger.json
ARTIFACT_HEALTH_LEDGER_STORE_PATH=D:\Users\deploy\AI-bim-geo-data\ledgers\artifact-health-ledger.json
```

Local dev fallback may continue to use `<repo>\storage` and `<repo>\data`, but deployed test rebuild must prefer the explicit edge runtime root above.

### Edge-Local Artifact Record

Add this TypeScript shape in `bim-review-coordinator/src/services/artifactHealthLedger.ts`:

```ts
export type EdgeArtifactKind = "source_ifc" | "model_usdc" | "element_mapping" | "metadata" | "entity_index";

export type EdgeArtifactStatus = "unknown" | "present" | "missing" | "reachable" | "unreachable" | "stale";

export interface EdgeArtifactRecord {
  site_id: string;
  tenant_id: string;
  project_id: string;
  external_model_version_id: string;
  ifc_ready_job_id: string | null;
  conversion_job_id: string | null;
  review_session_id: string | null;
  artifact_kind: EdgeArtifactKind;
  edge_artifact_id: string;
  host_local_path: string | null;
  edge_relative_path: string | null;
  public_url: string | null;
  status: EdgeArtifactStatus;
  size_bytes: number | null;
  sha256: string | null;
  etag: string | null;
  last_checked_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}
```

Storage rule:

- `host_local_path` is stored only in the edge-local ledger.
- `edge_relative_path` is relative to `EDGE_RUNTIME_DATA_ROOT` when derivable.
- `public_url` may be browser-visible because it is already a local conversion service URL, but cloud projection should only receive an opaque URL hash.

### Artifact Health Snapshot

Expose this shape from coordinator list/detail/session projections:

```ts
export interface ArtifactHealthSnapshot {
  source_ifc_exists: boolean | null;
  model_usdc_reachable: boolean | null;
  mapping_reachable: boolean | null;
  metadata_reachable: boolean | null;
  all_required_ready: boolean;
  checked_at: string;
  stale_reason: string | null;
  source: "edge_health_probe";
}
```

Boolean semantics:

- `true`: coordinator checked the filesystem or artifact URL in this run and it passed.
- `false`: coordinator checked and the artifact was missing or unreachable.
- `null`: coordinator had insufficient inputs to check, such as no session binding or no mapping URL.
- `all_required_ready`: `source_ifc_exists === true && model_usdc_reachable === true && mapping_reachable === true` for Review Room; A1 only requires `source_ifc_exists === true`.

### Cloud Metadata Projection

When Edge Connector exists, publish only this class of data:

```ts
export interface CloudArtifactProjection {
  site_id: string;
  tenant_id: string;
  project_id: string;
  external_model_version_id: string;
  ifc_ready_job_id: string | null;
  conversion_job_id: string | null;
  review_session_id: string | null;
  source_ifc_exists: boolean | null;
  model_usdc_reachable: boolean | null;
  mapping_reachable: boolean | null;
  metadata_reachable: boolean | null;
  source_ifc_size_bytes: number | null;
  source_ifc_sha256: string | null;
  model_usdc_size_bytes: number | null;
  model_usdc_sha256: string | null;
  mapping_sha256: string | null;
  artifact_url_hashes: Record<string, string>;
  checked_at: string;
  stale_reason: string | null;
}
```

Cloud projection exclusions:

- No `host_local_path`.
- No `edge_relative_path`.
- No raw `public_url`.
- No IFC / USDC / mapping bytes.
- No model geometry, Pset value body, spatial tree body, or per-element mapping payload.

## File Structure

- Create: `bim-review-coordinator/src/services/artifactHealthLedger.ts`
  - Persistent edge-local artifact records and latest health snapshots.
  - Uses schema version `artifact-health-ledger/v1`.
  - Uses the same atomic write strategy as `ConversionLedger`.
- Create: `bim-review-coordinator/tests/artifact-health-ledger.test.ts`
  - Unit coverage for persistence, reload, corrupt-file recovery, and host-path stripping from cloud projection.
- Modify: `bim-review-coordinator/src/config.ts`
  - Add `edgeSiteId`, `edgeRuntimeDataRoot`, and `artifactHealthLedgerStorePath`.
  - Env vars: `EDGE_SITE_ID`, `EDGE_RUNTIME_DATA_ROOT`, `ARTIFACT_HEALTH_LEDGER_STORE_PATH`.
- Modify: `bim-review-coordinator/src/types.ts`
  - Add `ArtifactHealthSnapshot` type.
  - Add optional `artifact_health?: ArtifactHealthSnapshot | null` to browser-visible session/job response types where concrete interfaces exist.
- Modify: `bim-review-coordinator/src/app.ts`
  - Instantiate `ArtifactHealthLedger`.
  - Record source IFC artifact after successful download.
  - Record conversion artifact URLs after conversion-ready ingestion.
  - Refresh artifact health before ifc-ready list/detail projection, stream-config projection, runtime status projection, and for-session governance resolution.
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`
  - Convert missing source IFC into explicit `409 stale_session_artifact` response before forwarding to governance-service.
- Modify: `bim-review-coordinator/tests/governance-rule-run-for-session.test.ts`
  - Add stale source IFC negative test.
- Modify: `bim-review-coordinator/tests/external-ifc-ready.test.ts`
  - Assert `artifact_health` appears in job summary and marks missing files honestly.
- Modify: `bim-review-coordinator/tests/local-web-view.test.ts`
  - Assert stream-config includes model/mapping health.
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`
  - Add frontend DTO fields for `artifact_health`.
- Modify: `web-viewer-sample/src/console/pages.tsx`
  - A1 disables run when source IFC health is false.
  - Review/session panels show stale artifact state without treating missing telemetry as generic failure.
- Modify: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`
  - Add A1 stale-session disabled-state test.
- Modify: `scripts/deploy.ps1`
  - Derive/create `EDGE_RUNTIME_DATA_ROOT` for deployed test profile and wire storage/artifact/ledger env vars.
- Modify: `scripts/lib/rebuild-test-deploy.ps1`
  - Preserve `D:\Users\deploy\AI-bim-geo-data`; do not rely on preserving ignored files under the deployment checkout.
- Modify: `scripts/tests/test-rebuild-test-deploy.ps1`
  - Assert rebuild does not delete the external edge runtime data root.

## Tasks

### Task 1: Edge Runtime Root Contract

**Files:**
- Modify: `scripts/deploy.ps1`
- Modify: `scripts/lib/rebuild-test-deploy.ps1`
- Modify: `scripts/tests/test-rebuild-test-deploy.ps1`

**Interfaces:**
- Produces env vars consumed by coordinator and streaming conversion service:
  - `EDGE_SITE_ID`
  - `EDGE_RUNTIME_DATA_ROOT`
  - `RUNTIME_STORAGE_ROOT`
  - `STORAGE_HOST_ROOT`
  - `STREAMING_CONVERSION_ARTIFACTS_ROOT`
  - `CONVERSION_LEDGER_STORE_PATH`
  - `ARTIFACT_HEALTH_LEDGER_STORE_PATH`

- [ ] Step 1: Write failing deploy script test.

Add an assertion in `scripts/tests/test-rebuild-test-deploy.ps1` that a sentinel file under `D:\Users\deploy\AI-bim-geo-data\ledgers\sentinel.txt` is not part of the git-cleaned deployment checkout and is not removed by rebuild helper logic.

- [ ] Step 2: Run targeted script test.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\tests\test-rebuild-test-deploy.ps1
```

Expected before implementation: failure showing the external edge runtime data root is not protected or not modeled.

- [ ] Step 3: Implement env derivation.

In `scripts/deploy.ps1`, derive:

```powershell
$edgeRuntimeDataRoot = $env:EDGE_RUNTIME_DATA_ROOT
if ([string]::IsNullOrWhiteSpace($edgeRuntimeDataRoot)) {
    $edgeRuntimeDataRoot = 'D:\Users\deploy\AI-bim-geo-data'
}
```

Then create `storage`, `artifacts`, and `ledgers` directories under it, and set the env vars listed above when absent.

- [ ] Step 4: Run targeted script test again.

Run the same script test. Expected after implementation: pass.

### Task 2: Artifact Health Ledger

**Files:**
- Create: `bim-review-coordinator/src/services/artifactHealthLedger.ts`
- Create: `bim-review-coordinator/tests/artifact-health-ledger.test.ts`

**Interfaces:**
- Produces `ArtifactHealthLedger`.
- Produces `toCloudProjection(record): CloudArtifactProjection` that strips host paths and raw URLs.

- [ ] Step 1: Write failing unit tests.

Test cases:

```ts
it("persists and reloads edge-local host paths", () => {});
it("corrupt JSON starts empty and does not crash", () => {});
it("cloud projection excludes host_local_path, edge_relative_path, and raw public_url", () => {});
```

- [ ] Step 2: Run failing tests.

Run:

```powershell
npm test -- tests/artifact-health-ledger.test.ts
```

from `bim-review-coordinator`.

- [ ] Step 3: Implement `ArtifactHealthLedger`.

Implementation requirements:

- schema version `artifact-health-ledger/v1`;
- key format `${site_id}:${edge_artifact_id}:${artifact_kind}`;
- atomic write via `.tmp` then rename;
- bad JSON results in empty ledger;
- `now` is passed in by caller;
- no network calls inside the ledger class.

- [ ] Step 4: Run unit tests again.

Expected: all tests in `artifact-health-ledger.test.ts` pass.

### Task 3: Coordinator Health Probe Service

**Files:**
- Create: `bim-review-coordinator/src/services/artifactHealthProbe.ts`
- Modify: `bim-review-coordinator/src/types.ts`

**Interfaces:**
- Consumes `host_local_path`, artifact URLs, and edge runtime root.
- Produces `ArtifactHealthSnapshot`.

- [ ] Step 1: Write failing probe unit tests.

Test cases:

```ts
it("source_ifc_exists is true when host_local_path is a file", () => {});
it("source_ifc_exists is false when host_local_path is missing", () => {});
it("source_ifc_exists is false when host_local_path escapes EDGE_RUNTIME_DATA_ROOT", () => {});
it("source_ifc_exists is false for UNC paths and alternate drives outside EDGE_RUNTIME_DATA_ROOT", () => {});
it("model_usdc_reachable is false when artifact URL returns 404", () => {});
it("model_usdc_reachable is null for disallowed off-origin artifact URL", () => {});
it("model_usdc_reachable follows HEAD 405 with GET range", () => {});
it("mapping_reachable is null when no mapping URL is bound", () => {});
```

- [ ] Step 2: Implement probe with conservative timeouts.

Rules:

- filesystem checks use `fs.existsSync` and `fs.statSync`;
- URL checks use `HEAD` and fallback to `GET` with `Range: bytes=0-0` when HEAD returns 405;
- timeout is 1500 ms per URL;
- only `http://127.0.0.1`, `http://localhost`, and the exact configured conversion API origin are allowed for direct probe;
- redirects are not followed;
- URLs with credentials are rejected;
- other URLs return `null` unless proxied through existing conversion-service binding.

- [ ] Step 3: Run targeted tests.

Run:

```powershell
npm test -- tests/artifact-health-probe.test.ts
```

Expected: pass.

### Task 4: Persist Health During Intake And Conversion

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`
- Modify: `bim-review-coordinator/tests/conversion-ledger-intake-integration.test.ts`
- Modify: `bim-review-coordinator/tests/external-ifc-ready.test.ts`

**Interfaces:**
- Consumes `ArtifactHealthLedger` and `ArtifactHealthProbe`.
- Produces `artifact_health` on ifc-ready job summaries.

- [ ] Step 1: Add failing test for downloaded source IFC.

Also add public DTO safety assertions: `GET /api/external/ifc-ready` and `GET /api/external/ifc-ready/:jobId` must not contain `local_path` or `host_local_path`.

After strict download succeeds, `GET /api/external/ifc-ready/:jobId` should include:

```json
{
  "artifact_health": {
    "source_ifc_exists": true,
    "source": "edge_health_probe"
  }
}
```

- [ ] Step 2: Add failing test for deleted source IFC.

After seeding a session, delete `host_local_path`, then request job detail. Expected:

```json
{
  "artifact_health": {
    "source_ifc_exists": false,
    "stale_reason": "source_ifc_missing"
  }
}
```

- [ ] Step 3: Implement projection refresh.

Refresh health for detail/use-time paths and persist the latest snapshot into `ArtifactHealthLedger`. Bulk list/runtime projections must use the latest persisted snapshot unless a bounded TTL/concurrency guard is in place. Keep host paths available only inside coordinator internals and resolver logic; public/external responses expose `artifact_health`, not absolute filesystem paths.

- [ ] Step 4: Run targeted tests.

Run:

```powershell
npm test -- tests/external-ifc-ready.test.ts tests/conversion-ledger-intake-integration.test.ts
```

Expected: pass.

### Task 5: Governance for-session stale guard

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`
- Modify: `bim-review-coordinator/tests/governance-rule-run-for-session.test.ts`

**Interfaces:**
- `resolveRuleRunSessionContext(sessionId)` returns either a usable context or a stale-artifact error.
- `registerGovernanceProxy` maps stale-artifact errors to HTTP 409.

- [ ] Step 1: Write failing stale-source test.

In `governance-rule-run-for-session.test.ts`, seed a downloaded session, delete `hostLocalPath`, call:

```http
POST /api/governance/rule-runs/for-session/:sessionId
```

Expected response:

```json
{
  "error_code": "stale_session_artifact",
  "detail": "source_ifc_missing",
  "artifact_health": {
    "source_ifc_exists": false
  }
}
```

Also assert governance stub received zero requests.

- [ ] Step 2: Implement resolver outcome.

Return structured failure:

```ts
{
  ok: false,
  status: 409,
  error_code: "stale_session_artifact",
  reason: "source_ifc_missing",
  artifact_health: snapshot
}
```

- [ ] Step 3: Map resolver failure in `governanceProxy.ts`.

If resolver provides `status` and `error_code`, forward those fields. Existing 404 behavior remains for unlinked sessions and unresolved paths.

- [ ] Step 4: Run targeted test.

Run:

```powershell
npm test -- tests/governance-rule-run-for-session.test.ts
```

Expected: pass.

### Task 6: Stream Config And Review Room Health

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`
- Modify: `bim-review-coordinator/tests/local-web-view.test.ts`
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`
- Modify: `web-viewer-sample/src/console/pages.tsx`

**Interfaces:**
- Stream-config response includes `artifact_health`.
- Review Room displays stale artifact status without masking it as generic Kit failure.

- [ ] Step 1: Add backend stream-config test.

Seed a session with artifact URLs that return 404. Expected stream-config model status remains honest and includes:

```json
{
  "artifact_health": {
    "model_usdc_reachable": false,
    "mapping_reachable": false,
    "stale_reason": "derived_artifact_unreachable"
  }
}
```

- [ ] Step 2: Implement stream-config projection.

Reuse the probe service and avoid duplicate URL probe logic.

- [ ] Step 3: Add frontend DTO and UI state.

Add `artifact_health` to `coordinatorClient.ts`. In Review Room / session panels, display stale artifact state and keep mapping-dependent actions disabled when `mapping_reachable === false`.

- [ ] Step 4: Run backend and frontend targeted tests.

Run:

```powershell
npm test -- tests/local-web-view.test.ts
```

from `bim-review-coordinator`, then:

```powershell
npm test -- src/console/A1ViewerEmbed.test.tsx
```

from `web-viewer-sample`.

### Task 7: A1 UI Guard

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Modify: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

**Interfaces:**
- Consumes `IfcReadyListItem.artifact_health`.
- Produces disabled A1 run state when session source IFC is stale.

- [ ] Step 1: Add failing UI test.

Fixture: MinIO object matches an ifc-ready job with `download_status: "downloaded"`, `review_session_id`, but:

```ts
artifact_health: { source_ifc_exists: false, stale_reason: "source_ifc_missing" }
```

Expected: A1 run button disabled; visible message contains `source_ifc_missing`; `createRuleRunForSession` is not called.

- [ ] Step 2: Implement UI guard.

Existing downloaded/session gate becomes:

```ts
job.download_status === "downloaded" &&
Boolean(job.review_session_id) &&
job.artifact_health?.source_ifc_exists === true
```

- [ ] Step 3: Run targeted frontend test.

Run:

```powershell
npm test -- src/console/A1ViewerEmbed.test.tsx
```

Expected: pass.

### Task 8: End-to-End Verification In Deployed Edge Site

**Files:**
- Modify only if evidence scripts need a small helper under `scripts/dev/` or `tests/e2e/`.

**Interfaces:**
- Uses local deployed edge root:
  - code: `D:\Users\deploy\AI-bim-geo`
  - data: `D:\Users\deploy\AI-bim-geo-data`

- [ ] Step 1: Rebuild deployed test site.

Run from repo root:

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

Expected: deploy succeeds and preserves `D:\Users\deploy\AI-bim-geo-data`.

- [ ] Step 2: Generate a fresh IFC-ready session.

Use the existing MinIO watcher or default local IFC source; record:

- `ifc_ready_job_id`
- `review_session_id`
- `conversion_job_id`
- `artifact_health.checked_at`

- [ ] Step 3: Verify healthy path.

Expected:

- `source_ifc_exists === true`
- `model_usdc_reachable === true`
- `mapping_reachable === true`
- A1 rule-run starts successfully through for-session.

- [ ] Step 4: Verify stale path.

Move the source IFC or derived artifact aside under `D:\Users\deploy\AI-bim-geo-data`, then retry A1 or Review Room.

Expected:

- A1 returns or displays `stale_session_artifact`.
- Review Room marks `model_usdc_reachable` or `mapping_reachable` false.
- No governance-service rule-run starts for missing source IFC.

## Verification Gates

- `npm test -- tests/artifact-health-ledger.test.ts`
- `npm test -- tests/artifact-health-probe.test.ts`
- `npm test -- tests/governance-rule-run-for-session.test.ts`
- `npm test -- tests/external-ifc-ready.test.ts tests/conversion-ledger-intake-integration.test.ts`
- `npm test -- tests/local-web-view.test.ts`
- `npm test -- src/console/A1ViewerEmbed.test.tsx`
- `npm run build` in `bim-review-coordinator`
- `npm run build` in `web-viewer-sample`
- `git diff --check`
- GitNexus `detect_changes` before commit

## Issue Brief

**Title:** Persist edge-local artifact health and block stale A1 / Review Room sessions

**Problem:** Coordinator can report `downloaded` / `ready` from volatile session/job metadata even after the deployed edge checkout has lost `source.ifc`, `model.usdc`, or `element_mapping.json`. Governance then fails with `ifc_source_path not found`, and Review Room shows artifact URLs that return 404.

**Fix:** Add edge-local artifact health persistence outside the git-cleaned deployment checkout, refresh health at use time, expose honest health fields to UI, and block stale sessions before backend/runtime calls.

**Non-goals:** Do not upload IFC/USD payload to cloud. Do not make cloud control plane an artifact store. Do not add a new database dependency in the first slice.

## Self-Review

- Spec coverage: covers edge-local persistence, cloud metadata-only projection, deployed test edge root, A1 stale-source guard, Review Room derived artifact reachability, and tests.
- Placeholder scan: no banned placeholder markers, no unspecified file path, no generic test step without exact test targets.
- Type consistency: `ArtifactHealthSnapshot`, `EdgeArtifactRecord`, and `CloudArtifactProjection` names are stable across tasks.
