# A1 MinIO Worktree Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve overlap between `feat/minio-a1-governance-traceability` and `rebuild/a1-minio-plan-superpower` without regressing MinIO IFC lineage, history, and traceability.

**Architecture:** Use `feat/minio-a1-governance-traceability` as the canonical implementation branch because it is a semantic superset of the queue-only `/for-ifc-ready` flow. Treat `rebuild/a1-minio-plan-superpower` as an input branch for E2E/docs ideas only; do not wholesale merge overlapping coordinator/viewer files.

**Tech Stack:** TypeScript/Express coordinator, React/Vitest viewer console, FastAPI/sqlite governance-service, Playwright E2E, PowerShell/git.

## Global Constraints

- Do not accept parallel versions of overlapping files with `take theirs`.
- Do not remove coordinator-injected `source_metadata`.
- Do not remove governance-service rule-run history filtering.
- Do not remove A1 MinIO history/lineage UI.
- Do not port unrelated `scripts/deploy.ps1` Kit timeout changes under this A1 governance conflict plan.
- Do not expose host paths, local paths, presigned URLs, or secrets in browser-visible history/results.

---

### Task 1: Freeze Conflict Decision

**Files:**
- Modify: `.workflow/ultracode/a1-minio-worktree-conflict-review/results/05-integration-decision.md`
- Modify: `.workflow/ultracode/a1-minio-worktree-conflict-review/state.json`

**Interfaces:**
- Consumes: Git inventory and reviewer-agent evidence from this workflow.
- Produces: Written decision that current branch is canonical and parallel branch is input-only.

- [x] **Step 1: Verify overlap evidence**

Run:

```powershell
$cur='C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-a1-governance-traceability'
$other='C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-minio-plan-superpower'
$curFiles = git -c safe.directory=$cur -C $cur diff --name-only
$otherFiles = git -c safe.directory=$other -C $other diff --name-only main...HEAD
Compare-Object $curFiles $otherFiles -IncludeEqual -ExcludeDifferent
```

Expected: equal entries include coordinator `app.ts`, `governanceProxy.ts`, coordinator rule-run test, viewer A1 test, viewer `governanceClient.ts`, and viewer `pages.tsx`.

- [x] **Step 2: Confirm decision text**

Ensure the decision says:

```txt
Do not merge rebuild/a1-minio-plan-superpower wholesale.
Use feat/minio-a1-governance-traceability as canonical implementation base.
Port only missing E2E/docs artifacts after review.
```

Expected: no product-code change in this task.

### Task 2: Port Missing Browser E2E Only If Absent

**Files:**
- Modify: `web-viewer-sample/e2e/a1-minio-local-resolution.spec.ts`

**Interfaces:**
- Consumes: existing `governanceClient.createRuleRunForIfcReady` and A1 `ifc-ready://` UI path.
- Produces: Playwright coverage that a downloaded MinIO IFC-ready job without review session uses `/api/governance/rule-runs/for-ifc-ready/:jobId`.

- [x] **Step 1: Check whether equivalent test already exists**

Run:

```powershell
rg -n "for-ifc-ready|NO_SESSION_JOB_ID|without review session" web-viewer-sample/e2e/a1-minio-local-resolution.spec.ts
```

Expected: if an equivalent no-session E2E exists, skip this task and record that no port was needed.

- [x] **Step 2: If absent, add one focused Playwright test**

Add a test named:

```ts
test("A1 MinIO downloaded job without review session uses coordinator for-ifc-ready rule-run", async ({ page }) => {
  // Route runtime/status with no active sessions.
  // Route /api/minio/objects with one source_ifc object.
  // Route /api/external/ifc-ready with one downloaded job whose review_session_id is null.
  // Assert A1 selects the MinIO object, enables pick/run, calls /for-ifc-ready/:jobId,
  // does not call /for-session and does not call direct /api/governance/rule-runs.
});
```

Expected: test asserts no direct MinIO key is sent as `ifc_source_path`.

Execution note: the test was already present in current and byte-identical to the parallel worktree copy. The only missing gap was the UI wording `coordinator ifc-ready proxy`, which was ported into `web-viewer-sample/src/console/pages.tsx`.

- [x] **Step 3: Run targeted E2E when dev server/test harness is available**

Run:

```powershell
cd web-viewer-sample
npm run test:e2e -- a1-minio-local-resolution.spec.ts
```

Expected: Playwright test passes or the failure is recorded with environment reason.

Execution note: Playwright printed both A1 MinIO E2E tests as `ok`, but the wrapper command timed out after test completion. No `:5180` listener was left behind.

### Task 3: Preserve Lineage/History Regression Guards

**Files:**
- Test: `governance-service/tests/test_api.py`
- Test: `bim-review-coordinator/tests/governance-rule-run-for-session.test.ts`
- Test: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

**Interfaces:**
- Consumes: `source_metadata`, `GET /api/rule-runs`, A1 history UI, stale handoff reset.
- Produces: confidence that conflict resolution did not downgrade traceability.

- [x] **Step 1: Run governance-service tests**

Run:

```powershell
cd governance-service
python -m pytest tests/test_api.py
```

Expected: tests covering `source_metadata`, history filters, and unsafe metadata keys pass.

- [x] **Step 2: Run coordinator rule-run proxy tests**

Run:

```powershell
cd bim-review-coordinator
npm test -- governance-rule-run-for-session.test.ts
```

Expected: tests covering `/for-session`, `/for-ifc-ready`, and metadata forwarding pass.

- [x] **Step 3: Run viewer A1 tests**

Run:

```powershell
cd web-viewer-sample
npm test -- A1ViewerEmbed.test.tsx
```

Expected: tests covering `/for-ifc-ready`, lineage display, history query, and stale handoff reset pass.

### Task 4: Close Parallel Worktree Decision

**Files:**
- Modify: `.workflow/ultracode/a1-minio-worktree-conflict-review/state.json`

**Interfaces:**
- Consumes: results from Tasks 1-3.
- Produces: final workflow status and explicit disposition for `rebuild/a1-minio-plan-superpower`.

- [x] **Step 1: Record final disposition**

Set workflow state to:

```json
{
  "status": "completed",
  "final_gate": {
    "parent_integrated": true,
    "verification_evidence_present": true,
    "completion_claim_allowed": true
  }
}
```

Expected: final response can say whether product code was changed or only conflict-review artifacts were written.

- [x] **Step 2: Leave branch cleanup to explicit user approval**

Do not delete or reset the parallel worktree. The safe follow-up command, only after user approval, is:

```powershell
git worktree remove C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-minio-plan-superpower
```

Expected: no destructive cleanup is performed during this conflict review.

Execution note: user explicitly requested final cleanup for both branches. Destructive worktree/branch cleanup still must happen only after the current branch is safely committed/merged or otherwise preserved.
