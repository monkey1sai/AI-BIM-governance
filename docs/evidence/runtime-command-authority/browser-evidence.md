# Runtime command authority controlled-browser evidence

Date: 2026-07-22  
Scope: OpenSpec `implement-runtime-command-authority-and-rejection` task 7.2  
Engine: Playwright Chromium, DPR 1, 1440×900

## Result

Command (PowerShell, from `web-viewer-sample/`):

```powershell
$env:E2E_VIEWER_PORT='5181'
npx playwright test e2e/runtime-command-authority.spec.ts --config=playwright.config.ts
```

Result: 2 passed, 0 failed, 0 skipped. Port 5181 was selected only to isolate this run's dev-server listener from another worktree; this is network-port isolation, not a claim that two Playwright processes may safely share one worktree artifact directory.

## Operability evidence

| Field | Observed evidence |
|---|---|
| Frontend route | Standalone `/?harness=1`; controlled embedded parent `/e2e/runtime-command-parent` with iframe `/?harness=1&harnessAuthority=1&session=review_session_harness0001` |
| Main actions | Select `Building`; explicit retry via deselect `Building` then select `Site`; apply binding; select model tree nodes; click authenticated-status resync |
| Fixture | Deterministic dev-only FakeKit and harness stage; this is not a live Kit/GPU fixture |
| Backend API | Controlled mock of authenticated self-only `GET /api/review-sessions/{session}/viewer-leases/status`; browser assertion verifies the user-carrier header path with the public value `[redacted]`. Real coordinator authentication/authorization is covered by affected unit/integration tests, not claimed by this browser mock. |
| Runtime identifiers | Harness session `review_session_harness0001`; correlated request and binding-revision IDs were observed in lifecycle/parent messages but their generated values are not copied into this report |
| Visible failure/retry | Persistent `authority_unavailable` rejection; the FakeKit event count stayed at one during the no-auto-replay window; only the explicit user retry produced the second mutator |
| Late authority | Zero `openStageRequest` before trusted authority; one after late authority; delivering the same authority again did not reopen the stage |
| Lifecycle | Binding apply visibly reached `pending → executing → terminal (success)`; `loadArtifactGroupResult:accepted` was non-terminal and `bindingApplied` was terminal |
| Changed-unconfirmed | Visible unproven warning and resync action; a focus mutator remained blocked at zero; matching authenticated status resync cleared the warning; the next explicit focus succeeded once |
| Design gate | Not applicable to this controlled diagnostic surface; no production design reference or approved screen changed. This evidence does not claim design fidelity or full frontend completion. |

## Durable artifacts

The repository intentionally ignores large, regenerable Playwright binaries. CI job `functional-runtime-conv` runs this exact spec and uploads `artifacts/e2e/_output/` in the head-SHA-bound artifact `functional-runtime-conv-<head_sha>`. Each test uses `testInfo.outputPath(...)`, so its screenshots and `trace.zip` share the same per-test directory:

- `runtime-command-authority--858cd-y-an-explicit-retry-mutates-chromium/{authority-rejection.png,trace.zip}`
- `runtime-command-authority--83d3a--until-authenticated-resync-chromium/{changed-unconfirmed-blocked.png,changed-unconfirmed-resync.png,trace.zip}`

Local final-run trace scan reported two trace bundles, zero raw `user_<uuid>` values, zero raw `lease_<uuid>` values, zero non-redacted `X-User-Token` values, and zero `X-Viewer-Lease-Token` or `Authorization` headers. All four expected `X-User-Token` occurrences were paired only with the public `[redacted]` carrier. The scanner emitted counts only and never printed header values.

## Honest boundary

This closes controlled-browser task 7.2 only. It does not close credential-owner task 1.5, Windows host-native Kit/GPU task 7.3, CI/PR delivery task 7.5, or production/full completion. The ignored local screenshots and traces remain reproducible evidence; the head-SHA-bound CI artifact is their durable delivery location.
