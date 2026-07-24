# Cross-Service Structured Log Baseline Production Wiring Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 補齊使用者於 2026-07-24 核准的 production trace carriers，讓受支援的 PowerShell smoke runner、coordinator、streaming conversion authority、真 viewer bootstrap 以同一個既有 `ifc_ready_job_id` 作 root trace，並以真 runtime JSONL 完成 OpenSpec 10.0.1–10.5。

**Architecture:** coordinator 以 `ifc_ready_job_id` 作根 trace，dispatch 時送 `X-Trace-Id`，session/open payload與 viewer redirect保留同一值；streaming authority驗證、持久化並將 trace傳到 lifecycle logger與 `convert-ifc-to-usdc.ps1 -TraceId`；viewer factory在回傳前只把一筆 browser-safe `env_snapshot` enqueue 到既有 buffer，`main.tsx` 建唯一 logger並安裝 global handlers；`smoke-bscheme-intake.ps1` 在 intake response後切換同一 trace，透過 Playwright helper載入真 production viewer URL再 close session。不得以手工四-adapter harness、同步 XHR、parent-only trace link或測試 fixture取代 production carriers。

**Tech Stack:** TypeScript/Node.js 20/Vitest/tsx、Python 3/FastAPI/pytest、PowerShell 7、React/Vite/Playwright、JSON Schema draft-07、OpenSpec CLI、GitNexus、Windows host-native Kit/conversion runtime。

## P1 impact and risk record

- `StreamingConversionClient.createConversionJob`: GitNexus LOW，1 direct caller、1 process。
- `IfcReadyConversionPipeline.dispatchJob`: LOW。
- `ifcReadyReviewSessionOpenPayload`: MEDIUM，67 impacted、1 direct caller、`createCoordinatorApp` process。
- `buildCoordinatorOpenUrl`: MEDIUM，68 impacted、2 direct callers、2 processes；mitigation 是只新增合法 `trace_id` query、保留 standalone call 相容性並跑全部 coordinator verify。
- `createBrowserLogger`: LOW，0 upstream。
- `main.tsx`: LOW，0 upstream。
- `scripts/smoke-bscheme-intake.ps1`: LOW，3 affected。
- Python `create_conversion_api_app`、`StreamingConversionStore.create_conversion_job`、`StreamingConversionStore.complete_conversion_job`、`Ifc2UsdcPowershellConverterAdapter.convert`、`_run_powershell_conversion` 在 branch 明確 re-index 後仍不在健康 index：P1狀態為 `impact_unavailable` hard gate，不是 advisory。P3不得開始任何 production edit，直到這五個 symbol 的正式 GitNexus impact全部回傳非 UNKNOWN，或使用者對這份具名 symbol清單明確 sign-off；原始碼搜尋、pytest與 Git diff只能補充證據，不能解鎖 gate或被寫成 GitNexus pass。

## P3 start gate (not a commit task)

每次重新進入 P3 都從 worktree root 重建變數，不依賴前一個 shell：

```powershell
$root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
Set-Location -LiteralPath $root
$branch = git branch --show-current
if ($branch -ne 'codex/openspec/cross-service-structured-log-baseline') { throw "wrong branch: $branch" }
git status --short --branch
git fetch origin +refs/heads/main:refs/remotes/origin/main
if (git status --porcelain) { throw 'P3 requires a clean worktree before the first implementation task' }
$branchPrs = @(gh pr list --head $branch --state all --json number,state,url,headRefName | ConvertFrom-Json)
$remoteHeads = @(git ls-remote --heads origin $branch)
$published = $branchPrs.Count -gt 0 -or $remoteHeads.Count -gt 0
$beforeBase = git merge-base HEAD origin/main
$originMain = git rev-parse origin/main
if ($beforeBase -ne $originMain) {
  if ($published) { git merge --no-edit origin/main } else { git rebase origin/main }
  if ($LASTEXITCODE -ne 0) { throw 'HELD: base freshness integration failed' }
  $baseChanged = $true
} else { $baseChanged = $false }
$boardSessionPath = Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline\board-session.txt'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $boardSessionPath) | Out-Null
$board = node scripts/dev/agents-board.mjs status --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'agents-board status --json failed' }
if (Test-Path -LiteralPath $boardSessionPath) {
  $boardSession = (Get-Content -Raw -LiteralPath $boardSessionPath).Trim()
} else {
  $recoverable = @($board.sessions | Where-Object { $_.status -ne 'ended' -and ([string]$_.task -match 'cross-service-structured-log-baseline|cross-service structured log') })
  if ($recoverable.Count -gt 1) { throw 'HELD: multiple matching board sessions require explicit ownership resolution' }
  $boardSession = if ($recoverable.Count -eq 1) { [string]$recoverable[0].session } else { [guid]::NewGuid().ToString('N').Substring(0,12) }
  $boardSession | Set-Content -LiteralPath $boardSessionPath -Encoding utf8
}
node scripts/dev/agents-board.mjs register --agent codex --session $boardSession --task 'spec-to-done cross-service structured log baseline'
if ($LASTEXITCODE -ne 0) { throw 'agents-board register/recover failed' }
$board = node scripts/dev/agents-board.mjs status --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'agents-board status --json failed' }
$overlapPattern = 'cross-service-structured-log-baseline|cross-service structured log|runtime lease.*(8005|5175|49104)|8005|5175|49104'
$overlaps = @($board.sessions | Where-Object { $_.status -ne 'ended' -and -not ($_.agent -eq 'codex' -and $_.session -eq $boardSession) -and ([string]$_.task -match $overlapPattern) })
if ($overlaps.Count -gt 0) { throw 'HELD: overlapping task/runtime lease is active; coordinate before P3' }
```

Expected: branch正確、worktree乾淨、`origin/main` fresh；unpublished branch rebase，published/PR branch merge。若 base changed，必須在任何 edit 前完整跑下方 affected baseline；不得沿用舊結果。board session id持久化並可用同 id register/recover；只對同 change、host-native runtime或隔離埠 lease重疊的 active session HELD，無關 session不阻擋，且絕不停止對方 process。

Bootstrap worktree-local dependencies once before Task 1:

```powershell
Push-Location bim-review-coordinator
npm ci
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'coordinator npm ci failed' }
Pop-Location
Push-Location web-viewer-sample
npm ci
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'viewer npm ci failed' }
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Playwright Chromium install failed' }
Pop-Location
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) { python -m venv .venv; if ($LASTEXITCODE -ne 0) { throw 'root venv creation failed' } }
& .\.venv\Scripts\python.exe -m pip install -r bim-streaming-server\requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'root venv requirements install failed' }
& .\.venv\Scripts\python.exe -c "import fastapi, jsonschema, pytest; print('python deps ok')"
if ($LASTEXITCODE -ne 0) { throw 'root venv import probe failed' }
```

Expected: both `npm ci` commands succeed, Chromium is installed, Python prints `python deps ok`; dependency/bootstrap artifacts remain untracked.

After bootstrap, run the full affected baseline whenever base changed:

```powershell
if ($baseChanged) {
  Push-Location bim-review-coordinator; npm run verify; $coordinatorExit=$LASTEXITCODE; Pop-Location
  if ($coordinatorExit -ne 0) { throw 'post-base coordinator verify failed' }
  Push-Location bim-streaming-server; & ..\.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q -p no:cacheprovider; $streamingExit=$LASTEXITCODE; Pop-Location
  if ($streamingExit -ne 0) { throw 'post-base streaming tests failed' }
  Push-Location web-viewer-sample; npm run verify; $viewerExit=$LASTEXITCODE; Pop-Location
  if ($viewerExit -ne 0) { throw 'post-base viewer verify failed' }
  & .\.venv\Scripts\python.exe -m pytest tests/contracts/structured-log -q -p no:cacheprovider
  if ($LASTEXITCODE -ne 0) { throw 'post-base root structured-log tests failed' }
  pwsh -NoProfile -File scripts/tests/test-struct-log.ps1
  if ($LASTEXITCODE -ne 0) { throw 'post-base PowerShell structured-log tests failed' }
}
```

Finally, resolve the Python impact hard gate with these exact formal calls (not shell comments or manual substitutes):

```text
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"create_conversion_api_app",direction:"upstream"})
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"StreamingConversionStore.create_conversion_job",direction:"upstream"})
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"StreamingConversionStore.complete_conversion_job",direction:"upstream"})
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"Ifc2UsdcPowershellConverterAdapter.convert",direction:"upstream"})
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"_run_powershell_conversion",direction:"upstream"})
```

Expected: all five return formal non-UNKNOWN risk before Task 1. If any remains absent/UNKNOWN, record `impact_unavailable` and HELD unless the user explicitly signs off this exact list.

### Task 1: Coordinator root trace dispatch and viewer carrier

**Files:**

- Modify: `bim-review-coordinator/src/services/streamingConversionClient.ts`
- Modify: `bim-review-coordinator/src/services/ifcReadyConversionPipeline.ts`
- Modify: `bim-review-coordinator/src/app.ts`
- Test: `bim-review-coordinator/tests/streaming-conversion-client.test.ts`
- Test: `bim-review-coordinator/tests/auto-poll-conversion.test.ts`
- Test: `bim-review-coordinator/tests/local-web-view.test.ts`
- Test: `bim-review-coordinator/tests/host-native-conversion-ingest.test.ts`

- [ ] Reconstruct task state and rerun exact impacts before editing.

  ```powershell
  $root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
  Set-Location -LiteralPath $root
  git status --short
  ```

  ```text
  mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"createConversionJob",direction:"upstream"})
  mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"dispatchJob",direction:"upstream"})
  mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"ifcReadyReviewSessionOpenPayload",direction:"upstream"})
  mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"buildCoordinatorOpenUrl",direction:"upstream"})
  mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"buildViewerRedirectUrl",direction:"upstream"})
  ```

  Expected: no unexpected dirty files; risks remain LOW/MEDIUM. Any new HIGH is reported with callers/processes before continuing; CRITICAL is HELD.

- [ ] Add failing tests for the exact carrier contract.

  Tests must assert:

  ```typescript
  expect(fetchInit.headers).toMatchObject({ "X-Trace-Id": ifcReadyJobId });
  expect(open.body.trace_id).toBe(ifcReadyJobId);
  expect(new URL(open.body.open_url).searchParams.get("trace_id")).toBe(ifcReadyJobId);
  expect(new URL(redirect.headers.location).searchParams.get("trace_id")).toBe(ifcReadyJobId);
  ```

  Also assert malformed or untrusted `trace_id` query is not forwarded, standalone session URLs remain valid without a root trace, and auto-poll lifecycle records use the root trace instead of a newly minted `stream_conv_20260724120000_deadbeef` trace.

  ```powershell
  Push-Location bim-review-coordinator
  npm test -- --run tests/streaming-conversion-client.test.ts tests/auto-poll-conversion.test.ts tests/local-web-view.test.ts tests/host-native-conversion-ingest.test.ts
  Pop-Location
  ```

  Expected before implementation: new assertions fail because `X-Trace-Id`, response `trace_id`, and viewer query are absent.

- [ ] Implement the minimum carrier changes.

  Required shape:

  ```typescript
  async createConversionJob(event, binding, traceId: string) {
    // existing payload and auth headers stay unchanged
    headers: this.authHeaders({
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Trace-Id": traceId,
    });
  }

  // dispatchJob: existing IFC-ready id already starts ifcready_; do not prefix again.
  const rootTraceId = jobId;
  const dispatch = await this.streamingClient.createConversionJob(pending.event, binding, rootTraceId);
  this.structLog?.withTraceId(rootTraceId).network("ifcReadyDispatch", "conversion dispatched", {
    direction: "outbound", protocol: "http", peer: "streaming-server", status: dispatch.status,
    path: "/api/conversions/ifc-to-usdc",
  });
  ```

  Pass `rootTraceId` into the poller callback so its lifecycle/anomaly logs retain the root. Change `buildCoordinatorOpenUrl(config, session, traceId?)` to set `trace_id` only after the same safe-id validation used for IFC-ready ids. `ifcReadyReviewSessionOpenPayload` returns `trace_id` and calls the URL builder with `job.ifc_ready_job_id`; `VIEWER_REDIRECT_QUERY_PARAMS` forwards only validated `trace_id`. Update both auto-session and replay paths; standalone sessions omit it and continue minting their existing `rev_` trace. When an IFC-ready-derived session opens or closes, emit additive coordinator lifecycle records through `structLog.withTraceId(linkedJob.ifc_ready_job_id)` while leaving the existing EventLog JSONL/API contract unchanged.

- [ ] Run focused tests and coordinator verify.

  ```powershell
  Push-Location bim-review-coordinator
  npm test -- --run tests/streaming-conversion-client.test.ts tests/auto-poll-conversion.test.ts tests/local-web-view.test.ts tests/host-native-conversion-ingest.test.ts
  npm run verify
  Pop-Location
  ```

  Expected: focused tests and full coordinator build/tests pass; existing URL/session response fields remain byte-compatible except additive `trace_id`/query.

- [ ] Detect scope and create the tracked checkpoint.

  First run:

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  git diff --check
  git add -- bim-review-coordinator/src/services/streamingConversionClient.ts bim-review-coordinator/src/services/ifcReadyConversionPipeline.ts bim-review-coordinator/src/app.ts bim-review-coordinator/tests/streaming-conversion-client.test.ts bim-review-coordinator/tests/auto-poll-conversion.test.ts bim-review-coordinator/tests/local-web-view.test.ts bim-review-coordinator/tests/host-native-conversion-ingest.test.ts
  git diff --cached --check
  git commit -m "task#1: propagate IFC-ready root trace in coordinator" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected: one Task 1 commit; no generated logs/build output staged.

### Task 2: Streaming authority persistence, lifecycle, and converter propagation

**Files:**

- Modify: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py`
- Modify: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`
- Test: `bim-streaming-server/tests/test_conversion_authority_api.py`
- Test: `bim-streaming-server/tests/test_host_native_conversion_service.py`

- [ ] Reconstruct state and re-confirm the formal impact gate before editing; manual source inspection is supplemental only.

  ```powershell
  $root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
  Set-Location -LiteralPath $root
  git status --short
  rg -n 'def create_conversion_api_app|def create_conversion_job|def complete_conversion_job|def convert\(|def _run_powershell_conversion' bim-streaming-server/source bim-streaming-server/tests
  ```

  Repeat the five exact `mcp__gitnexus__impact(...)` calls from the P3 gate. Expected: each returns formal non-UNKNOWN risk, or a previously recorded explicit user sign-off names all unresolved symbols. Otherwise Task 2 is HELD; source/test evidence does not substitute for formal impact.

- [ ] Add failing API/store/converter tests.

  Tests must cover: valid `X-Trace-Id=ifcready_1779687625000_064c6813` is persisted as `trace_id`; replay returns the same trace; missing header falls back to the generated conversion job id; whitespace/control/overlength/unknown-prefix headers return 400; lifecycle records for queued/running/succeeded/failed use persisted trace; converter subprocess command contains exactly one `-TraceId $rootTraceId` pair.

  ```powershell
  Push-Location bim-streaming-server
  & ..\.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q -p no:cacheprovider
  Pop-Location
  ```

  Expected before implementation: new trace persistence/header/command assertions fail.

- [ ] Implement validation, persistence, lifecycle logging, and converter propagation.

  Required behavior:

  ```python
  inbound_trace = _validated_trace_id(request.headers.get("X-Trace-Id"))
  job = store.create_conversion_job(ifc_ready_event, trace_id=inbound_trace)

  # Inside create_conversion_job, after conversion_job_id exists:
  effective_trace = trace_id or conversion_job_id
  job["trace_id"] = effective_trace

  # Converter adapter:
  trace_id = str(job.get("trace_id") or job["conversion_job_id"])
  self._run_powershell_conversion(ifc_path=ifc_path, output_dir=output_dir, trace_id=trace_id)
  cmd += ["-TraceId", trace_id]
  ```

  Build one `streaming-server` structured logger when `create_conversion_api_app` constructs the app; use `with_trace_id(job["trace_id"])` for inbound network plus conversion lifecycle transitions. Do not create a logger per request (which would violate exactly-one env snapshot per logger run). Keep trace in persisted job/read/result projections; never accept arbitrary header bytes or a second `ifcready_` prefix.

- [ ] Run the affected service tests.

  ```powershell
  Push-Location bim-streaming-server
  & ..\.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q -p no:cacheprovider
  Pop-Location
  ```

  Expected: all affected streaming tests pass; test records show root trace on success and failure; PowerShell command assertion includes `-TraceId` once.

- [ ] Commit the streaming checkpoint with manual-scope disclosure.

  Run before staging:

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  git diff --check
  git diff --name-only
  git add -- bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py bim-streaming-server/tests/test_conversion_authority_api.py bim-streaming-server/tests/test_host_native_conversion_service.py
  git diff --cached --check
  git commit -m "task#2: persist streaming conversion root trace" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected: one Task 2 commit; durable state records the formal Python impacts, or the explicit user sign-off that unlocked `impact_unavailable`, without claiming UNKNOWN as pass.

### Task 3: Browser-safe env snapshot in `createBrowserLogger`

**Files:**

- Modify: `web-viewer-sample/src/lib/structLog.ts`
- Test: `web-viewer-sample/scripts/verify-struct-log.mjs`

- [ ] Reconstruct state and rerun impact for `createBrowserLogger`.

  ```powershell
  $root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
  Set-Location -LiteralPath $root
  git status --short
  ```

  ```text
  mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"createBrowserLogger",direction:"upstream"})
  ```

  Expected: LOW/0 upstream or disclosed newer risk.

- [ ] Extend the adapter verification first. Assert factory return already has exactly one buffered `env_snapshot`; record uses the supplied trace; `vars` contains only explicit browser-safe entries; query string, local/session storage, cookies, tokens and arbitrary window properties never appear. After `flush()`, the same single record reaches existing async transport. Existing buffer/threshold tests must count the startup record explicitly instead of disabling it.

  ```powershell
  Push-Location web-viewer-sample
  node scripts/verify-struct-log.mjs
  Pop-Location
  ```

  Expected before implementation: new assertion fails because buffer is empty after factory return.

- [ ] Add a narrow `browserSnapshotVars` option and enqueue exactly one record before return.

  Required shape:

  ```typescript
  export interface BrowserLoggerOptions {
    browserSnapshotVars?: EnvVar[];
  }

  const safeVars = sanitizeBrowserSnapshotVars(options.browserSnapshotVars ?? []);
  append(buildRecord(state, "info", "env_snapshot", "bootstrap", "browser env snapshot", { vars: safeVars }));
  // return logger only after append; transport remains async through existing flush policy.
  ```

  Sanitization accepts only documented entry fields/key names and applies existing redaction/type-only rules. It never enumerates `window`, query values, cookies, storage, or `import.meta.env` wholesale. Do not add synchronous XHR or a second startup snapshot.

- [ ] Run viewer checks and commit.

  Run before staging:

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  Push-Location web-viewer-sample
  npm run typecheck
  node scripts/verify-struct-log.mjs
  Pop-Location
  git diff --check
  git add -- web-viewer-sample/src/lib/structLog.ts web-viewer-sample/scripts/verify-struct-log.mjs
  git diff --cached --check
  git commit -m "task#3: enqueue browser-safe env snapshot" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected: typecheck and adapter verification pass; exactly one Task 3 commit.

### Task 4: Production viewer singleton, trusted query carrier, and real bootstrap probe

**Files:**

- Create: `web-viewer-sample/src/lib/structLogBootstrap.ts`
- Create: `web-viewer-sample/src/lib/structLogBootstrap.test.ts`
- Modify: `web-viewer-sample/src/main.tsx`
- Create: `web-viewer-sample/scripts/smoke-struct-log-bootstrap.mjs`

- [ ] Reconstruct state and run impact for `main.tsx`; treat the new bootstrap module as zero-upstream until imported.

  ```powershell
  $root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
  Set-Location -LiteralPath $root
  git status --short
  ```

  ```text
  mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"main.tsx",direction:"upstream"})
  ```

  Expected: LOW/0 or disclosed newer risk.

- [ ] Write failing bootstrap tests for a pure `traceIdFromSearch(search)` validator and singleton creator. Accept only one `trace_id` matching documented prefixes and safe-id length; reject double-prefix, duplicates, whitespace/control characters, unknown prefixes and arbitrary query payload. Assert singleton identity, one global-handler install, one initial env snapshot, and `window.__structLog` availability.

  ```powershell
  Push-Location web-viewer-sample
  npm test -- --run src/lib/structLogBootstrap.test.ts
  Pop-Location
  ```

  Expected before implementation: module/test fails because bootstrap does not exist.

- [ ] Implement the pure validator and singleton, then wire `main.tsx` before React render.

  The singleton calls `createBrowserLogger` exactly once with the validated root trace and an explicit safe list such as build mode, viewer port presence, browser language type/length and secure-context boolean; raw query value is used only as the record envelope trace and never included in `vars`. Call `installGlobalHandlers(logger, window)` once. Preserve existing `__INITIAL_SESSION_FROM_QUERY__` behavior and remove the startup `console.info` only if replaced by `logger.lifecycle` with the same diagnostics.

- [ ] Add a Playwright CLI helper that opens a supplied `--url`, waits for `window.__structLog`, calls its real async `flush()`, and exits nonzero unless the production page reports the expected trace. It must never import/call `createBrowserLogger` directly.

  ```javascript
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((trace) => window.__structLog?.logger?.traceId === trace, expectedTrace);
  await page.evaluate(() => window.__structLog.logger.flush());
  ```

- [ ] Run viewer tests/build and commit.

  Run before staging:

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  Push-Location web-viewer-sample
  npm test -- --run src/lib/structLogBootstrap.test.ts
  npm run verify
  Pop-Location
  git diff --check
  git add -- web-viewer-sample/src/lib/structLogBootstrap.ts web-viewer-sample/src/lib/structLogBootstrap.test.ts web-viewer-sample/src/main.tsx web-viewer-sample/scripts/smoke-struct-log-bootstrap.mjs
  git diff --cached --check
  git commit -m "task#4: wire production viewer structured logger" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected: bootstrap tests and full viewer verify pass; helper touches the true page path; one Task 4 commit.

### Task 5: Supported PowerShell smoke participant and production browser step

**Files:**

- Modify: `scripts/smoke-bscheme-intake.ps1`
- Create: `scripts/tests/test-smoke-bscheme-structured-log.ps1`

- [ ] Reconstruct state and rerun impact for the script before editing.

  ```powershell
  $root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
  Set-Location -LiteralPath $root
  git status --short
  ```

  ```text
  mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"scripts/smoke-bscheme-intake.ps1",direction:"upstream"})
  ```

  Expected: LOW/3 affected or disclosed newer risk.

- [ ] Create a narrow script test using a temporary log root and mocked request/browser functions. Assert one scripts env snapshot at logger creation; intake response switches via `Set-StructLogTraceId` to exact `ifc_ready_job_id`; poll, review-session open, viewer-bootstrap and close lifecycle records all use the root trace; failure closes no fake session and records an anomaly; output evidence includes root trace/open URL/session/close status without secret values.

  ```powershell
  pwsh -NoProfile -File scripts/tests/test-smoke-bscheme-structured-log.ps1
  ```

  Expected before implementation: test fails because the smoke owns no structured logger/session/browser close path.

- [ ] Modify the supported smoke, not a separate adapter harness.

  At script startup import `StructLog.psm1` and create one scripts logger (emits one startup snapshot under its generated `script_run_20260724_120000_a1b2c3`-shaped trace). Immediately after the accepted intake response:

  ```powershell
  $rootTraceId = [string](Get-JsonProperty $job 'ifc_ready_job_id')
  Set-StructLogTraceId -Logger $StructLogger -TraceId $rootTraceId
  $StructLogger | Write-StructLifecycle -Msg 'IFC-ready intake accepted' -Data @{
      phase='active'; subject_kind='script_run'; subject_id=$StructLogger.RunId
  }
  ```

  After conversion success call `POST /api/external/ifc-ready/$rootTraceId/review-session`; require response `trace_id` equals root and capture `$openUrl`/`$sessionId`. Invoke `node web-viewer-sample/scripts/smoke-struct-log-bootstrap.mjs --url $openUrl --trace-id $rootTraceId`; only after it succeeds call `POST /api/review-sessions/$sessionId/close`. Add root trace/session/open URL/browser status/close status to the existing evidence tier IDs. Never log webhook/internal token values.

- [ ] Run both PowerShell log suites and syntax parse.

  ```powershell
  pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/smoke-bscheme-intake.ps1)) | Out-Null"
  pwsh -NoProfile -File scripts/tests/test-struct-log.ps1
  pwsh -NoProfile -File scripts/tests/test-smoke-bscheme-structured-log.ps1
  ```

  Expected: syntax parse and both suites pass; test proves real page helper invocation rather than direct adapter injection.

- [ ] Commit the smoke checkpoint.

  Run before staging:

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  git diff --check
  git add -- scripts/smoke-bscheme-intake.ps1 scripts/tests/test-smoke-bscheme-structured-log.ps1
  git diff --cached --check
  git commit -m "task#5: join smoke runner to IFC-ready root trace" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected: one Task 5 commit; no smoke JSON/runtime log staged.

### Task 6: Runtime JSONL validator, production-carrier integration gate, and 10.0 closeout

**Files:**

- Create: `tests/contracts/structured-log/validate_runtime_logs.py`
- Create: `tests/contracts/structured-log/test_validate_runtime_logs.py`
- Modify: `docs/contracts/structured-log-schema.md`
- Modify: `openspec/changes/cross-service-structured-log-baseline/tasks.md`

- [ ] Reconstruct state and add a validator test fixture that represents actual `logs/coordinator/2026-07-24/*.jsonl`-shaped layout for all four service directories. Test malformed JSON, schema failure, missing service, wrong trace, absent/duplicate env snapshot, secret-pattern raw value, and success with all four units.

  ```powershell
  $root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
  Set-Location -LiteralPath $root
  & .\.venv\Scripts\python.exe -m pytest tests/contracts/structured-log/test_validate_runtime_logs.py -q -p no:cacheprovider
  ```

  Expected before implementation: import/file-not-found failure.

- [ ] Implement CLI validation against `tests/contracts/structured-log/schema.json`, never against a copied schema, and expose the exact runtime flags used in Task 7.

  ```powershell
  & .\.venv\Scripts\python.exe tests/contracts/structured-log/validate_runtime_logs.py --help
  ```

  Expected: help exits 0 and lists `--log-root`, `--trace-id`, `--require-services`, `--require-one-env-snapshot-per-run`, and `--output`.

  The JSON result lists files/line numbers/event counts and redaction violations but never raw env values. Exit nonzero for malformed/schema-invalid lines, missing root trace service, missing/duplicate snapshot per `(service,run_id)`, or a secret-pattern key without a redaction marker.

- [ ] Update the contract doc with the clarified root trace, browser async enqueue semantics, supported smoke participant and production-carrier diagram. Mark 10.0.1–10.0.5 `[x]` only after Tasks 1–5 tests and this validator test pass; leave 10.1–10.5 open.

- [ ] Run cross-service affected tests and strict OpenSpec.

  ```powershell
  & .\.venv\Scripts\python.exe -m pytest tests/contracts/structured-log -q -p no:cacheprovider
  Push-Location bim-review-coordinator
  npm run verify
  Pop-Location
  Push-Location bim-streaming-server
  & ..\.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q -p no:cacheprovider
  Pop-Location
  Push-Location web-viewer-sample
  npm run verify
  Pop-Location
  pwsh -NoProfile -File scripts/tests/test-struct-log.ps1
  pwsh -NoProfile -File scripts/tests/test-smoke-bscheme-structured-log.ps1
  npx --no-install openspec change validate cross-service-structured-log-baseline --strict
  npx --no-install openspec validate --all --strict
  ```

  Expected: all affected suites and both strict validations pass; no historical pass count is reused.

- [ ] Run detect/manual scope gates and commit.

  First run:

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  git diff --name-status origin/main...HEAD
  git diff --check
  git add -- tests/contracts/structured-log/validate_runtime_logs.py tests/contracts/structured-log/test_validate_runtime_logs.py docs/contracts/structured-log-schema.md openspec/changes/cross-service-structured-log-baseline/tasks.md
  git diff --cached --check
  git commit -m "task#6: validate production structured-log carriers" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected: 10.0.1–10.0.5 checked, 10.1–10.5 open, one Task 6 commit; Python index misses remain disclosed.

### Task 7: Acquire an isolated runtime attempt lease and validate prerequisites

**Files:** Generate only gitignored `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/attempt-*/**`.

- [ ] Create a fresh attempt and prove that it can run without touching default/deployment processes.

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location -LiteralPath $root
  $attemptId='attempt-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-'+(git rev-parse --short HEAD)
  $attemptRoot=Join-Path $root "artifacts\spec-to-done\cross-service-structured-log-baseline\evidence\$attemptId"; $logRoot=Join-Path $attemptRoot 'logs'
  $fixtureRoot='C:\Repos\active\iot\AI-BIM-governance\storage'; $ports=@(8005,5175,49104)
  if(Test-Path $attemptRoot){throw 'HELD: attempt already exists'}; New-Item -ItemType Directory -Force $logRoot|Out-Null
  $attemptRoot|Set-Content (Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.txt')
  $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -in $ports)
  if($listeners){$listeners|ConvertTo-Json -Depth 4|Set-Content (Join-Path $attemptRoot 'blocked-listeners.json'); throw 'HELD: isolated port already owned; do not stop it'}
  $fixture=@(Get-ChildItem -LiteralPath $fixtureRoot -Filter *.ifc -File)[0]; if(-not $fixture){throw 'HELD: IFC fixture absent'}
  $python=Join-Path $root '.venv\Scripts\python.exe'; $kit=Join-Path $root 'bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe'
  $hoops=@(Get-ChildItem -LiteralPath (Join-Path $root 'bim-streaming-server\_build\windows-x86_64\release') -Recurse -Filter hoops_main.py -File -ErrorAction SilentlyContinue|Where-Object FullName -match 'omni[\\/]services[\\/]convert[\\/]cad[\\/]services')[0]
  $config=Join-Path $root 'bim-streaming-server\config\ifc-hoops-converter.json'; $wrapper=Join-Path $root 'bim-streaming-server\scripts\kit-cad-convert-and-quit.py'
  foreach($p in @($python,$kit,$config,$wrapper,$hoops.FullName)){if(-not $p -or -not(Test-Path -LiteralPath $p)){throw "HELD: converter prerequisite missing: $p"}}
  @{attempt_id=$attemptId;head=(git rev-parse HEAD);base=(git rev-parse origin/main);ports=$ports;fixture=@{name=$fixture.Name;size=$fixture.Length;sha256=(Get-FileHash $fixture.FullName -Algorithm SHA256).Hash};machine=@{os=[Environment]::OSVersion.VersionString;pwsh=$PSVersionTable.PSVersion.ToString();node=(node --version);python=(& $python --version)}}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $attemptRoot 'attempt-manifest.json')
  ```

  Expected: only ports `8005/5175/49104` are used. No `start-all`, default-port cleanup helper, deployment checkout, or stop-by-port is allowed. The real converter needs the local Kit executable and HOOPS/config/wrapper assets above; absence is HELD.

### Task 8: Launch only attempt-owned conversion, coordinator, and viewer processes

- [ ] Reconstruct every variable, create an ownership lease/pidfiles, and launch individual commands with stdout/stderr plus command provenance.

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  $attemptRoot=(Get-Content -Raw 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.txt').Trim(); $logRoot=Join-Path $attemptRoot 'logs'; $fixtureRoot='C:\Repos\active\iot\AI-BIM-governance\storage'; $ports=@(8005,5175,49104)
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -in $ports)){throw 'HELD: isolated port collision'}
  $python=Join-Path $root '.venv\Scripts\python.exe'; $leasePath=Join-Path $attemptRoot 'runtime-lease.json'; $provenance=Join-Path $attemptRoot 'command-provenance.jsonl'
  # Start-Process each command below with -PassThru and attempt-owned stdout/stderr paths.
  # Before each launch, set only its documented env, then restore the caller environment in finally.
  # conversion cwd=bim-streaming-server:
  # powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\start-host-native-conversion-service.ps1 -PythonExe $python
  # env STREAMING_CONVERSION_HOST=127.0.0.1, STREAMING_CONVERSION_PORT=49104, LOG_ROOT=$logRoot
  # coordinator cwd=bim-review-coordinator: npm.cmd run dev
  # env PORT=8005, VIEWER_PORT=5175, VIEWER_PUBLIC_BASE_URL=http://127.0.0.1:5175,
  # COORDINATOR_PUBLIC_BASE_URL=http://127.0.0.1:8005, STREAMING_CONVERSION_API_BASE=http://127.0.0.1:49104,
  # LOG_ROOT=$logRoot, STORAGE_ROOT=$fixtureRoot, and attempt-local session/event-store paths.
  # viewer cwd=web-viewer-sample: npm.cmd run dev -- --host 127.0.0.1 --port 5175 --strictPort
  # Persist PID, parent PID, executable path, UTC StartTime, cwd, exact argv/env key names and owned port after every successful launch.
  # Append command/cwd/start/end/exit-or-running status to command-provenance.jsonl; write one pidfile per process.
  ```

  Generate an attempt-local `shutdown.ps1` that reads `runtime-lease.json`, verifies each root PID's executable path and UTC StartTime still match, discovers only its descendant tree, stops descendants then root, and records `shutdown.json`. It must never stop a PID absent from/mismatching the lease. Wrap launch and health probes in `try/catch { & $shutdown; throw }`; fail closed if any process exits or `http://127.0.0.1:49104/health`, `http://127.0.0.1:8005/health`, or `http://127.0.0.1:5175/` does not become ready. Every native exit is checked and appended to provenance.

### Task 9: Run the supported smoke and guarantee shutdown

- [ ] Run the true production-carrier path inside `try/finally`; no hand-built harness is permitted.

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  $attemptRoot=(Get-Content -Raw 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.txt').Trim(); $logRoot=Join-Path $attemptRoot 'logs'; $fixtureRoot='C:\Repos\active\iot\AI-BIM-governance\storage'; $ports=@(8005,5175,49104)
  $shutdown=Join-Path $attemptRoot 'shutdown.ps1'; $smokePath=Join-Path $attemptRoot 'bscheme-readiness.json'; $provenance=Join-Path $attemptRoot 'command-provenance.jsonl'
  try {
    & .\scripts\smoke-bscheme-intake.ps1 -EvidencePath $smokePath -StorageRoot $fixtureRoot -CoordinatorBaseUrl 'http://127.0.0.1:8005' -StreamingConversionApiBase 'http://127.0.0.1:49104' -LivePollSeconds 180
    $code=$LASTEXITCODE; @{command='smoke-bscheme-intake.ps1';cwd=$root;exit_code=$code;finished_utc=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress|Add-Content $provenance
    if($code -ne 0){throw 'HELD: production smoke failed'}
  } finally { & $shutdown }
  if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -in $ports)){throw 'HELD: attempt-owned shutdown incomplete or port ownership changed'}
  ```

  Expected: intake→real conversion→review-session open→production viewer bootstrap→close uses one `ifcready_*` root trace. `finally` runs on success, failure, or interruption; shutdown/probe/timeline evidence remains in the attempt root.

### Task 10: Validate runtime evidence, commit it, and pass the implementation ship gate

**Files:** Create `docs/evidence/structured-log-baseline-2026-05-26.md`; modify active `tasks.md`.

- [ ] Reconstruct variables, call shutdown idempotently, validate JSONL, rerun affected checks, and author evidence only from artifacts.

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  $attemptRoot=(Get-Content -Raw 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.txt').Trim(); $logRoot=Join-Path $attemptRoot 'logs'; $fixtureRoot='C:\Repos\active\iot\AI-BIM-governance\storage'; $ports=@(8005,5175,49104)
  & (Join-Path $attemptRoot 'shutdown.ps1'); if($LASTEXITCODE -ne 0){throw 'HELD: shutdown verification failed'}
  $smoke=Get-Content -Raw (Join-Path $attemptRoot 'bscheme-readiness.json')|ConvertFrom-Json; $rootTrace=[string](($smoke.tiers|Where-Object tier -eq real_ifc_intake_conversion).ids.ifc_ready_job_id)
  if($rootTrace -notmatch '^ifcready_[A-Za-z0-9_.-]+$'){throw 'HELD: invalid root trace'}
  & .\.venv\Scripts\python.exe tests/contracts/structured-log/validate_runtime_logs.py --log-root $logRoot --trace-id $rootTrace --require-services coordinator streaming-server viewer scripts --require-one-env-snapshot-per-run --output (Join-Path $attemptRoot 'runtime-log-validation.json'); if($LASTEXITCODE -ne 0){throw 'HELD: runtime validation failed'}
  ```

  Evidence maps each OpenSpec 10.1–10.5 checkbox to fixture SHA-256, command provenance/exit codes, runtime lease, machine metadata, root-trace timeline/IDs, JSONL file-line counts, env-snapshot/redaction result, and shutdown proof. Preserve existing production carriers; never add a harness, sync XHR, secret/raw IFC contents, or claim WebRTC/render evidence. Run all Task 6 checks again, both strict OpenSpec validations, then mark 10.1–10.5 only where supported.

- [ ] Run exact final detect, commit the single tracked evidence checkpoint, then push/create PR before preflight.

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root; $branch=git branch --show-current
  git diff --check; git add -- docs/evidence/structured-log-baseline-2026-05-26.md openspec/changes/cross-service-structured-log-baseline/tasks.md; git diff --cached --check
  git commit -m "task#10: record structured log production evidence" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  git push -u origin $branch; if($LASTEXITCODE -ne 0){throw 'push failed'}
  $prUrl=gh pr create --base main --head $branch --title 'feat: wire cross-service structured log trace' --body-file (Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline\implementation-pr.md'); if($LASTEXITCODE -ne 0){throw 'PR create failed'}
  $prNumber=(gh pr view $branch --json number|ConvertFrom-Json).number
  .\scripts\dev\check-pr-local-preflight.ps1 -PrNumber $prNumber; if($LASTEXITCODE -ne 0){throw 'local preflight failed'}
  gh pr checks $prNumber --watch; if($LASTEXITCODE -ne 0){throw 'CI failed'}
  ```

  PR body includes Lane S, approved contract, impacts/`impact_unavailable` sign-off if applicable, tests, attempt path, fixture hash, runtime IDs, shutdown, known gaps, and `archive pending after implementation merge`. P6 merges only after required review/CI and explicit normal ship decision. Verify `gh pr view $prNumber --json state,mergeCommit` reports MERGED and `git merge-base --is-ancestor <mergeOid> origin/main` succeeds. Do not open a deployment checkout or enter P7 yet.

### Task 11: Post-merge archive PR and second P6 ship gate

- [ ] Only after Task 10 merge ancestry is proven, idempotently create/reuse the dedicated archive worktree, archive with `--skip-specs`, and prove canonical bytes unchanged.

  ```powershell
  $repo='C:\Repos\active\iot\AI-BIM-governance'; $archiveBranch='codex/openspec/archive-cross-service-structured-log-baseline'; $archiveWorktree='C:\Repos\active\iot\AI-BIM-governance\.worktrees\archive-cross-service-structured-log-baseline'; Set-Location $repo
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  $impl=gh pr view codex/openspec/cross-service-structured-log-baseline --json state,mergeCommit|ConvertFrom-Json; if($impl.state -ne 'MERGED'){throw 'HELD: implementation PR not merged'}
  git merge-base --is-ancestor $impl.mergeCommit.oid origin/main; if($LASTEXITCODE -ne 0){throw 'HELD: implementation merge absent from origin/main'}
  if(Test-Path $archiveWorktree){if((git -C $archiveWorktree branch --show-current) -ne $archiveBranch){throw 'HELD: archive worktree path owned by another branch'}}
  else { git show-ref --verify --quiet "refs/heads/$archiveBranch"; if($LASTEXITCODE -eq 0){git worktree add $archiveWorktree $archiveBranch}else{git worktree add -b $archiveBranch $archiveWorktree origin/main} }
  Set-Location $archiveWorktree; git merge --ff-only origin/main; if($LASTEXITCODE -ne 0){throw 'HELD: archive branch cannot fast-forward'}
  $canonical='openspec\specs\cross-service-structured-log-baseline\spec.md'; $before=(Get-FileHash $canonical -Algorithm SHA256).Hash
  npx --no-install openspec change validate cross-service-structured-log-baseline --strict; if($LASTEXITCODE -ne 0){throw 'pre-archive validation failed'}
  npx --no-install openspec archive cross-service-structured-log-baseline --skip-specs -y; if($LASTEXITCODE -ne 0){throw 'archive failed'}
  $after=(Get-FileHash $canonical -Algorithm SHA256).Hash; if($before -ne $after){throw 'HELD: canonical spec changed'}
  if(Test-Path 'openspec\changes\cross-service-structured-log-baseline'){throw 'HELD: active change remains'}
  npx --no-install openspec validate --specs --strict; npx --no-install openspec validate --all --strict; git diff --check
  git add -A -- openspec\changes\cross-service-structured-log-baseline openspec\changes\archive; git diff --cached --check
  git commit -m "openspec: archive cross-service structured log baseline" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

- [ ] Push the archive branch, create its PR, then run preflight with the real PR number and a separate P6 review/CI/ship decision.

  ```powershell
  git push -u origin $archiveBranch; if($LASTEXITCODE -ne 0){throw 'archive push failed'}
  $archiveUrl=gh pr create --base main --head $archiveBranch --title 'openspec: archive cross-service structured log baseline' --body 'Post-merge archive only; canonical spec hash unchanged.'; if($LASTEXITCODE -ne 0){throw 'archive PR create failed'}
  $archivePr=(gh pr view $archiveBranch --json number|ConvertFrom-Json).number
  .\scripts\dev\check-pr-local-preflight.ps1 -PrNumber $archivePr; if($LASTEXITCODE -ne 0){throw 'archive preflight failed'}
  gh pr checks $archivePr --watch; if($LASTEXITCODE -ne 0){throw 'archive CI failed'}
  ```

  Merge only after the second P6 review/CI/explicit ship decision. Fetch `origin/main`, prove the archive merge OID is an ancestor, active change is absent, canonical hash still matches, and archive PR is MERGED; then run final closeout, board `done --agent codex --session $boardSession`, and only then enter P7/hand off. No deployment checkout is used anywhere in Tasks 7–11.
