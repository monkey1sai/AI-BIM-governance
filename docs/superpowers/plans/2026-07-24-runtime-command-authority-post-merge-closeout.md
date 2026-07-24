# Runtime command authority post-merge closeout Implementation Plan

> **Implementation authorization:** The user explicitly invoked `spec-to-done` and accepted the bounded Windows test-deployment evidence scope on 2026-07-24. This plan is executable under that authorization. It does not authorize credential changes, production deployment, force options, or a claim of full/production completion.

**Goal:** Close the remaining local implementation gap and produce safe, post-merge Windows Kit/GPU evidence for runtime-command authority without retroactively claiming that PR #379 met its pre-merge gate.

**Architecture:** Keep runtime authority, coordinator, and Kit protocol behavior unchanged. Localize only the viewer rejection presentation through the repository's existing inline `t(zh, en)` mechanism. Replace the unsafe host-native E2E self-kill with a deployment-owned PowerShell runner that mediates a nonce-bound file outage handshake, pins a verified local Docker context and one coordinator container ID before stopping it, and restores that same ID in `finally`.

**Tech Stack:** React 18 / TypeScript / Vitest / Playwright, PowerShell, Docker Compose, Windows host-native Omniverse Kit.

## Global Constraints

- The change is a post-merge corrective closeout; every new evidence artifact must record `post_merge_corrective=true`, the tested `origin/main` SHA, and the observed runtime identity.
- Keep `RuntimeRejectionReason`, parser allowlists, correlation, retries, stage proof, and DataChannel semantics unchanged.
- Existing i18n uses inline `t(zh, en)` and explicitly has no central key dictionary. “Existing i18n keys” is implemented as that existing mechanism, not a new localization subsystem.
- The canonical deployment is exactly `D:\Users\deploy\AI-bim-geo`; run `.\scripts\dev\rebuild-test-deploy.ps1 -Build` only from the workspace root and never with `-DryRun` or `-Force`.
- Run the host-native port helper in `-DetectOnly` mode first. A default cleanup is allowed only after deployment-path or Compose-label evidence proves ownership; any name/port-only ambiguity stops the run.
- The runner may stop and restore only one deployment-owned coordinator container ID. It must verify exactly one Compose result, a pinned local Docker context, `com.docker.compose.project.working_dir` equals the fixed deployment root, and `com.docker.compose.service=coordinator` before stop; recovery is armed before stop and must start/health-check that same ID in `finally`.
- Task 1.5 stays `HELD` until a credential owner supplies a non-secret rotate/revoke confirmation. No secret values are read into evidence, code, logs, or responses.
- Do not archive this OpenSpec change while task 1.5 remains held.

---

### Task 1: Localize the viewer-origin rejection matrix

**Files:**

- Modify: `web-viewer-sample/src/Window.tsx:12-58,188-214,3756-3794`
- Modify: `web-viewer-sample/src/console/windowParentMessage.dom.test.tsx:12-18,128-136,501-574`

**Interfaces:**

- Consumes: `RuntimeCommandRejection.reason`, `retryable`, `runtime_state`, and optional `detail_code` from the existing parser.
- Produces: the existing `runtime-command-rejection`, `runtime-authority-unavailable`, and `runtime-command-resync` anchors with localized zh/en copy; no protocol payload changes.

- [ ] **Step 1: Add the failing zh/en render assertions.**

Import `getLang` and `setLang` from `./i18n` in the DOM test. Add a table covering all six `RuntimeRejectionReason` values and both retryability states; construct an `App`, set `runtimeCommandRejection`, render it, and assert the stable alert anchor plus each expected Chinese/English human-readable reason. Pin the test language before each render and restore it after each case.

Run: `npm test -- src/console/windowParentMessage.dom.test.tsx`

Expected: FAIL because the title, reason, retryability, outage, changed-unconfirmed, and resync copy are hard-coded.

- [ ] **Step 2: Add the smallest local presentation map.**

In `Window.tsx`, import `t` from `./console/i18n`. Add an exhaustive `Record<RuntimeRejectionReason, { zh: string; en: string }>` adjacent to the existing union. Use `t(copy.zh, copy.en)` for the rejection title, selected reason, retryability, authority-unavailable explanation, changed-unconfirmed explanation, and resync button. Keep the allowlisted machine reason in a stable code/test anchor only if the current diagnostic presentation needs it; never render untrusted detail.

Run: `npm test -- src/console/windowParentMessage.dom.test.tsx`

Expected: PASS with all existing assertions and the new zh/en matrix assertions.

- [ ] **Step 3: Run viewer static gates.**

Run: `npm run typecheck`

Expected: exit 0.

Run: `npx eslint src/Window.tsx src/console/windowParentMessage.dom.test.tsx --max-warnings 0`

Expected: exit 0.

### Task 2: Make the host-native authority scenario truthful and side-effect bounded

**Files:**

- Modify: `web-viewer-sample/e2e/runtime-command-authority-host-native.spec.ts:1-642`
- Create: `scripts/dev/run-runtime-command-authority-host-native-evidence.ps1`
- Create: `scripts/tests/test-runtime-command-authority-host-native-evidence.ps1`
- Create: `docs/evidence/runtime-command-authority/host-native-evidence-runbook.md`

**Interfaces:**

- Consumes: deployed coordinator `http://127.0.0.1:8004`, conversion artifacts `http://127.0.0.1:49101/artifacts/<run-id>/model.usdc`, Kit ports `49100/47998`, deployment `scripts/.run` PID metadata, and a unique control directory supplied by the runner.
- Produces: a sanitized JSON evidence document, a screenshot, coordinator ownership/restore facts, first-frame and stage evidence, terminal request/runtime/session IDs, P95, and zero-mutation/changed-unconfirmed assertions.

- [ ] **Step 1: Write the runner contract tests.**

In `scripts/tests/test-runtime-command-authority-host-native-evidence.ps1`, statically assert that the runner hard-codes and checks `D:\Users\deploy\AI-bim-geo`, rejects reparse points and broad write ACLs, pins the Docker context, verifies one labelled coordinator ID, arms recovery before `docker stop <id>`, restores the same ID in `finally`, rejects `-Force`/`-DryRun`, creates no-BOM create-new nonce-bound markers, builds a unique control directory, copies the tracked USD fixture into the explicit edge artifacts root, and launches only the locked local Playwright binary. Assert that the E2E source contains no `process.kill` or `E2E_COORDINATOR_PID`.

Run: `pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/tests/test-runtime-command-authority-host-native-evidence.ps1`

Expected: FAIL until the runner and test handshake exist.

- [ ] **Step 2: Refactor the Playwright scenario.**

Remove `E2E_COORDINATOR_PID` and every direct process termination. Require a runner-owned control directory and nonce. At the outage boundary, write a create-new `outage-ready` marker containing run/request identifiers plus the nonce, wait for a nonce-bound runner-created `outage-go` marker, perform the existing outage assertion, then write `outage-complete`. Add bounded polling with a clear timeout and no arbitrary executable path from environment.

For concurrent replay, generate two unique request IDs using the same authorization/revision. Send both requests concurrently, require exactly one terminal per ID, require exactly one accepted event and one successful mutation overall, require one rejection for the other ID, and record both IDs in sanitized evidence.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 3: Implement the deployment-owned runner.**

The runner must verify fixed physical roots (no reparse points or broad writer ACLs), require clean `HEAD == origin/main`, wait for coordinator and conversion health, read the Kit runtime ID/PID only from deployment-owned `scripts/.run` metadata, then require the allowed launcher, `bim-streaming-server` command marker, path boundary, and descendant signaling listener before accepting that PID. It creates a unique data-root artifact directory and copies the tracked `testing.usd` fixture as `model.usdc`. It must use lockfile `npm ci --ignore-scripts --no-audit --no-fund`, re-check a clean checkout, invoke only the resulting local Playwright binary (never `npx`), launch only the exact E2E with process-scoped environment values, wait for nonce-bound `outage-ready`, prove and pin exactly one labelled coordinator container ID in a local Docker context, stop only that ID, create no-BOM `outage-go`, and in `finally` start the same ID and wait for `/health`.

The runner must persist only sanitized evidence beneath `D:\Users\deploy\AI-bim-geo-data\artifacts\runtime-command-authority-evidence\<run-id>`. It must fail if the test does not emit `outage-complete`, if the coordinator does not recover, or if ownership is ambiguous.

Run: `pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/tests/test-runtime-command-authority-host-native-evidence.ps1`

Expected: PASS.

### Task 3: Validate the corrective implementation in the isolated worktree

**Files:**

- Verify only; no new files.

**Interfaces:**

- Consumes: the Task 1 viewer presentation and Task 2 deployment/E2E contracts.
- Produces: current local-worktree verification evidence, not host-native runtime proof.

- [ ] **Step 1: Run affected viewer checks.**

Run from `web-viewer-sample`:

`npm test -- src/console/windowParentMessage.dom.test.tsx`

`npm run typecheck`

`npm run build`

`npm run lint`

Expected: every command exits 0.

- [ ] **Step 2: Run affected server and root suites.**

Run from `bim-review-coordinator`: `npm run verify`.

Run from `bim-streaming-server`: `python -m pytest tests -q` and the repository-prescribed Ruff gate for changed Python scope if any Python file changes.

Run from the workspace root: `python -m pytest tests -p no:cacheprovider`, `pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/tests/test-deploy-dryrun.ps1`, `pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/tests/test-runtime-command-authority-host-native-evidence.ps1`, and `npx --no-install openspec validate implement-runtime-command-authority-and-rejection --strict`.

Expected: every locally reproducible gate exits 0; a failure is diagnosed and corrected before delivery rather than waived as historic evidence.

- [ ] **Step 3: Review the change graph.**

Run GitNexus `detect_changes(scope=compare, base_ref=origin/main)` against this linked worktree and review all HIGH/CRITICAL findings. Run `git diff --check`.

Expected: only Task 1/2 files and deliberate evidence/runbook/ledger files are affected; no protocol or credential surface drifts.

### Task 4: Ship the executable test support before running the canonical deployment

**Files:**

- Verify branch diff, PR body, and CI; no extra implementation files.

**Interfaces:**

- Consumes: Task 1–3 green local evidence.
- Produces: a merged corrective support PR whose `origin/main` contains the runner and E2E test required by Task 5.

- [ ] **Step 1: Commit only the corrective support.**

Run: `git add web-viewer-sample/src/Window.tsx web-viewer-sample/src/console/windowParentMessage.dom.test.tsx web-viewer-sample/e2e/runtime-command-authority-host-native.spec.ts scripts/dev/run-runtime-command-authority-host-native-evidence.ps1 scripts/tests/test-runtime-command-authority-host-native-evidence.ps1 docs/evidence/runtime-command-authority/host-native-evidence-runbook.md docs/superpowers/plans/2026-07-24-runtime-command-authority-post-merge-closeout.md`

Run: `git commit -m "fix(runtime): make authority closeout evidence executable"`

Expected: commit contains no ignored artifacts, node modules, credentials, or GitNexus-generated instruction changes.

- [ ] **Step 2: Push, review, and merge the support PR.**

Open a PR from `codex/openspec/implement-runtime-command-authority-and-rejection`, run the repository local PR preflight and required CI checks, resolve required review findings, then merge. Record the merge SHA in the evidence ledger. Do not claim original PR #379's pre-merge gate was met.

### Task 5: Run canonical Windows Kit/GPU evidence and reconcile the OpenSpec ledger

**Files:**

- Modify after evidence: `openspec/changes/implement-runtime-command-authority-and-rejection/tasks.md`
- Modify after evidence: `openspec/changes/implement-runtime-command-authority-and-rejection/design.md`
- Create after evidence: `docs/evidence/runtime-command-authority/host-native-<run-id>.md`

**Interfaces:**

- Consumes: merged runner on fresh `origin/main`, deployment-owned Kit and coordinator, and the non-secret evidence bundle.
- Produces: a truthful Task 7.3 post-merge record and a follow-up ledger PR; task 1.5 remains held.

- [ ] **Step 1: Rebuild the canonical test deployment.**

Run from `C:\Repos\active\iot\AI-BIM-governance`:

`powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1 -DetectOnly`

If it reports no occupants, run the same helper without `-DetectOnly`; if it reports an occupant, collect deployment-path/process ownership evidence first and stop for ambiguity.

Then run exactly: `.\scripts\dev\rebuild-test-deploy.ps1 -Build`.

Expected: a fresh `origin/main` checkout is activated at `D:\Users\deploy\AI-bim-geo` and deployment health is ready.

- [ ] **Step 2: Run the deployment-owned authority evidence runner.**

Run from `D:\Users\deploy\AI-bim-geo`:

`pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\dev\run-runtime-command-authority-host-native-evidence.ps1`

Expected: first frame, matched observed stage, valid/forged/released/expired/wrong-source/direct-wrong-session/composition-tamper/concurrent-replay/outage results, request/runtime/session IDs, P95, zero-mutation proof with a bounded post-denial stage-stability window and final post-deadline sample, and a recovered coordinator. Any timeout, ownership ambiguity, missing output, or recovery failure is a failed 7.3 gate.

- [ ] **Step 3: Record facts without retroactive or full-production claims.**

Copy only sanitized result fields into the tracked evidence document. Mark Task 5.6 complete only after Task 3 passes. Mark Task 7.3 complete only after Step 2 passes. Reword Task 7.5 as a factual two-part reconciliation: PR #379 merge is historic; this corrective support/evidence PR is current. Include current A4 merge/impact evidence if independently verified; otherwise retain that portion as unresolved rather than checking the composite task.

- [ ] **Step 4: Ship the ledger/evidence PR and leave the change held if necessary.**

Run strict OpenSpec validation, GitNexus compare/detect_changes, PR preflight, push, review, merge, and record merge facts. Keep Task 1.5 unchecked with `credential hygiene=not confirmed` and `production/full=no`; do not archive the active change.

## Plan self-review

- Spec coverage: all remaining tasks are explicitly classified: 1.5 external HELD, 5.6 local implementation, 7.3 canonical test deployment, 7.5 factual reconciliation plus separately evidenced A4 tail.
- Placeholder scan: no task delegates a safety decision to an unspecified command; each destructive/deployment action has an exact owner check and stop condition.
- Interface consistency: the Playwright test creates nonce-bound control markers only; the PowerShell runner owns the coordinator stop/restart and artifact locations; neither interface carries secret values or persists raw Playwright stdout/stderr.
