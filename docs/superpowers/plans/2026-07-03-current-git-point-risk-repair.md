# Current Git Point Risk Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Completion Record

- Implemented by commit `801bc7c fix: surface mapping diagnostics in A1 handoff`.
- Merged into `main` by fast-forward and pushed to `origin/main` on 2026-07-03.
- Targeted verification passed on merged `main`:
  - `bim-review-coordinator`: `npm test -- tests/build-quality-metrics-summary.test.ts tests/conversion-ledger-intake-integration.test.ts`
  - `bim-review-coordinator`: `npm run build`
  - `web-viewer-sample`: `npm test -- src/console/A1ViewerEmbed.test.tsx src/console/ReviewSessionViewerPane.test.tsx`
  - `web-viewer-sample`: `npm run build`
- Cleanup completed for the implementation worktree/branch. Residual caveat: `.worktrees/a1-3d-review-decouple` is an empty OS-locked directory, while the local branch and Git worktree registry entry are gone.

**Goal:** Safely remove the stale A1 decouple branch residue and repair the current mainline risks around mapping-incomplete diagnostics, failed conversion ledger coverage, and A1 Review Room handoff behavior.

**Architecture:** Keep the stale branch cleanup separate from product code. Product changes are additive: streaming conversion continues to own mapping-quality facts, the coordinator forwards those facts without recomputing them, and the console/Review Room renders honest diagnostics while keeping highlight disabled without `usd_prim_path`.

**Tech Stack:** Git worktrees, PowerShell, TypeScript, Vitest, React, Python pytest, existing coordinator / web-viewer-sample / bim-streaming-server test suites.

---

## Hard Constraints

- Do not delete, clean, rebase, merge, inspect, or otherwise manage `feat/seven-axis-cross-page-harmony`. It is an active Claude Code worktree.
- Do not merge `feat/a1-3d-review-decouple` into `main`.
- Do not commit local `AGENTS.md` / `CLAUDE.md` GitNexus count churn unless the user explicitly approves.
- Do not track `artifacts/local-backups/`, `storage/`, or runtime/build artifacts.
- Do not place viewer lease tokens or credentials in URLs.

## File Structure

- `bim-review-coordinator/tests/conversion-ledger-intake-integration.test.ts`
  - Add failed terminal conversion ledger regression.
- `bim-review-coordinator/tests/build-quality-metrics-summary.test.ts`
  - Add quality summary pass-through regression for mapping-incomplete fields.
- `bim-review-coordinator/src/types.ts`
  - Extend `ConversionQualityMetricsSummary` with optional mapping-incomplete diagnostics.
- `bim-review-coordinator/src/services/streamingConversionClient.ts`
  - Forward mapping-incomplete fields from `raw.quality_metrics`.
- `web-viewer-sample/src/types/mapping.ts`
  - Add `ElementMappingIssue` and mapping-incomplete summary fields.
- `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`
  - Parse/render non-secret mapping diagnostic fields and keep highlight disabled without `usd_prim_path`.
- `web-viewer-sample/src/console/ReviewSessionViewerPane.test.tsx`
  - Add parsing and diagnostic rendering tests.
- `web-viewer-sample/src/console/pages.tsx`
  - Allow A1 to open Review Room diagnostic mode for `ifc_guid` rows missing `usd_prim_path`.
- `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`
  - Update missing mapping behavior regression.
- `docs/superpowers/specs/2026-07-03-current-git-point-risk-repair-design.md`
  - Already written; keep as approved design reference.

## Task 0: Fresh Worktree And Stale A1 Cleanup

**Files:**
- No code files.
- Delete only after preflight: `.worktrees/a1-3d-review-decouple`
- Delete only after worktree removal: local branch `feat/a1-3d-review-decouple`

- [ ] **Step 1: Start from the main workspace root**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Expected:

```txt
## main...origin/main
HEAD == origin/main == 78fea8480c7a3cdf12d454bb139500dc835f3203
```

`AGENTS.md` / `CLAUDE.md` and untracked local files may still appear. Do not add them.

- [ ] **Step 2: Create a fresh implementation worktree**

Run:

```powershell
git worktree add .worktrees/current-git-point-risk-repair -b fix/current-git-point-risk-repair origin/main
```

Expected:

```txt
Preparing worktree (new branch 'fix/current-git-point-risk-repair')
HEAD is now at 78fea84 fix(coordinator): 回填轉檔 ledger 終局狀態 (#287)
```

- [ ] **Step 3: Verify `feat/a1-3d-review-decouple` final content is still safe to delete**

Run:

```powershell
git cherry -v origin/main feat/a1-3d-review-decouple
git diff --name-status origin/main..feat/a1-3d-review-decouple -- `
  bim-review-coordinator/src/services/viewerLeaseStore.ts `
  bim-review-coordinator/tests/viewer-leases.test.ts `
  docs/superpowers/specs/2026-07-02-a1-3d-review-decouple-design.md `
  web-viewer-sample/src/console/A1ViewerEmbed.test.tsx `
  web-viewer-sample/src/console/ReviewSessionViewerPane.test.tsx `
  web-viewer-sample/src/console/ReviewSessionViewerPane.tsx `
  web-viewer-sample/src/console/console.test.tsx `
  web-viewer-sample/src/console/pages.tsx `
  web-viewer-sample/src/console/routing.test.ts `
  web-viewer-sample/src/console/routing.ts
git diff-tree --name-status -r 04e71a37057ef0ab74b8baa766e3ca0d25403841
```

Expected:

```txt
f2e41cb shows as patch-equivalent or selected final diff is empty.
No output from selected final-tree diff.
No output from diff-tree for 04e71a3.
```

- [ ] **Step 4: Verify the A1 worktree is clean**

Run:

```powershell
git -c safe.directory=C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-3d-review-decouple `
  -C C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-3d-review-decouple `
  status --short --branch --ignored
```

Expected:

```txt
## feat/a1-3d-review-decouple...origin/feat/a1-3d-review-decouple [gone]
```

Ignored artifacts may appear. Review them before force-removal. No tracked or untracked non-ignored WIP is allowed.

- [ ] **Step 5: Remove the stale A1 worktree and branch**

Run only after Step 3 and Step 4 pass:

```powershell
git worktree remove C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-3d-review-decouple
git branch -D feat/a1-3d-review-decouple
```

If `git worktree remove` refuses because only ignored build/cache artifacts remain, rerun with:

```powershell
git worktree remove --force C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-3d-review-decouple
git branch -D feat/a1-3d-review-decouple
```

Expected:

```txt
Deleted branch feat/a1-3d-review-decouple
```

- [ ] **Step 6: Confirm seven-axis was untouched**

Run:

```powershell
git worktree list
```

Expected:

```txt
.worktrees/seven-axis-cross-page-harmony remains present.
No command in this task changed feat/seven-axis-cross-page-harmony.
```

## Task 1: Failed Ledger Regression

**Files:**
- Modify: `bim-review-coordinator/tests/conversion-ledger-intake-integration.test.ts`

- [ ] **Step 1: Add failed terminal regression**

Append this test inside `describe("intake → ledger", () => { ... })`, after the ready regression:

```ts
  it("conversion result failed 後 GET /api/conversion/records 回填 failed、job id 與 coverage report", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set("X-Webhook-Secret", "test-secret")
      .set("X-Idempotency-Key", "mw_failed123456789")
      .set("X-Correlation-Id", "minio-watch-fail12")
      .send(body);

    expect(res.status).toBeLessThan(400);

    const failed = await request(app.app)
      .post("/api/internal/conversion-result")
      .set(internalHeaders())
      .send({
        correlation_id: "minio-watch-fail12",
        conversion_job_id: "stream_conv_ledger_failed",
        status: "failed",
        reason: "mapping_information_incomplete",
        retryable: false,
        artifact_summary: {
          mapping_information_status: "incomplete",
          mapping_issue_count: 1,
        },
      });
    expect(failed.status).toBe(202);

    const recs = await request(app.app).get("/api/conversion/records");
    expect(recs.status).toBe(200);

    const item = (recs.body.items as Array<{
      idempotency_key: string;
      status: string;
      conversion_job_id: string | null;
      usdc_key: string | null;
      coverage_report: { mapping_information_status?: string; mapping_issue_count?: number } | null;
    }>).find((r) => r.idempotency_key === "mw_failed123456789");

    expect(item).toBeTruthy();
    expect(item!.status).toBe("failed");
    expect(item!.conversion_job_id).toBe("stream_conv_ledger_failed");
    expect(item!.usdc_key).toBeNull();
    expect(item!.coverage_report?.mapping_information_status).toBe("incomplete");
    expect(item!.coverage_report?.mapping_issue_count).toBe(1);
  });
```

- [ ] **Step 2: Run the targeted test**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\bim-review-coordinator
npm test -- tests/conversion-ledger-intake-integration.test.ts
```

Expected:

```txt
4 tests passed
```

If it fails because the record stays `queued`, patch `ingestConversionReport()` ledger backfill in `bim-review-coordinator/src/app.ts` so failed reports call `conversionLedger.upsert()` and `conversionLedger.recordCallbackOutcome()` with `status: "failed"`.

## Task 2: Coordinator Quality Summary Pass-Through

**Files:**
- Modify: `bim-review-coordinator/tests/build-quality-metrics-summary.test.ts`
- Modify: `bim-review-coordinator/src/types.ts`
- Modify: `bim-review-coordinator/src/services/streamingConversionClient.ts`

- [ ] **Step 1: Add quality summary regression**

Add this test to `build-quality-metrics-summary.test.ts`:

```ts
  it("萃取 mapping incomplete diagnostics（coordinator 只轉發不重算）", () => {
    const s = buildQualityMetricsSummary(resultWith({
      mapping_information_status: "incomplete",
      mapping_issue_count: 1,
      mapping_issues: [{
        code: "ifc_usdc_mapping_information_incomplete",
        severity: "warning",
        message: "IFC semantic sidecar exists, but the USD stage has no joinable carriers.",
        sidecar_entry_count: 2,
        usd_prim_count: 3,
        usd_mesh_prim_count: 0,
        mapped_count: 0,
      }],
      sidecar_entry_count: 2,
      usd_mesh_prim_count: 0,
    }));

    expect(s).not.toBeNull();
    expect(s!.mapping_information_status).toBe("incomplete");
    expect(s!.mapping_issue_count).toBe(1);
    expect(s!.mapping_issues?.[0]?.code).toBe("ifc_usdc_mapping_information_incomplete");
    expect(s!.sidecar_entry_count).toBe(2);
    expect(s!.usd_mesh_prim_count).toBe(0);
  });
```

- [ ] **Step 2: Extend coordinator types**

In `bim-review-coordinator/src/types.ts`, add:

```ts
export interface ConversionMappingIssueSummary {
  code?: string;
  severity?: string;
  message?: string;
  sidecar_entry_count?: number;
  usd_prim_count?: number;
  usd_mesh_prim_count?: number;
  mapped_count?: number;
  required_join_keys?: string[];
}
```

Then extend `ConversionQualityMetricsSummary`:

```ts
  mapping_information_status?: string | null;
  mapping_issue_count?: number | null;
  mapping_issues?: ConversionMappingIssueSummary[] | null;
  usd_mesh_prim_count?: number | null;
```

`sidecar_entry_count` can reuse the existing `sidecar_carrier_count` area but must be a separate optional field if the converter emits both concepts.

- [ ] **Step 3: Forward the fields**

In `buildQualityMetricsSummary()` add an array helper:

```ts
  const objArray = (key: string): Array<Record<string, unknown>> | null => {
    const v = quality[key];
    return Array.isArray(v) && v.every((item) => item && typeof item === "object")
      ? v as Array<Record<string, unknown>>
      : null;
  };
```

Then add fields to the returned object:

```ts
    mapping_information_status: str("mapping_information_status"),
    mapping_issue_count: num("mapping_issue_count"),
    mapping_issues: objArray("mapping_issues"),
    sidecar_entry_count: num("sidecar_entry_count"),
    usd_mesh_prim_count: num("usd_mesh_prim_count"),
```

- [ ] **Step 4: Run coordinator summary tests**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\bim-review-coordinator
npm test -- tests/build-quality-metrics-summary.test.ts
```

Expected:

```txt
4 tests passed
```

## Task 3: Frontend Mapping Diagnostic Types And Review Room Rendering

**Files:**
- Modify: `web-viewer-sample/src/types/mapping.ts`
- Modify: `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`
- Modify: `web-viewer-sample/src/console/ReviewSessionViewerPane.test.tsx`

- [ ] **Step 1: Extend mapping types**

In `web-viewer-sample/src/types/mapping.ts`, add:

```ts
export interface ElementMappingIssue {
    code?: string;
    severity?: string;
    message?: string;
    sidecar_entry_count?: number;
    usd_prim_count?: number;
    usd_mesh_prim_count?: number;
    mapped_count?: number;
    required_join_keys?: string[];
}
```

Extend `ElementMappingSummary`:

```ts
    mapping_information_status?: "complete" | "incomplete" | string;
    mapping_issue_count?: number;
```

Extend `ElementMappingDocument`:

```ts
    issues?: ElementMappingIssue[];
```

- [ ] **Step 2: Extend Review Room handoff**

In `ReviewSessionViewerPane.tsx`, extend `ReviewRoomHandoff`:

```ts
  mappingInformationStatus: string | null;
  mappingIssueCode: string | null;
  mappingIssueCount: string | null;
```

Update `EMPTY_HANDOFF` and `parseReviewRoomHandoff()`:

```ts
    mappingInformationStatus: params.get("mapping_information_status"),
    mappingIssueCode: params.get("mapping_issue_code"),
    mappingIssueCount: params.get("mapping_issue_count"),
```

- [ ] **Step 3: Render mapping diagnostic**

Add a derived string:

```ts
  const mappingDiagnostic = handoff.mappingIssueCode
    ? `${handoff.mappingIssueCode}${handoff.mappingIssueCount ? ` (${handoff.mappingIssueCount})` : ""}`
    : handoff.mappingInformationStatus === "incomplete"
      ? t("mapping_information_status=incomplete", "mapping_information_status=incomplete")
      : null;
```

Use it in the missing `usd_prim_path` branch:

```ts
      ? mappingDiagnostic
        ? t(`缺 usd_prim_path / mapping：${mappingDiagnostic}`, `missing usd_prim_path / mapping: ${mappingDiagnostic}`)
        : t("缺 usd_prim_path / mapping，需先補 mapping artifact", "missing usd_prim_path / mapping")
```

Add Fields in the handoff summary:

```tsx
            <Field k="mapping status" v={handoff.mappingInformationStatus ?? "—"} prov={handoff.mappingInformationStatus ? "asbuilt" : "p1"} />
            <Field k="mapping issue" v={mappingDiagnostic ?? "—"} prov={mappingDiagnostic ? "asbuilt" : "p1"} />
```

- [ ] **Step 4: Add Review Room tests**

In `ReviewSessionViewerPane.test.tsx`, update the `handoff` fixture with:

```ts
  mappingInformationStatus: null,
  mappingIssueCode: null,
  mappingIssueCount: null,
```

Add parse test expectation:

```ts
const parsed = parseReviewRoomHandoff("#review?source=a1&session=review_session_x&ifc_guid=g1&mapping_information_status=incomplete&mapping_issue_code=ifc_usdc_mapping_information_incomplete&mapping_issue_count=1");
expect(parsed.mappingInformationStatus).toBe("incomplete");
expect(parsed.mappingIssueCode).toBe("ifc_usdc_mapping_information_incomplete");
expect(parsed.mappingIssueCount).toBe("1");
```

Update the missing `usd_prim_path` test:

```ts
    await renderPane({
      ...handoff,
      usdPrimPath: null,
      mappingInformationStatus: "incomplete",
      mappingIssueCode: "ifc_usdc_mapping_information_incomplete",
      mappingIssueCount: "1",
    });
```

Assert:

```ts
    expect(q("review-room-highlight-reason")?.textContent).toContain("ifc_usdc_mapping_information_incomplete");
    expect(q("review-room-handoff-summary")?.textContent).toContain("incomplete");
```

- [ ] **Step 5: Run Review Room tests**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\web-viewer-sample
npm test -- src/console/ReviewSessionViewerPane.test.tsx
```

Expected:

```txt
all ReviewSessionViewerPane tests passed
```

## Task 4: A1 Missing Mapping Opens Review Room Diagnostic Mode

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Modify: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

- [ ] **Step 1: Update A1 gating**

In `a1ReviewRoomHandoffReason()`, remove the `usd_prim_path` blocking branch:

```ts
function a1ReviewRoomHandoffReason(row: RuleResultRow | null | undefined, selectedSession: string): string {
  if (!selectedSession) return t("尚未選取 review session", "No review session selected yet");
  if (!row) return t("尚無失敗構件可交給 Review Room", "No failed element to hand off to Review Room");
  if (!row.ifc_guid) return t("此構件無 ifc_guid，無法定位", "This element has no ifc_guid; it cannot be located");
  return "";
}
```

- [ ] **Step 2: Add mapping diagnostics to handoff URL**

Add optional fields to `buildA1ReviewRoomHandoffHash()`:

```ts
  const mappingStatus = rowMappingInformationStatus(args.row);
  const mappingIssue = rowMappingIssueCode(args.row);
  if (mappingStatus) q.set("mapping_information_status", mappingStatus);
  if (mappingIssue) q.set("mapping_issue_code", mappingIssue);
```

If `RuleResultRow` has no typed mapping fields yet, add local helpers that return `null` from the current row shape:

```ts
function rowMappingInformationStatus(row: RuleResultRow | null | undefined): string | null {
  const value = (row as unknown as { mapping_information_status?: unknown } | null | undefined)?.mapping_information_status;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rowMappingIssueCode(row: RuleResultRow | null | undefined): string | null {
  const value = (row as unknown as { mapping_issue_code?: unknown } | null | undefined)?.mapping_issue_code;
  return typeof value === "string" && value.length > 0 ? value : null;
}
```

Do not add `lease_token` or any secret to the query string.

- [ ] **Step 3: Update A1 missing mapping test**

Replace the current assertion in `A1ViewerEmbed.test.tsx`:

```ts
    expect(open.disabled).toBe(true);
    expect(open.textContent).toContain("usd_prim_path");
    expect(window.location.hash).toBe("#a1");
```

with:

```ts
    expect(open.disabled).toBe(false);
    await act(async () => { open.click(); });
    expect(window.location.hash).toContain("#review?");
    expect(window.location.hash).toContain("source=a1");
    expect(window.location.hash).toContain("session=review_session_x");
    expect(window.location.hash).toContain("ifc_guid=guid_without_mapping");
    expect(window.location.hash).not.toContain("usd_prim_path=");
    expect(window.location.hash).not.toContain("lease_token");
```

- [ ] **Step 4: Run A1 tests**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\web-viewer-sample
npm test -- src/console/A1ViewerEmbed.test.tsx
```

Expected:

```txt
all A1ViewerEmbed tests passed
```

## Task 5: Targeted Verification

**Files:**
- No new files unless browser evidence is captured under `artifacts/e2e/`.

- [ ] **Step 1: Run coordinator targeted tests**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\bim-review-coordinator
npm test -- tests/conversion-ledger-intake-integration.test.ts tests/build-quality-metrics-summary.test.ts
```

Expected:

```txt
both test files passed
```

- [ ] **Step 2: Run web targeted tests**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\web-viewer-sample
npm test -- src/console/A1ViewerEmbed.test.tsx src/console/ReviewSessionViewerPane.test.tsx
```

Expected:

```txt
both test files passed
```

- [ ] **Step 3: Keep streaming regression green**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\bim-streaming-server
python -m pytest tests/test_host_native_conversion_service.py::test_enumeration_reports_incomplete_mapping_when_sidecar_has_entries_but_stage_has_no_joinable_prims -q
```

Expected:

```txt
1 passed
```

- [ ] **Step 4: Browser evidence**

If coordinator and web dev servers can be started, capture the A1 diagnostic handoff path:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\bim-review-coordinator
npm run dev

cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair\web-viewer-sample
npm run dev -- --host 127.0.0.1
```

Use Playwright or Chrome to verify:

```txt
route: /ui or #a1
button: A1 Open Review Room (first failure)
route after click: #review?source=a1...
Review Room: mapping incomplete diagnostic visible
Review Room: highlight disabled
URL: no lease_token
```

Save screenshots/traces under:

```txt
artifacts/e2e/current-git-point-risk-repair/
```

If browser runtime is unavailable, final report must say `not observed` for browser evidence.

## Task 6: Final Diff Review

**Files:**
- All modified files from Tasks 1-4.

- [ ] **Step 1: Check branch status**

Run:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\.worktrees\current-git-point-risk-repair
git status --short --branch
git diff --name-status
```

Expected:

```txt
Only files listed in this plan are modified.
No seven-axis worktree files or branch operations appear in the diff.
```

- [ ] **Step 2: Whitespace check**

Run:

```powershell
git diff --check
```

Expected:

```txt
no output
```

- [ ] **Step 3: Summarize evidence**

Prepare final report with:

```txt
Verified facts:
- A1 stale branch/worktree cleanup result
- mapping diagnostics pass-through behavior
- failed ledger regression result

Validation:
- coordinator targeted tests
- web targeted tests
- streaming targeted pytest
- browser evidence path or not observed reason

Risks:
- any skipped browser/runtime evidence
- unrelated WIP left in main checkout
- seven-axis worktree explicitly untouched
```

## Self-Review

- Spec coverage: all approved spec problems map to tasks.
- Red-flag scan: no deferred or fill-in steps.
- Type consistency: `mappingInformationStatus`, `mappingIssueCode`, and `mappingIssueCount` are the Review Room camelCase handoff fields; URL params remain snake_case.
- Scope check: `feat/seven-axis-cross-page-harmony` is explicitly out of scope and must not be touched.
