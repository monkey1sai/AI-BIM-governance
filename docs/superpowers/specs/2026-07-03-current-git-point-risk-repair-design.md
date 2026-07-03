# Spec: current git point risk repair after A1 Review Room merge

## Status

Approved and implemented.

- Implemented by commit `801bc7c fix: surface mapping diagnostics in A1 handoff`.
- Pushed to `origin/main` on 2026-07-03.
- The stale local `feat/a1-3d-review-decouple` branch and Git worktree registry entry were removed.
- Residual caveat: `.worktrees/a1-3d-review-decouple` remains as an empty OS-locked directory; Git no longer tracks it as a worktree.

## Context

The current mainline is `origin/main = 78fea8480c7a3cdf12d454bb139500dc835f3203`.
The local checkout is on `main` and is aligned with `origin/main`, but the main
worktree still has local WIP:

- `AGENTS.md`
- `CLAUDE.md`
- `artifacts/local-backups/`
- `docs/plans/diagram.jpg`
- `docs/superpowers/plans/2026-07-02-a1-3d-review-decouple.md`
- `docs/superpowers/specs/2026-07-03-seven-axis-cross-page-harmony-design.md`

This spec comes from a fan-out-and-synthesize review plus adversarial
verification. It covers two separate concerns:

1. safely removing stale local branch/worktree residue that can mislead future
   agents;
2. repairing concrete mainline behavior risks found in the current git point.

## Verified facts

### A1 branch deletion

`feat/a1-3d-review-decouple` is safe to delete as stale local residue, but not
because it is ancestry-merged.

Evidence:

- `origin/main` already contains the equivalent feature as
  `a334e49 feat: A1 3D 檢視改由 Review Room 手動接管`.
- `git cherry -v origin/main feat/a1-3d-review-decouple` shows
  `f2e41cb feat: decouple A1 3D review handoff` as patch-equivalent.
- `04e71a37057ef0ab74b8baa766e3ca0d25403841` has the same tree as its parent and
  no `diff-tree` file changes. It is an empty evidence-gate commit.
- Selected final-tree diff for the A1 changed paths between
  `origin/main..feat/a1-3d-review-decouple` is empty.
- The branch is still checked out by linked worktree
  `.worktrees/a1-3d-review-decouple`.
- The branch upstream is gone:
  `[origin/feat/a1-3d-review-decouple: gone]`.

Deletion therefore requires a cleanup protocol, not a merge.

### Current mainline validation already run

Targeted tests executed during this review:

```powershell
cd bim-review-coordinator
npm test -- tests/conversion-ledger-intake-integration.test.ts
```

Result: passed, `3 passed`.

```powershell
cd bim-streaming-server
python -m pytest tests/test_host_native_conversion_service.py::test_enumeration_reports_incomplete_mapping_when_sidecar_has_entries_but_stage_has_no_joinable_prims -q
```

Result: passed, `1 passed`.

The first Vitest run failed inside the sandbox because Vitest needed to create a
temporary directory under `C:\Users\IOT\AppData\Local\Temp`; rerunning with real
permissions passed.

## Problems

### Problem 1: stale linked worktree can cause future merge/delete mistakes

`feat/a1-3d-review-decouple` is squash-equivalent to mainline, but normal ancestry
checks still report it as not merged. A future agent using only
`git branch --no-merged origin/main` could conclude the branch must be merged,
which would be wrong.

Also, direct branch deletion is blocked because the branch is checked out in a
linked worktree. The worktree may contain ignored artifacts, so cleanup must be
explicitly data-loss aware.

### Problem 2: mapping incomplete signal stops at converter artifacts

`bim-streaming-server` now emits machine-readable incomplete mapping information:

- `mapping_information_status`
- `mapping_issue_count`
- `mapping_issues`
- `sidecar_entry_count`
- `usd_mesh_prim_count`

But the signal is not yet carried through the user-facing path:

- `bim-review-coordinator/src/services/streamingConversionClient.ts`
  `buildQualityMetricsSummary()` does not include these fields.
- `web-viewer-sample/src/types/mapping.ts` `ElementMappingSummary` does not type
  these fields.
- A1 and Review Room currently display generic mapping language such as
  `missing usd_prim_path`, not the concrete machine-readable issue
  `ifc_usdc_mapping_information_incomplete`.

This is not a failure of the converter fix. It is an integration gap: operators
can still see a disabled highlight path without seeing the exact root cause.

### Problem 3: A1 missing-mapping handoff behavior is internally inconsistent

`A1GovernanceWorkbenchPage` currently disables the `Open Review Room` button when
the failed row has `ifc_guid` but lacks `usd_prim_path`, while its disabled reason
says Review Room will show the mapping gap.

That is contradictory: if the button is disabled, Review Room cannot show the
diagnostic. The product behavior should be decided explicitly.

Chosen behavior for this spec:

- A1 may open Review Room when a failed row has `ifc_guid`, even if
  `usd_prim_path` is missing.
- The handoff must carry non-secret diagnostic context.
- Review Room must disable the actual 3D highlight action until `usd_prim_path`
  exists and all runtime gates pass.
- Missing mapping must be presented as a diagnostic state, not as a fake
  highlight success.

This keeps the non-negotiable safety rule: no `usd_prim_path` means no highlight.
It only changes where the operator can view the diagnosis.

### Problem 4: conversion ledger failed terminal path lacks regression coverage

`ingestConversionReport()` writes terminal `ready` and `failed` results back into
the conversion ledger, but the current regression test only covers the `ready`
path.

The `failed` path should be locked so failed conversions do not remain visible as
stale `queued` records in `/api/conversion/records`.

### Problem 5: local WIP can pollute the repair branch if not triaged first

The main checkout has generated and untracked files. At minimum:

- `AGENTS.md` / `CLAUDE.md` only contain GitNexus count churn and should not be
  mixed into this repair unless explicitly accepted.
- `docs/superpowers/specs/2026-07-03-seven-axis-cross-page-harmony-design.md`
  appears to be a separate spec and must not be silently discarded.
- `artifacts/local-backups/` should stay local unless explicitly promoted.
- `docs/plans/diagram.jpg` needs ownership and source confirmation before
  tracking.

User approval constraint: `feat/seven-axis-cross-page-harmony` is an active
Claude Code worktree. This repair must not delete it, clean it, rebase it, merge
it, inspect its WIP, or include it in branch hygiene actions. It may appear in
read-only `git worktree list` / `git branch -vv` output as context only.

## Design

### Slice 1: stale A1 branch/worktree cleanup protocol

Implement this as an execution checklist, not product code.

Required preflight:

```powershell
git fetch origin main
git branch -vv --all
git worktree list --porcelain
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
git -c safe.directory=C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-3d-review-decouple `
  -C C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-3d-review-decouple `
  status --short --branch --ignored
```

Deletion is allowed only if:

- the selected final-tree diff is empty;
- the target worktree has no tracked or untracked non-ignored WIP;
- ignored artifacts are either clearly disposable build/cache outputs or the user
  explicitly approves deleting them;
- remote `origin/feat/a1-3d-review-decouple` is gone or user accepts local-only
  cleanup.

Cleanup order:

```powershell
git worktree remove C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-3d-review-decouple
git branch -D feat/a1-3d-review-decouple
```

Use `git worktree remove --force` only after the ignored artifact list is
reviewed. The force is justified by the verified final-tree equivalence, not by
skipping evidence.

### Slice 2: propagate mapping incomplete diagnostics

Extend `ConversionQualityMetricsSummary` in
`bim-review-coordinator/src/services/streamingConversionClient.ts` to include:

```ts
mapping_information_status: string | null;
mapping_issue_count: number | null;
mapping_issues: Array<Record<string, unknown>> | null;
sidecar_entry_count: number | null;
usd_mesh_prim_count: number | null;
```

Update `buildQualityMetricsSummary()` to copy these fields from
`raw.quality_metrics` when present.

Extend `web-viewer-sample/src/types/mapping.ts`:

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

export interface ElementMappingSummary {
  mapped_count?: number;
  unmapped_ifc_count?: number;
  unmapped_usd_count?: number;
  fake_mapping_count?: number;
  mapping_information_status?: "complete" | "incomplete" | string;
  mapping_issue_count?: number;
}

export interface ElementMappingDocument {
  ...
  issues?: ElementMappingIssue[];
}
```

Review Room should display the first mapping issue code/message when handoff has
no `usd_prim_path`.

### Slice 3: resolve A1 missing-mapping UX

Change `a1ReviewRoomHandoffReason()` behavior:

- still block when there is no selected session;
- still block when there is no failed row;
- still block when there is no `ifc_guid`;
- do not block only because `usd_prim_path` is missing.

Change button copy for missing mapping:

- caption should say Review Room will open in diagnostic mode;
- Review Room highlight button remains disabled until mapping exists.

Extend `buildA1ReviewRoomHandoffHash()` to include non-secret diagnostic fields
when available:

```txt
mapping_information_status
mapping_issue_code
mapping_issue_count
```

Do not put viewer lease tokens or credentials in URLs.

### Slice 4: failed ledger regression

Add a test to
`bim-review-coordinator/tests/conversion-ledger-intake-integration.test.ts`:

1. POST `/api/external/ifc-ready`.
2. POST `/api/internal/conversion-result` with:

```json
{
  "correlation_id": "minio-watch-failed12",
  "conversion_job_id": "stream_conv_ledger_failed",
  "status": "failed",
  "reason": "mapping_information_incomplete",
  "retryable": false,
  "artifact_summary": {
    "mapping_information_status": "incomplete",
    "mapping_issue_count": 1
  }
}
```

3. GET `/api/conversion/records`.
4. Assert the record for that idempotency key has:

```txt
status = failed
conversion_job_id = stream_conv_ledger_failed
usdc_key = null
coverage_report.mapping_information_status = incomplete
```

The test must fail before the implementation if the ledger stays `queued`.

### Slice 5: browser evidence requirement

After implementation, collect user-facing evidence for the A1 to Review Room
diagnostic path:

- Frontend URL: coordinator console `/ui` or local console route.
- Route: `#a1` then `#review?source=a1...`.
- Buttons tested:
  - A1 `Open Review Room (first failure)`;
  - Review Room manual attach button;
  - Review Room highlight button.
- Fixture: mocked or local fixture with `ifc_guid` present and `usd_prim_path`
  missing, plus mapping issue metadata.
- Expected visible result:
  - A1 opens Review Room diagnostic mode;
  - Review Room shows mapping incomplete issue;
  - highlight remains disabled;
  - no viewer lease token appears in URL.

Browser evidence may use Playwright/Chrome when gstack is unavailable, but the
engine must be reported honestly.

## Non-goals

- Do not rework A1 3D architecture. The Review Room ownership model is already
  in `origin/main`.
- Do not merge `feat/a1-3d-review-decouple` into `main`.
- Do not delete, clean, rebase, merge, inspect, or otherwise manage
  `feat/seven-axis-cross-page-harmony` in this repair; it is an active Claude
  Code worktree.
- Do not track `artifacts/local-backups/` or local `storage/` artifacts.
- Do not change GitNexus or codebase-memory internals.

## Acceptance criteria

1. `feat/a1-3d-review-decouple` worktree and local branch are removed only after
   the cleanup preflight passes.
2. `git branch -vv --all` no longer shows
   `feat/a1-3d-review-decouple`.
3. No unrelated main WIP is included in the repair branch.
4. Failed conversion result regression passes and proves `/api/conversion/records`
   does not remain stale `queued`.
5. Mapping incomplete diagnostics are visible through the coordinator/UI path.
6. A1 missing-mapping rows can open Review Room diagnostic mode without enabling
   highlight.
7. Review Room still blocks highlight when `usd_prim_path` is missing.
8. Targeted tests pass:

```powershell
cd bim-review-coordinator
npm test -- tests/conversion-ledger-intake-integration.test.ts

cd web-viewer-sample
npm run test:session-first -- A1ViewerEmbed.test.tsx ReviewSessionViewerPane.test.tsx

cd bim-streaming-server
python -m pytest tests/test_host_native_conversion_service.py::test_enumeration_reports_incomplete_mapping_when_sidecar_has_entries_but_stage_has_no_joinable_prims -q
```

9. User-facing change has screenshot/trace evidence or is explicitly marked
   `not observed` if browser runtime cannot be started.

## Adversarial checks

- If `git diff origin/main..feat/a1-3d-review-decouple` shows deletions of latest
  mainline files, do not interpret that as branch content to merge. It means the
  branch is stale.
- If `git status` in a linked worktree fails with `dubious ownership`, retry with
  one-shot `-c safe.directory=<worktree>`. Do not assume the worktree is dirty.
- If `mapping_information_status` appears in converter artifacts but not in UI,
  the implementation is incomplete.
- If A1 opens Review Room with missing `usd_prim_path`, highlight must remain
  disabled and the UI must state the mapping reason.
- If `AGENTS.md` / `CLAUDE.md` only contain GitNexus count churn, do not include
  them in the product repair unless the user explicitly approves.

## Review request

Approve this spec if the intended repair is:

1. clean stale A1 branch/worktree residue safely;
2. repair mapping incomplete diagnostic propagation;
3. add failed ledger regression coverage;
4. make A1 missing-mapping handoff behavior explicit and testable;
5. preserve unrelated local WIP for separate decisions.
