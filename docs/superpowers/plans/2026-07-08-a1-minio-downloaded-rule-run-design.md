# A1 MinIO Downloaded IFC Rule-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let A1 queue a governance CPU rule-run for an existing downloaded MinIO IFC-ready job even when no Review Room session exists.

**Architecture:** The browser never sends a MinIO key, browser path, host path, or downloaded artifact path to governance-service. A1 joins the selected MinIO `source_ifc` object to coordinator `ifc-ready` inventory by `idempotency_key`, locks either `session://<sessionId>` or `ifc-ready://<jobId>`, and calls the matching coordinator proxy. The coordinator alone resolves `ifc_source_path` from `ExternalIfcReadyStore`, validates it with the existing server-side source-path check, and forwards the rule-run request to loopback governance-service.

**Tech Stack:** TypeScript, Express, React 18, Vitest, Playwright; reuse existing `coordinatorClient`, `governanceClient`, `ExternalIfcReadyStore`, and governance proxy helpers; no new production dependency.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-07-08-a1-minio-downloaded-rule-run-design.md`.
- Session-backed MinIO jobs keep using `POST /api/governance/rule-runs/for-session/:sessionId`.
- Downloaded no-session MinIO jobs use `POST /api/governance/rule-runs/for-ifc-ready/:jobId`.
- A1 must not create a Review Room session.
- A1 must not trigger IFC->USD conversion.
- A1 must not claim Kit/WebRTC or 3D visual E2E completion.
- Browser must send only the non-secret `ifc_ready_job_id` for no-session downloaded jobs.
- `ifc_ready_job_id` is not an authorization token; do not expose the route as multi-tenant/public without coordinator user/tenant auth.
- Stale or missing downloaded source IFC must block rule-run and show the stale reason; do not fall back to direct browser paths or MinIO keys.
- When A1 locks an `ifc-ready://<jobId>` source, later manual session selection must not silently reroute the run.
- Modify code symbols only after GitNexus impact; before commit run GitNexus detect_changes.

---

## Implementation State

The source spec records this behavior as implemented in PR #316 (`fix/a1-minio-downloaded-rule-run`). The checkboxes below are marked complete to document the implemented slice at commit `13836280aa8efcc84fadeea03fb49e10b8f30204`. If this plan is reused to rebuild the slice from an earlier commit, clear the checkboxes before execution.

## File Structure

- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`
  - Add `POST /api/governance/rule-runs/for-ifc-ready/:jobId`.
  - Reuse `sendSessionResolutionFailure()` and `forwardResolvedRuleRun()` so session and ifc-ready routes share response and forwarding behavior.
- Modify: `bim-review-coordinator/src/app.ts`
  - Add `isSafeIfcReadyJobId()` wiring to governance proxy deps.
  - Add `resolveDownloadedJobForRuleRun()` and `resolveRuleRunIfcReadyContext` dependency wiring.
- Modify: `bim-review-coordinator/tests/governance-rule-run-for-session.test.ts`
  - Cover invalid job id, downloaded no-session success, download-not-ready failure, and stale source IFC failure.
- Modify: `web-viewer-sample/src/console/governanceClient.ts`
  - Add `createRuleRunForIfcReady(ifcReadyJobId, body)` client method.
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`
  - Ensure `IfcReadyListItem` exposes `download_status`, `download_failure`, `source_ifc_etag`, `review_session_id`, `artifact_health`, and `idempotency_key` for A1 gating.
- Modify: `web-viewer-sample/src/console/pages.tsx`
  - Let A1 pick downloaded MinIO jobs without session by locking `ifc-ready://<jobId>`.
  - Keep session-backed jobs on `session://<sessionId>`.
  - Recheck downloaded source IFC health immediately before run.
- Modify: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`
  - Cover no-session ifc-ready proxy, non-rerouting after manual session selection, and stale/missing guards.
- Test: `web-viewer-sample/e2e/a1-minio-local-resolution.spec.ts`
  - Browser-level evidence for A1 MinIO local resolution and scoreboard path.

---

### Task 1: Coordinator Contract Tests

**Files:**
- Modify: `bim-review-coordinator/tests/governance-rule-run-for-session.test.ts`

**Interfaces:**
- Consumes: existing `makeApp()`, `startGovernanceStub()`, `startIfcSourceStub()`, `seedDownloadedIfcWithoutSession()`, `seedFailedDownloadIfcWithoutSession()` test helpers.
- Produces: contract coverage for `POST /api/governance/rule-runs/for-ifc-ready/:jobId`.

- [x] **Step 1: Add red test for invalid ifc-ready job id**

Add this test inside a new `describe("POST /api/governance/rule-runs/for-ifc-ready/:jobId", ...)` block:

```ts
it("無效 ifc-ready job id 格式 → 400，且不打 governance-service", async () => {
  const gov = await startGovernanceStub();
  process.env.GOVERNANCE_API_BASE = gov.baseUrl;
  const app = makeApp();

  const res = await request(app.app)
    .post("/api/governance/rule-runs/for-ifc-ready/..%2Fetc")
    .send({});

  expect(res.status).toBe(400);
  expect(gov.bodies).toHaveLength(0);
});
```

- [x] **Step 2: Add red test for downloaded no-session success**

```ts
it("解析 downloaded ifc-ready job 的 host-side IFC 路徑並透傳給 governance-service，不需要 review session", async () => {
  const gov = await startGovernanceStub();
  process.env.GOVERNANCE_API_BASE = gov.baseUrl;
  const ifcSourceUrl = await startIfcSourceStub();
  const app = makeApp({ ifcDownloadStrict: true });

  const { ifcReadyJobId, hostLocalPath } = await seedDownloadedIfcWithoutSession(app, ifcSourceUrl);

  const res = await request(app.app)
    .post(`/api/governance/rule-runs/for-ifc-ready/${ifcReadyJobId}`)
    .send({ ids_path: "/rules/fire.ids" });

  expect(res.status).toBe(202);
  expect(res.body).toEqual({ rule_run_id: "rr_stub_001", status: "queued" });
  expect(gov.bodies).toHaveLength(1);
  expect(gov.bodies[0]).toMatchObject({
    ifc_source_path: hostLocalPath,
    model_version_id: "version_demo_001",
    ids_path: "/rules/fire.ids",
  });
  expect(JSON.stringify(res.body)).not.toMatch(/local_path|host_local_path|edge_relative_path|public_url/);
});
```

- [x] **Step 3: Add red tests for not-downloaded and stale source IFC failures**

```ts
it("download failed job → 404，且不打 governance-service、不外洩 host path", async () => {
  const gov = await startGovernanceStub();
  process.env.GOVERNANCE_API_BASE = gov.baseUrl;
  const app = makeApp({ ifcDownloadStrict: true });

  const { ifcReadyJobId } = await seedFailedDownloadIfcWithoutSession(app);
  const res = await request(app.app)
    .post(`/api/governance/rule-runs/for-ifc-ready/${ifcReadyJobId}`)
    .send({});

  expect(res.status).toBe(404);
  expect(res.body.detail).toMatch(/not been downloaded/i);
  expect(gov.bodies).toHaveLength(0);
  expect(JSON.stringify(res.body)).not.toMatch(/local_path|host_local_path|edge_relative_path|public_url/);
});

it("downloaded no-session job 的 source IFC 被刪除 → 409 stale_session_artifact，且不打 governance-service、不外洩 host path", async () => {
  const gov = await startGovernanceStub();
  process.env.GOVERNANCE_API_BASE = gov.baseUrl;
  const ifcSourceUrl = await startIfcSourceStub();
  const app = makeApp({ ifcDownloadStrict: true });

  const { ifcReadyJobId, hostLocalPath } = await seedDownloadedIfcWithoutSession(app, ifcSourceUrl);
  fs.rmSync(hostLocalPath, { force: true });

  const res = await request(app.app)
    .post(`/api/governance/rule-runs/for-ifc-ready/${ifcReadyJobId}`)
    .send({});

  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({
    error_code: "stale_session_artifact",
    detail: "source_ifc_missing",
    artifact_health: {
      source_ifc_exists: false,
      stale_reason: "source_ifc_missing",
    },
  });
  expect(gov.bodies).toHaveLength(0);
  expect(JSON.stringify(res.body)).not.toMatch(/local_path|host_local_path|edge_relative_path|public_url/);
});
```

- [x] **Step 4: Run coordinator tests and verify they fail before implementation**

Run from `bim-review-coordinator`:

```powershell
npm run test -- tests/governance-rule-run-for-session.test.ts
```

Expected before implementation: at least the `for-ifc-ready` tests fail with 404 or missing route.

---

### Task 2: Coordinator Route And Resolver

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`

**Interfaces:**
- Consumes: `ExternalIfcReadyStore.get(jobId)`, `checkSourceIfcPath()`, `markSourceIfcUnavailable()`, `forwardResolvedRuleRun()`.
- Produces: `resolveRuleRunIfcReadyContext(jobId): RuleRunSessionResolution` and route `POST /api/governance/rule-runs/for-ifc-ready/:jobId`.

- [x] **Step 1: Add safe job id adapter in `app.ts`**

```ts
// conv-prioritize-retry:ifc_ready_job_id 形狀 ifcready_<ts>_<hex>，落在同一通用字元集。
// 為語意清楚另命名；實作共用 isSafeConversionJobId 的 regex。
export function isSafeIfcReadyJobId(value: string): boolean {
  return isSafeConversionJobId(value);
}
```

- [x] **Step 2: Add downloaded job resolver in `app.ts` before `registerGovernanceProxy(...)`**

```ts
function resolveDownloadedJobForRuleRun(
  job: IfcReadyIntakeJob | null | undefined,
  modelVersionId: string | null | undefined,
  session: ReviewSession | null = null,
): RuleRunSessionResolution {
  if (!job) {
    return { ok: false, reason: "IFC-ready job not found." };
  }
  if (job.download_status !== "downloaded") {
    return { ok: false, reason: "IFC-ready job has not been downloaded to a server-side path yet." };
  }
  const ifcSourcePath = job.host_local_path || job.local_path || null;
  if (!ifcSourcePath) {
    return {
      ok: false,
      reason: "IFC for this job has not been downloaded to a server-side path yet.",
    };
  }
  const sourceCheck = checkSourceIfcPath(ifcSourcePath, config.storageHostRoot, config.edgeRuntimeDataRoot);
  if (sourceCheck.value !== true) {
    return {
      ok: false,
      error_code: "stale_session_artifact",
      detail: "source_ifc_missing",
      artifact_health: markSourceIfcUnavailable(job, session, sourceCheck.failure ?? "source_ifc_missing"),
    };
  }
  return {
    ok: true,
    context: {
      ifc_source_path: ifcSourcePath,
      model_version_id: modelVersionId,
      ifc_ready_job_id: job.ifc_ready_job_id,
    },
  };
}
```

- [x] **Step 3: Wire `resolveRuleRunIfcReadyContext` into `registerGovernanceProxy`**

```ts
registerGovernanceProxy(app, {
  isSafeSessionId,
  isSafeIfcReadyJobId,
  resolveRuleRunIfcReadyContext: (jobId) => {
    const job = externalIfcReadyStore.get(jobId);
    return resolveDownloadedJobForRuleRun(job, job?.external_model_version_id ?? null);
  },
  resolveRuleRunSessionContext: (sessionId) => {
    const session = store.get(sessionId);
    if (!session) {
      return { ok: false, reason: "Review session not found." };
    }
    const job = latestIfcReadyJobForSession(sessionId);
    if (!job) {
      return {
        ok: false,
        reason:
          "No IFC-ready job linked to this session; rule-run requires an IFC ingested via /api/external/ifc-ready.",
      };
    }
    return resolveDownloadedJobForRuleRun(job, session.model_version_id, session);
  },
});
```

- [x] **Step 4: Add `for-ifc-ready` route in `governanceProxy.ts`**

```ts
app.post("/api/governance/rule-runs/for-ifc-ready/:jobId", (request, response) => {
  const jobId = request.params.jobId;
  const isSafe = deps.isSafeIfcReadyJobId ?? (() => true);
  if (!isSafe(jobId)) {
    response.status(400).json({ detail: "Invalid ifc-ready job id." });
    return;
  }
  if (!deps.resolveRuleRunIfcReadyContext) {
    response.status(501).json({ detail: "ifc-ready IFC resolution is not configured." });
    return;
  }
  const resolution = deps.resolveRuleRunIfcReadyContext(jobId);
  if (!resolution.ok) {
    sendSessionResolutionFailure(response, resolution);
    return;
  }
  const overrideBody = (request.body ?? {}) as { ids_path?: unknown; rule_set?: unknown };
  forwardResolvedRuleRun(response, resolution.context, overrideBody);
});
```

- [x] **Step 5: Run coordinator verification**

Run from `bim-review-coordinator`:

```powershell
npm run verify
```

Expected after implementation: PASS.

---

### Task 3: Frontend Client And DTO Support

**Files:**
- Modify: `web-viewer-sample/src/console/governanceClient.ts`
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`

**Interfaces:**
- Consumes: coordinator endpoint `POST /api/governance/rule-runs/for-ifc-ready/:jobId`.
- Produces: `governanceClient.createRuleRunForIfcReady(ifcReadyJobId, body)` and A1-readable `IfcReadyListItem` metadata.

- [x] **Step 1: Add governance client method**

```ts
createRuleRunForIfcReady: (ifcReadyJobId: string, body?: { ids_path?: string; rule_set?: string }) =>
  jsonFetch<{ rule_run_id: string; status: string }>(
    `/api/governance/rule-runs/for-ifc-ready/${encodeURIComponent(ifcReadyJobId)}`,
    { method: "POST", body: JSON.stringify(body ?? {}) }
  ),
```

- [x] **Step 2: Ensure `IfcReadyListItem` carries A1 gating fields**

```ts
export interface IfcReadyListItem {
  ifc_ready_job_id: string;
  status: string;
  project_id: string;
  external_model_version_id: string;
  download_status: string | null;
  download_failure?: string | null;
  source_ifc_etag?: string | null;
  conversion_status: string | null;
  conversion_authority: string | null;
  queue_position: number | null;
  conversion_job_id: string | null;
  dispatch_error: string | null;
  review_session_id: string | null;
  viewer_url: string | null;
  expected_stage_url: string | null;
  expected_mapping_url: string | null;
  artifact_health?: ArtifactHealthSnapshot | null;
  created_at: string;
  idempotency_key?: string;
  idempotent_replay?: boolean;
  project_display_name?: string | null;
  category?: string | null;
  conversion_lifecycle_status?: ConversionLifecycleStatus | null;
  failure_reason?: string | null;
  failure_stage?: "download" | "dispatch" | "conversion" | "callback" | "key_malformed" | null;
  usdc_role?: "source_ifc" | "parsed_usdc" | "pending" | null;
  data_volatility?: "in_memory_volatile" | "persisted" | null;
  updated_at: string;
}
```

- [x] **Step 3: Run frontend type/unit verification for client changes**

Run from `web-viewer-sample`:

```powershell
npm run verify
```

Expected after implementation: PASS.

---

### Task 4: A1 MinIO Pick And Run Behavior

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Modify: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

**Interfaces:**
- Consumes: `coordinatorClient.getMinioObjects()`, `coordinatorClient.listIfcReady(100)`, `governanceClient.createRuleRunForSession()`, `governanceClient.createRuleRunForIfcReady()`.
- Produces: A1 locked source markers `session://<sessionId>` and `ifc-ready://<jobId>`.

- [x] **Step 1: Add A1 no-session UI test**

```ts
it("downloaded MinIO object without review session runs through coordinator ifc-ready proxy", async () => {
  vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
    count: 1,
    items: [fakeIfcReadyJob({ review_session_id: null })],
  });
  const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("MinIO key must not be sent directly"));
  const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("review session should not be required"));
  const forIfcReadySpy = vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
  vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
  vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

  await renderA1();
  await selectMinioSource();

  expect(q("a1-minio-resolution-note")?.textContent).toContain("POST /api/governance/rule-runs/for-ifc-ready");
  expect(q("a1-minio-resolution-note")?.textContent).toContain("governance rule-run queue");
  const pick = q<HTMLButtonElement>("a1-step-pick")!;
  expect(pick.disabled).toBe(false);

  await act(async () => { pick.click(); });
  await flush();

  const run = q<HTMLButtonElement>("a1-step-run")!;
  expect(run.disabled).toBe(false);

  await act(async () => { run.click(); });
  await flush();
  expect(forIfcReadySpy).toHaveBeenCalledWith("ifcready_1", {
    ids_path: expect.stringContaining("sample-fire-rating.ids"),
  });
  expect(directRunSpy).not.toHaveBeenCalled();
  expect(forSessionSpy).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Add non-rerouting UI test**

```ts
it("locked ifc-ready MinIO source is not rerouted through a manually selected review session", async () => {
  vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
    count: 1,
    items: [fakeIfcReadyJob({ review_session_id: null })],
  });
  const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("MinIO key must not be sent directly"));
  const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("locked ifc-ready source must not be rerouted through session"));
  const forIfcReadySpy = vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
  vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
  vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

  await renderA1();
  await selectMinioSource();
  await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
  await flush();
  await selectSession(REVIEW_SESSION_ID);

  const run = q<HTMLButtonElement>("a1-step-run")!;
  expect(run.textContent).toContain("POST /api/governance/rule-runs/for-ifc-ready/:jobId");
  await act(async () => { run.click(); });
  await flush();

  expect(forIfcReadySpy).toHaveBeenCalledWith("ifcready_1", {
    ids_path: expect.stringContaining("sample-fire-rating.ids"),
  });
  expect(directRunSpy).not.toHaveBeenCalled();
  expect(forSessionSpy).not.toHaveBeenCalled();
});
```

- [x] **Step 3: Implement MinIO downloaded/no-session pick logic**

Use these derived values in `A1GovernanceWorkbenchPage()`:

```ts
const selectedMinioJob = selectedMinioObject && ifcReadyJobs
  ? ifcReadyJobs.find((job) => job.idempotency_key === selectedMinioObject.idempotency_key) ?? null
  : null;
const selectedMinioSessionId = selectedMinioJob?.review_session_id ?? "";
const selectedMinioDownloaded = selectedMinioJob?.download_status === "downloaded";
const selectedMinioSourceIfcReady = selectedMinioJob?.artifact_health?.source_ifc_exists === true;
const selectedMinioJobId = selectedMinioJob?.ifc_ready_job_id ?? "";
const canPickMinioDownloaded = sourceKind === "minio" && Boolean(
  selectedMinioObject && selectedMinioDownloaded && selectedMinioJobId && selectedMinioSourceIfcReady,
);
```

- [x] **Step 4: Lock `ifc-ready://<jobId>` when no review session exists**

```tsx
<Btn data-testid="a1-step-pick" disabled={!canPickMinioDownloaded}
  caption={canPickMinioDownloaded ? t("鎖定 downloaded IFC job；coordinator 會解析 server-local IFC path", "Lock the downloaded IFC job; the coordinator resolves the server-local IFC path") : selectedMinioResolutionNote}
  onClick={() => {
    if (!canPickMinioDownloaded || !selectedMinioObject || !selectedMinioJob) return;
    setActionErr(null);
    setA1Issues([]);
    setSelectedSession(selectedMinioSessionId);
    dispatch({
      type: "PICK_FILE",
      ifcPath: selectedMinioSessionId ? `session://${selectedMinioSessionId}` : `ifc-ready://${selectedMinioJob.ifc_ready_job_id}`,
      modelVersionId: selectedMinioJob.external_model_version_id || selectedMinioObject.version || selectedMinioObject.key,
    });
  }}>
  {selectedMinioPickLabel}
</Btn>
```

- [x] **Step 5: Route run submission by locked source marker**

```ts
const ifcReadyJobId = state.ifcPath.startsWith("ifc-ready://")
  ? state.ifcPath.slice("ifc-ready://".length)
  : "";
const { rule_run_id } = ifcReadyJobId
  ? await governanceClient.createRuleRunForIfcReady(ifcReadyJobId, { ids_path: idsPath || undefined })
  : selectedSession
    ? await governanceClient.createRuleRunForSession(selectedSession, { ids_path: idsPath || undefined })
    : await governanceClient.createRuleRun(runRequest);
```

- [x] **Step 6: Recheck source IFC health immediately before run**

```ts
if (state.ifcPath.startsWith("session://") || state.ifcPath.startsWith("ifc-ready://")) {
  const refreshedJobs = await refreshIfcReadyJobs();
  if (pollGenRef.current !== myGen) return;
  const expectedIfcReadyJobId = state.ifcPath.startsWith("ifc-ready://")
    ? state.ifcPath.slice("ifc-ready://".length)
    : "";
  const refreshedJob = selectedMinioObject?.idempotency_key
    ? refreshedJobs.find((job) => job.idempotency_key === selectedMinioObject.idempotency_key) ?? null
    : expectedIfcReadyJobId
      ? refreshedJobs.find((job) => job.ifc_ready_job_id === expectedIfcReadyJobId) ?? null
      : refreshedJobs.find((job) => job.review_session_id === selectedSession) ?? null;
  const refreshedSourceIfcReady =
    refreshedJob?.download_status === "downloaded"
    && (!state.ifcPath.startsWith("session://") || refreshedJob.review_session_id === selectedSession)
    && (!expectedIfcReadyJobId || refreshedJob.ifc_ready_job_id === expectedIfcReadyJobId)
    && refreshedJob.artifact_health?.source_ifc_exists === true;
  if (!refreshedSourceIfcReady) {
    const staleReason = refreshedJob?.artifact_health?.stale_reason
      ?? (refreshedJob?.artifact_health?.source_ifc_exists === false ? "source_ifc_exists=false" : "source_ifc_exists=unknown");
    dispatch({ type: "RUN_FAIL", error: `source IFC artifact stale before rule-run: ${staleReason}` });
    return;
  }
}
```

- [x] **Step 7: Run A1 frontend tests**

Run from `web-viewer-sample`:

```powershell
npm run test:session-first
```

Expected after implementation: PASS.

---

### Task 5: Browser E2E And Final Verification

**Files:**
- Test: `web-viewer-sample/e2e/a1-minio-local-resolution.spec.ts`
- No runtime source edits in this task.

**Interfaces:**
- Consumes: built frontend route `/#a1`, coordinator APIs under `:8004`, Playwright fixtures.
- Produces: browser-visible proof that A1 shows the ifc-ready proxy path and scoreboard after run.

- [x] **Step 1: Run targeted Playwright E2E**

Run from `web-viewer-sample`:

```powershell
npx playwright test e2e/a1-minio-local-resolution.spec.ts --reporter=list
```

Expected after implementation: PASS with visible A1 no-session downloaded job path.

- [x] **Step 2: Run repo whitespace check**

Run from repo root:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [x] **Step 3: Run GitNexus detect changes before commit**

Run from repo root:

```powershell
gitnexus detect-changes --scope staged --repo AI-BIM-governance
```

Expected: HIGH risk is acceptable and expected because the slice touches coordinator governance proxy and A1 user-facing route behavior; no unexpected files or unrelated execution flows should appear.

- [x] **Step 4: Final validation matrix**

Record this evidence in the PR or final closeout:

```txt
bim-review-coordinator npm run verify
web-viewer-sample npm run verify
web-viewer-sample npm run test:session-first
web-viewer-sample npx playwright test e2e/a1-minio-local-resolution.spec.ts --reporter=list
git diff --check
gitnexus detect-changes --scope staged --repo AI-BIM-governance
```

Expected: all pass, with the caveat that this is CPU governance E2E evidence only and does not claim Kit/WebRTC visual/runtime E2E completion.

---

## Self-Review

**Spec coverage:** The plan covers coordinator no-session path resolution, browser-only `ifc_ready_job_id`, stale/missing source IFC blocking, old session route preservation, non-rerouting after `ifc-ready://<jobId>` lock, and validation evidence.

**Placeholder scan:** No task contains unresolved marker language or generic edge-case instructions without concrete code.

**Type consistency:** The plan consistently uses `ifc_ready_job_id`, `idempotency_key`, `download_status`, `review_session_id`, `artifact_health.source_ifc_exists`, `createRuleRunForIfcReady()`, `createRuleRunForSession()`, `session://<sessionId>`, and `ifc-ready://<jobId>`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-08-a1-minio-downloaded-rule-run-design.md`. Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Because the source spec is already implemented in PR #316, use this file primarily as implementation evidence or as a rebuild plan for older commits.
