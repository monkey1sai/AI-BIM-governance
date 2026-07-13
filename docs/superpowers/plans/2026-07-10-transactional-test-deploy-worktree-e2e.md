# 交易式測試部署重建與 Worktree 前端 E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Every worker/reviewer must return Scope, Evidence, Finding, Uncertainty, Risk, Next step.

**Goal:** 保留 `origin/main` 預設重建口令，新增明確的 `CurrentWorktree` deployment lane，修正資料遺失、junction traversal、PID reuse、wrong-service health、port collision、stale evidence 等風險，並提供會實際完成真 IFC 前端 E2E、以 passed/failed 結束的一鍵 agent 命令。

**Architecture:** 以 sibling staging + external env backup + exclusive lock + two-rename cutover 取代 active checkout 原地 reset/clean。來源分成 `OriginMain` 與 opt-in `CurrentWorktree`；deployment runtime 以 process identity sidecar、resolved ports與 service-specific readiness 驗證。E2E runner從 fixed deployment執行 locked Playwright dependency、seed durable IFC fixture，並把本次 run 的 source/deploy/test證據寫到獨立 manifest。

**Tech Stack:** PowerShell 7 / Windows PowerShell 5.1 compatibility, Git, Docker Compose, Node 20, npm lockfile, Playwright, React/Vite, Omniverse Kit/WebRTC, SHA256, NTFS reparse/ACL inspection.

## Global Constraints

- 專用 worktree：`C:\Repos\active\iot\AI-BIM-governance.worktrees\deploy-rebuild-worktree-e2e`，branch `fix/deploy-rebuild-worktree-e2e`。
- Fixed deployment path仍是 `D:\Users\deploy\AI-bim-geo`；不得新增 arbitrary production destination flag。
- `OriginMain` 是 default；`CurrentWorktree` 只能顯式 opt-in。
- 不修改任何現有 `.env` value；logs/provenance不得包含 env bytes、credential-bearing origin URL或 private key內容。
- 不停止只有 port/process-name證據的 PID；identity不完整時 fail closed。
- 不在 code-symbol change 前假稱 GitNexus passed。PowerShell symbols目前 `Target not found / UNKNOWN`；需使用者明確接受 unavailable風險後才進 Task 1 code edits。
- 所有 destructive-path tests 使用 temp sibling與注入 seams；在 unit/integration gates全綠前不得碰 fixed D: deployment。
- `blocked` 不作為 one-click worktree E2E終態；可恢復 prerequisite自動修復，其他問題回 `failed` + evidence + rerun command。

---

### Task 0: Freeze baseline, provenance, and unavailable gate

**Files:**
- Read: `AGENTS.md`, `CLAUDE.md`, `docs/agents/*.md`
- Read: `scripts/lib/rebuild-test-deploy.ps1`, `scripts/deploy.ps1`
- Create: current design and this plan only

- [x] **Step 1: Create dedicated sibling worktree**

Expected branch: `fix/deploy-rebuild-worktree-e2e`; no user dirty files copied from main checkout.

- [x] **Step 2: Run focused baseline**

```powershell
pwsh -NoProfile -File scripts/tests/test-rebuild-test-deploy.ps1
pwsh -NoProfile -File scripts/tests/test-host-native-launcher.ps1
pwsh -NoProfile -File scripts/tests/test-preflight-ports.ps1
```

Expected baseline: all existing tests pass. Use a temp `EDGE_RUNTIME_DATA_ROOT`; do not touch fixed runtime data.

- [x] **Step 3: Rebuild GitNexus index and attempt impact**

Observed: re-index completed, but PowerShell functions/files return `Target not found`, risk `UNKNOWN`. Remove only GitNexus auto-generated unrelated file diffs via exact reverse patch.

- [x] **Step 4: Record explicit user acceptance**

Before modifying PowerShell or shared flows, record user acceptance of `GitNexus unavailable (PowerShell unsupported)` risk. Without it, stop after docs-only work.

2026-07-13：使用者明確要求保留現有成果並繼續補齊至合併；接受 fresh re-index 後 PowerShell target 仍為 `Target not found / UNKNOWN`，以 raw source review、focused tests、PR preflight 與 CI 作補償證據。

### Task 1: RED tests for transaction and source modes

**Files:**
- Modify: `scripts/tests/test-rebuild-test-deploy.ps1`
- Create: `scripts/tests/fixtures/` files only when a tiny binary/text fixture cannot be generated in temp
- Test only: `scripts/lib/rebuild-test-deploy.ps1`

- [x] **Step 1: Add non-git and broken-gitfile failure tests**

Cases:

- clone/fetch failure leaves live sentinel + all env byte-identical
- broken linked-worktree `.git` self-heals to standalone `.git` directory
- valid checkout with wrong origin fails before stage/swap
- missing `scripts/deploy.ps1` in stage fails before service stop

Run and require RED for the new assertions, with legacy tests still passing up to the intended failures.

- [x] **Step 2: Add path/reparse/lock tests**

Cases:

- destination root junction rejected
- existing ancestor junction rejected
- untracked entry/ancestor reparse rejected
- second concurrent run fails before env backup; lock works again after first handle dispose

- [ ] **Step 3: Add env transaction and cutover tests**

Cases:

- external backup has path/length/hash only; no secret value in log/provenance
- env changes during backup abort
- restore does not depend on `.env.example`
- partial restore/hash failure leaves live untouched
- `live -> previous` then injected `stage -> live` failure restores previous before deploy
- deploy nonzero preserves previous recovery path and does not claim runtime rollback

- [ ] **Step 4: Add CurrentWorktree capture table**

Fixture must include staged edit、unstaged edit、tracked deletion、binary change、Unicode/space untracked binary、ignored `.env`、ignored build output。Assertions:

- stage bytes equal source final tracked state
- only nonignored safe untracked files copied
- HEAD/patch/untracked manifest hashes stable
- source mutation between fingerprints aborts before cutover
- tooling exclusion occurs after capture and is represented in provenance

- [ ] **Step 5: Run RED evidence command**

```powershell
pwsh -NoProfile -File scripts/tests/test-rebuild-test-deploy.ps1 *> artifacts/test-deploy-red.log
```

Save only relevant failing test names and expected-vs-actual summaries; do not paste full log.

### Task 2: GREEN transaction orchestrator

**Files:**
- Modify: `scripts/lib/rebuild-test-deploy.ps1`
- Modify: `scripts/dev/rebuild-test-deploy.ps1`
- Optionally create: `scripts/lib/test-deploy-transaction.ps1` only if keeping the existing library reviewable requires a narrow separation

- [ ] **Step 1: Implement path safety and run layout**

Add narrow helpers equivalent to:

- `Assert-TestDeployPathSafety`
- `New-TestDeployRunLayout`
- `Enter-TestDeployRebuildLock`
- `Get-TestDeployCheckoutState`

Walk all existing path components; any reparse point fails. Lock uses `FileShare.None` and remains as a stable lock file. Return stage/previous/run/env/provenance paths on the same volume.

- [ ] **Step 2: Implement external env backup**

Backup allowlisted files before live mutation; record length/SHA256/ACL hash without value. Restore into stage regardless of `.example` existence and verify bytes/hash. Redact origin URLs in command display/errors.

- [ ] **Step 3: Implement OriginMain stage**

Use explicit refspec, detached exact commit, standalone `.git` directory, expected origin hash and required-script validation. Do not mutate live checkout.

- [ ] **Step 4: Implement CurrentWorktree stage**

Capture:

```text
HEAD
+ git diff HEAD --binary --full-index --no-ext-diff --ita-visible-in-index
+ git ls-files --others --exclude-standard -z
```

Reject sensitive/tooling/cache/reparse/path-escape entries. Copy leaf files and verify hashes. Re-fingerprint source before cutover.

- [ ] **Step 5: Implement two-rename cutover**

Order: prepare/validate stage -> verified service stop -> repeat path safety -> `live -> previous` -> `stage -> live` -> deploy. Only pre-deploy rename failure auto-restores old live. Post-deploy failure returns recovery metadata without claiming external side-effect rollback.

- [ ] **Step 6: Preserve compatible result fields and expose logs**

Keep `DeploymentPath`, `OriginMainCommit`, `DeployExitCode`; add source mode/commit/patch/untracked hashes, checkout kind, provenance/previous/env backup paths, stdout/stderr paths, recovery status.

- [ ] **Step 7: Wire wrapper flags**

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
.\scripts\dev\rebuild-test-deploy.ps1 -Build -SourceMode CurrentWorktree
```

No `-DryRun` or implicit dirty mode. Print no secret values.

- [ ] **Step 8: Run GREEN transaction gate**

```powershell
pwsh -NoProfile -File scripts/tests/test-rebuild-test-deploy.ps1
```

### Task 3: RED/GREEN PID identity and verified stop

**Files:**
- Modify: `scripts/tests/test-host-native-launcher.ps1`
- Modify: `scripts/tests/test-preflight-ports.ps1`
- Modify: `scripts/lib/host-native-launcher.ps1`
- Modify: `scripts/lib/preflight-ports.ps1`

- [ ] **Step 1: Add RED identity tests**

Cover live PID with wrong creation time/command/root、PID reuse、missing sidecar、tampered sidecar、duplicate child PID、stop returns but process lives、port remains owned。Assert no stop call on mismatch and evidence retained on failure.

- [ ] **Step 2: Implement identity sidecar**

Write service/PID/creation/executable/working directory/repo root/argument fingerprint/run ID atomically beside existing numeric pidfile. Keep numeric pidfile compatibility but never trust it alone.

- [ ] **Step 3: Share identity validator**

`Test-AlreadyRunning`、preflight ownership、stop all call the same validator. Legacy pidfiles require executable + command line + creation time + deploy root proof; otherwise unknown ownership.

- [ ] **Step 4: Verify stop completion**

Child-first stop, identity recheck immediately before kill, wait for tree exit and port release, then remove pidfile/sidecar. Timeout or mismatch throws and prevents rebuild clean/cutover.

- [ ] **Step 5: Run focused GREEN tests**

```powershell
pwsh -NoProfile -File scripts/tests/test-host-native-launcher.ps1
pwsh -NoProfile -File scripts/tests/test-preflight-ports.ps1
pwsh -NoProfile -File scripts/tests/test-rebuild-test-deploy.ps1
```

### Task 4: RED/GREEN canonical deploy correctness

**Files:**
- Modify: `scripts/tests/test-preflight-ports.ps1`
- Modify: `scripts/tests/test-host-native-launcher.ps1`
- Modify: `scripts/tests/test-deploy-dryrun.ps1`
- Create: `scripts/tests/test-deploy-runtime-guards.ps1`
- Modify: `scripts/lib/preflight-ports.ps1`
- Modify: `scripts/lib/host-native-launcher.ps1`
- Modify: `scripts/deploy.ps1`

- [ ] **Step 1: Add active-port topology RED table**

Reject any numeric collision across coordinator、viewer、conversion、governance、primary Kit signal/media、all spectator signal/media, including cross TCP/UDP. Respect `-SkipGovernance` / `-SkipKit` by excluding inactive endpoints.

- [ ] **Step 2: Add service-specific readiness RED tests**

HTTP 200 with wrong service fails. Conversion degraded/`ifc_to_usdc_conversion=false` fails. Verify correct coordinator/governance/conversion JSON and viewer marker pass. Kit requires verified PID + resolved signal owner + current-run log signature.

- [ ] **Step 3: Add Phase 3 TOCTOU RED tests**

Port owner changes between audit and kill、creation time changes、PID remains、port remains、same PID owns multiple ports。Only stable identity may be stopped once.

- [ ] **Step 4: Add strict postverify RED tests**

Inject custom resolved ports; assert no literal `8004/5173/49101` probes, wrong-service 200 is failure, Kit included unless skipped, any failure exits 5.

- [ ] **Step 5: Add fake-docker exit tests**

`docker compose rm` exit 23 and `pull` exit 24 must stop later phases, emit phase-specific log path and exit 2. Build/up behavior remains covered.

- [ ] **Step 6: Implement minimal deploy changes**

Add topology validator, resolved port plumbing, service identity predicates, kill-before/after recheck, Kit readiness in Phase 4/5, and immediate `$LASTEXITCODE` checks. Do not silently broaden unrelated flags.

- [ ] **Step 7: Decide and document `-Build` refresh**

For fixed rebuild, verified pre-cutover stop + clean standalone stage already guarantees fresh host-native runtime. Change direct canonical `deploy.ps1 -Build` to force host-native rebuild/restart only if the public contract is intentionally updated and tests quantify the cost; do not use it to hide failed pre-stop correctness.

- [ ] **Step 8: Run deploy correctness gates**

```powershell
pwsh -NoProfile -File scripts/tests/test-deploy-runtime-guards.ps1
pwsh -NoProfile -File scripts/tests/test-deploy-dryrun.ps1
pwsh -NoProfile -File scripts/tests/test-host-native-launcher.ps1
pwsh -NoProfile -File scripts/tests/test-preflight-ports.ps1
.\scripts\deploy.ps1 -DryRun
```

### Task 5: RED/GREEN Worktree frontend E2E runner

**Files:**
- Create: `scripts/dev/rebuild-worktree-e2e.ps1`
- Create: `scripts/lib/worktree-deploy-e2e.ps1`
- Create: `scripts/tests/test-worktree-deploy-e2e.ps1`
- Create: `web-viewer-sample/package-lock.json`
- Modify: `web-viewer-sample/playwright.config.ts`
- Modify: `web-viewer-sample/playwright.product-console.config.ts`
- Modify: `web-viewer-sample/e2e/real-ifc-storage-intake.spec.ts`
- Modify if needed: strict lineage / Kit visual specs

- [ ] **Step 1: Run GitNexus impact for TypeScript symbols before edit**

Use exact spec/config symbols or file context. Report HIGH/CRITICAL before proceeding. PowerShell remains under the accepted unavailable gate.

- [ ] **Step 2: Add runner RED tests with injected commands**

Cases:

- finds main-workspace preferred fixture when worktree storage is empty
- seeds durable top-level storage and records size/hash
- no fixture is nonzero `fixture_not_found`, never `blocked`
- missing local Playwright triggers bootstrap
- bootstrap failure is nonzero with log/rerun command
- skipped lineage/Kit test makes strict gate nonzero
- stale historical PNG cannot satisfy current run
- run manifest requires current-run screenshot + trace + report hashes
- source/deployment mismatch fails before browser

- [ ] **Step 3: Generate and commit npm lockfile**

Create lockfile without changing declared dependency ranges, then bootstrap with `npm ci`; verify local `@playwright/test` and Chromium. Do not rely on global Playwright 1.59.1.

- [ ] **Step 4: Make Playwright outputs run-specific**

Configs read explicit output/report/evidence env vars. Specs use the canonical `#demo-control` hash. Functional strict mode requires real conversion `ready`; `runtime_blocked`/timeout/failure and any `test.skip` are failures for this wrapper.

- [ ] **Step 5: Implement one-click wrapper**

```powershell
.\scripts\dev\rebuild-worktree-e2e.ps1 -Build
```

It calls `CurrentWorktree` rebuild in a child process/library-safe path, verifies source provenance, seeds fixture, bootstraps dependencies, runs live shell smoke + strict real IFC functional slice, and optionally strict conversion/Kit visual layers. It writes a run-specific manifest and returns nonzero on any required layer.

- [ ] **Step 6: Define honest result layers**

Record separately:

- `shell_smoke_passed`
- `real_ifc_intake_ready`
- `conversion_ready_observed`
- `governance_semantic_observed`
- `kit_webrtc_visual_observed`

Only the first two are the minimum worktree frontend E2E gate. Full-system claim requires governance semantic + Kit visual; skipped/not-observed never counts as passed.

- [ ] **Step 7: Run focused tests and viewer checks**

```powershell
pwsh -NoProfile -File scripts/tests/test-worktree-deploy-e2e.ps1
Set-Location web-viewer-sample
npm ci
npm run test
npm run build
npx playwright test --list
```

### Task 6: Replace stale-mtime evidence heuristic

**Files:**
- Modify: `scripts/hooks/require-gstack-evidence.ps1`
- Create or modify: focused hook test under `scripts/tests/`

- [ ] **Step 1: Add RED freshness tests**

Fresh checkout of tracked historical PNG must not pass. Manifest with wrong branch/source hash、failed exit、skips或 missing artifact hash must not pass. Current branch/source manifest with passed required layers and readable hashes passes.

- [ ] **Step 2: Implement manifest gate**

Find newest `artifacts/e2e/runs/*/manifest.json`; validate current repo/branch/source commit+patch fingerprint, current-run timestamps, required layer states and artifact hashes. Keep hook fail-open only when no frontend diff; frontend diff with invalid evidence stays deny.

- [ ] **Step 3: Run hook tests**

No 24-hour PNG mtime check remains as pass authority.

### Task 7: Wire verification inventory and CI

**Files:**
- Modify: `scripts/verify-all.ps1`
- Modify: `scripts/script-registry.json`
- Modify: `.github/workflows/ci.yml`
- Modify: relevant path classifier if present

- [ ] **Step 1: Register new scripts/tests**

Keep fixed-D / Docker / Kit real rebuild out of ordinary PR CI. Include deterministic temp/fake transaction、PID、port、deploy guards、E2E runner contract tests in affected-only jobs.

- [ ] **Step 2: Add destructive-safety test to local aggregate**

Ensure junction, clone-failure env preservation, lock and rename rollback cases run via `verify-all` or a named deploy-script suite.

- [ ] **Step 3: Run changed-path CI equivalents locally**

```powershell
pwsh -NoProfile -File scripts/verify-all.ps1
```

If full aggregate is too broad, run the exact affected classifier output and record what was not run.

### Task 8: Update governance and operator docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/agents/product-operability-and-script-contract.md`
- Modify: `docs/agents/sub-repo-verify-commands.md`
- Modify: `docs/agents/github-workflow.md`
- Modify: `scripts/SCRIPT_CONTRACT.md`
- Modify: old rebuild design with a superseded pointer
- Keep: this design and plan

- [ ] **Step 1: Document two source modes**

Preserve exact default origin/main command. Add explicit worktree command and state that CurrentWorktree provenance contains commit+patch+untracked manifest; it is not merged-main evidence.

- [ ] **Step 2: Update worktree workflow exception**

Replace the old absolute prohibition on fixed-D from unmerged worktrees with the narrow user-approved exception: only the dedicated explicit CurrentWorktree rebuild/E2E helper may materialize a worktree into fixed test deploy; ordinary deploy commands remain prohibited.

- [ ] **Step 3: Document evidence and state semantics**

List route、button、fixture、visible success、command、screenshot/trace、known gaps. State `blocked` is not the wrapper 終態 and full-system requires governance + Kit visual.

- [ ] **Step 4: Verify doc indexes and line budgets**

Keep AGENTS ≤250 and CLAUDE ≤130; sub-file sets remain identical.

### Task 9: Three-layer verification before fixed deployment

**Files:** all changed files

- [ ] **Step 1: Builder self-check**

Run focused suites from Tasks 2-7 and `git diff --check`. Inspect logs for secrets and absolute env values.

- [ ] **Step 2: Independent correctness review**

Reviewer must attack source equivalence、failure ordering、rollback boundary、skip-is-not-pass、wrong-service health、tests that merely assert mocks。Resolve all high findings or record explicit user decision.

- [ ] **Step 3: Adversarial risk review**

Security/deploy reviewer covers junction traversal、PID reuse、ACL/backup exposure、concurrent runs、TOCTOU、credential URL redaction、unknown process ownership、stale evidence。No fixed-D run until high findings close.

- [ ] **Step 4: Run GitNexus detect_changes advisory gate**

```powershell
gitnexus detect-changes --scope compare --base-ref main --repo <worktree>
```

Use current CLI syntax. If PowerShell remains unsupported, report unavailable honestly; TypeScript changes must still have graph/raw-source review.

### Task 10: Same-volume rehearsal, real rebuild, and browser evidence

**Files written at runtime:** temp sibling, fixed deployment, durable test fixture, ignored run evidence

- [ ] **Step 1: Rehearse transaction on same D: volume temp sibling**

Validate ACL behavior、lock contention、reparse rejection、two-rename rollback、open-handle behavior without touching fixed deployment. Clean only verified temp paths.

- [ ] **Step 2: Run explicit worktree one-click command**

```powershell
.\scripts\dev\rebuild-worktree-e2e.ps1 -Build
```

This requires permission to modify `D:\Users\deploy`, stop only identity-proven deploy processes, use Docker/Kit and install locked dependencies. Capture deployment/source SHA, patch hash, ports, PIDs and evidence paths.

- [ ] **Step 3: Inspect Playwright artifacts**

Open current-run screenshot/trace/report. Require zero required skips, strict real IFC ready state, no console errors relevant to the flow, no failed network request on required APIs.

- [ ] **Step 4: Run gstack browser cross-check**

Use the installed gstack browse binary only after its setup gate. Navigate once to canonical `#demo-control`, snapshot interactive controls, verify button/state, inspect console/network, capture annotated current-run screenshot, and visually read the PNG.

- [ ] **Step 5: Re-run origin/main default contract separately if requested**

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

Do not conflate this merged-main evidence with CurrentWorktree evidence.

### Task 11: Final regression and handoff

- [ ] **Step 1: Run full affected validation**

Repeat focused PowerShell suites, viewer unit/build/list, docs line-budget checks, registry, CI-local checks and `git diff --check`.

- [ ] **Step 2: Verify worktree cleanliness boundaries**

List only intended tracked diffs. Ignore `.gitnexus` local index and current-run ignored artifacts; do not include GitNexus auto-generated count drift or user main-checkout changes.

- [ ] **Step 3: Final evidence report**

Separate Verified facts / Inferences / Unverified risks / Next actions. Include changed files、baseline vs final tests、fixed deployment/recovery paths、Frontend route、Main button、Fixture、Visible state、E2E command、Screenshot/trace、Kit/governance layer status。Never label skipped/not-observed as passed.
