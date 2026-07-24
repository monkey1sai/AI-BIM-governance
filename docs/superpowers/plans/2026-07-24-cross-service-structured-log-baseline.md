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
- Python formal impacts（GitNexus 1.6.9 single-worker re-index）：`create_conversion_api_app` MEDIUM（2 direct、41 impacted）、`StreamingConversionStore.create_conversion_job` LOW（1 direct）、`StreamingConversionStore.complete_conversion_job` LOW（0 direct）、`Ifc2UsdcPowershellConverterAdapter.convert` MEDIUM（7 direct）、`_run_powershell_conversion` MEDIUM（5 direct、12 impacted）；all report no process and none is HIGH/CRITICAL。MEDIUM mitigation 是精準 API/store/adapter tests、保留既有 fallback與一次 `-TraceId` contract、Task 6全 affected verification。
- Index durability disclosure：為 formal probe暫時 negate `.gitnexusignore` 的動作已還原；未改 repo ignore policy。未來再跑 `analyze` 後，這些 Python symbols可能再次從 index消失。這不推翻本次已驗證 impact，但後續若要重新 impact，必須明確重訪 workaround並揭露，不得假裝 persistent coverage。

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
if (-not $published) { throw 'HELD: expected published branch/old PR #126 publication evidence is absent' }
$beforeBase = git merge-base HEAD origin/main
$originMain = git rev-parse origin/main
if ($beforeBase -ne $originMain) {
  git merge --no-edit origin/main
  if ($LASTEXITCODE -ne 0) { throw 'HELD: base freshness integration failed' }
}
$boardSessionPath = Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline\board-session.txt'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $boardSessionPath) | Out-Null
$board = node scripts/dev/agents-board.mjs status --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'agents-board status --json failed' }
if (Test-Path -LiteralPath $boardSessionPath) {
  $boardSession = (Get-Content -Raw -LiteralPath $boardSessionPath).Trim()
} elseif ($env:AGENTS_BOARD_SESSION) {
  $boardSession = $env:AGENTS_BOARD_SESSION.Trim()
} else {
  $owned = @($board.sessions | Where-Object { $_.status -ne 'ended' -and [IO.Path]::GetFullPath([string]$_.cwd) -eq [IO.Path]::GetFullPath($root) })
  if ($owned.Count -gt 1) { throw 'HELD: multiple sessions claim this exact worktree' }
  $boardSession = if ($owned.Count -eq 1) { [string]$owned[0].session } else { [guid]::NewGuid().ToString('N').Substring(0,12) }
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

Expected: branch正確、worktree乾淨、`origin/main` fresh。此 branch已 published（舊 PR #126/remote publication），所以 behind時只能 merge `origin/main`，絕不 rebase或 rewrite。board session只可由 `AGENTS_BOARD_SESSION`、持久化 marker或完全相同 cwd/worktree ownership恢復。

Bootstrap worktree-local dependencies once before Task 1:

```powershell
$root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
Set-Location -LiteralPath $root
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

After bootstrap, unconditionally run the full affected baseline in this same gate. Do not carry `$baseChanged` or any prior-shell result forward:

```powershell
$root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
Set-Location -LiteralPath $root
Push-Location bim-review-coordinator; npm run verify; $coordinatorExit=$LASTEXITCODE; Pop-Location
if ($coordinatorExit -ne 0) { throw 'coordinator baseline failed' }
Push-Location bim-streaming-server; & ..\.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q -p no:cacheprovider; $streamingExit=$LASTEXITCODE; Pop-Location
if ($streamingExit -ne 0) { throw 'streaming baseline failed' }
Push-Location web-viewer-sample; npm run verify; $viewerExit=$LASTEXITCODE; Pop-Location
if ($viewerExit -ne 0) { throw 'viewer baseline failed' }
& .\.venv\Scripts\python.exe -m pytest tests/contracts/structured-log -q -p no:cacheprovider
if ($LASTEXITCODE -ne 0) { throw 'root structured-log baseline failed' }
pwsh -NoProfile -File scripts/tests/test-struct-log.ps1
if ($LASTEXITCODE -ne 0) { throw 'PowerShell structured-log baseline failed' }
```

Record the already verified Python formal impacts and use these exact calls only when deliberately refreshing them:

```text
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"create_conversion_api_app",direction:"upstream"})
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"StreamingConversionStore.create_conversion_job",direction:"upstream"})
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"StreamingConversionStore.complete_conversion_job",direction:"upstream"})
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"Ifc2UsdcPowershellConverterAdapter.convert",direction:"upstream"})
mcp__gitnexus__impact({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",target:"_run_powershell_conversion",direction:"upstream"})
```

Expected baseline: MEDIUM/LOW/LOW/MEDIUM/MEDIUM with no processes and none HIGH. A future UNKNOWN after `analyze` is disclosed as the known `.gitnexusignore` durability limitation; it does not erase this P1 evidence, but any new edit surface requires a deliberate re-index/workaround decision. Any new HIGH is warned and re-planned; CRITICAL is HELD.

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
  Add an alternate-port CORS assertion: with `VIEWER_PUBLIC_BASE_URL=http://127.0.0.1:5175`, a viewer-log request/preflight from origin `http://127.0.0.1:5175` to coordinator `http://127.0.0.1:8005/api/internal/viewer-log` is allowed, while an untrusted origin remains rejected.

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

- [ ] Reconstruct state and record the verified formal impacts before editing; manual source inspection is supplemental.

  ```powershell
  $root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
  Set-Location -LiteralPath $root
  git status --short
  rg -n 'def create_conversion_api_app|def create_conversion_job|def complete_conversion_job|def convert\(|def _run_powershell_conversion' bim-streaming-server/source bim-streaming-server/tests
  ```

  Expected record: `create_conversion_api_app` MEDIUM/direct2/impacted41; create LOW/direct1; complete LOW/direct0; adapter convert MEDIUM/direct7; `_run_powershell_conversion` MEDIUM/direct5/impacted12; no processes, none HIGH. Also record that the temporary `.gitnexusignore` negation was restored and future analyze may lose coverage.

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

  Expected: one Task 2 commit; durable state records the formal Python LOW/MEDIUM impacts and the restored-ignore/index-durability disclosure.

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
- Modify: `web-viewer-sample/src/config/env.ts`
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

- [ ] Write failing bootstrap tests for a pure `traceIdFromSearch(search)` validator and singleton creator. Accept only one `trace_id` matching documented prefixes and safe-id length; reject double-prefix, duplicates, whitespace/control characters, unknown prefixes and arbitrary query payload. Assert singleton identity, one global-handler install, one initial env snapshot, and `window.__structLog` availability. With `coordinatorApiBase=http://127.0.0.1:8005`, assert the async endpoint is exactly `http://127.0.0.1:8005/api/internal/viewer-log`, never the Vite origin `:5175`; reject an untrusted coordinator base through the existing validator.

  ```powershell
  Push-Location web-viewer-sample
  npm test -- --run src/lib/structLogBootstrap.test.ts
  Pop-Location
  ```

  Expected before implementation: module/test fails because bootstrap does not exist.

- [ ] Implement the pure validator and singleton, then wire `main.tsx` before React render.

  The singleton calls `createBrowserLogger` exactly once with the validated root trace, explicit safe vars, and endpoint derived from the already validated `reviewEnv.coordinatorApiBase`: `${reviewEnv.coordinatorApiBase}/api/internal/viewer-log`. It must not derive transport from `window.location.origin`, so alternate-port runtime flushes to coordinator `:8005`, not Vite `:5175`. Call `installGlobalHandlers(logger, window)` once. Preserve existing `__INITIAL_SESSION_FROM_QUERY__` behavior and remove the startup `console.info` only if replaced by `logger.lifecycle` with the same diagnostics.

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
  git add -- web-viewer-sample/src/lib/structLogBootstrap.ts web-viewer-sample/src/lib/structLogBootstrap.test.ts web-viewer-sample/src/config/env.ts web-viewer-sample/src/main.tsx web-viewer-sample/scripts/smoke-struct-log-bootstrap.mjs
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

  Expected: 10.0.1–10.0.5 checked, 10.1–10.5 open, one Task 6 commit; verified Python impacts and future re-analyze durability risk remain disclosed.

### Task 7: Add the owned isolated runtime-evidence runner

**Files:**

- Create: `scripts/dev/run-structured-log-runtime-evidence.ps1`
- Create: `scripts/tests/test-run-structured-log-runtime-evidence.ps1`

- [ ] **7.1 (2–5 min): context, port, fixture, and provisioning slice.** Add `New-StructuredLogAttemptContext(RepoRoot,AttemptRoot,FixturePath,PythonExe,Ports,KitProvision)` and `Resolve-StructuredLogKitPrerequisites(Context)`. `-KitProvisionMode Build` runs branch-local `repo.bat build` only when assets are absent; `VerifiedPackage` requires package path plus expected SHA-256 before extraction. Add narrow mock case `ContextAndProvisioning`: fresh absolute attempt required, occupied port fails without stop, fixture hash is recorded, build exit is checked, bad package hash is rejected.

- [ ] **7.2 (2–5 min): process specification and lease slice.** Add `New-StructuredLogProcessSpecs(Context) -> ProcessSpec[]` and `Start-StructuredLogOwnedProcess(Context,ProcessSpec) -> LeaseEntry`. Minimal schemas:

  ```text
  ProcessSpec = {name,file_path,argument_list,cwd,env,port,health_uri,stdout_path,stderr_path}
  LeaseEntry = {name,pid,parent_pid,path,start_time_utc,cwd,port,pidfile}
  runtime-lease.json = {schema_version:"1",attempt_id,processes:LeaseEntry[]}
  ```

  Mock case `ProcessSpecsAndLease` proves exact conversion/coordinator/viewer commands, only `8005/5175/49104`, validated coordinator logger endpoint `http://127.0.0.1:8005/api/internal/viewer-log`, `Start-Process -PassThru`, immediate pidfile/lease persistence, attempt-local stdout/stderr, and restoration of every env key after each start.

- [ ] **7.3 (2–5 min): health and supported smoke slice.** Add `Wait-StructuredLogRuntimeHealth(Context,LeaseEntry[]) -> HealthReport` and `Invoke-StructuredLogSupportedSmoke(Context) -> SmokeReport`. Minimal schemas:

  ```text
  health.json = {schema_version:"1",probes:[{name,uri,started_utc,ended_utc,status,http_status}]}
  provenance JSONL = {seq,ts_utc,phase,command,cwd,status,exit_code}
  ```

  Mock case `HealthAndSmoke` proves every failed probe/native exit is nonzero and recorded, the smoke is the supported `smoke-bscheme-intake.ps1`, parent `LOG_ROOT` is set before invocation and restored on success/failure, and browser flush targets coordinator `:8005`, never Vite `:5175`.

- [ ] **7.4 (2–5 min): identity-bound shutdown slice.** Add `Stop-StructuredLogOwnedRuntime(Context,LeaseEntry[]) -> ShutdownReport`. Minimal schema:

  ```text
  shutdown.json = {schema_version:"1",attempt_id,entries:[{pid,path,start_time_utc,identity_match,action,result}],foreign_listeners:[]}
  ```

  Mock case `OwnedShutdown` proves descendants stop child-first, leased root stops last, PID/path/start-time mismatch is recorded and never stopped, repeated shutdown is safe, and every launch/health/smoke/validator failure plus success passes through the same outer `finally`.

- [ ] **7.5 (2–5 min): artifact completion and orchestration slice.** Add `Complete-StructuredLogRuntimeArtifacts(Context,Lease,Health,Smoke,Shutdown) -> ArtifactManifest` and top-level `Invoke-StructuredLogRuntimeEvidence(...)`. Minimal artifact manifest is `{schema_version,attempt_id,status,files:[{name,path,sha256}],root_trace_id,runtime_ids,shutdown_status,known_gaps}`. Mock case `ArtifactsAndOrchestration` proves canonical validator invocation, required artifact hashes, secret-free summary/`pr-fields.json`, `try/finally` ownership shutdown, no manual adapter harness, and no synchronous XHR.

  Public runner parameter contract is `AttemptRoot:string`, `FixturePath:string`, `PythonExe:string`, `CoordinatorPort:int=8005`, `ViewerPort:int=5175`, `ConversionPort:int=49104`, `KitProvisionMode:Build|VerifiedPackage`, `KitPackagePath?:string`, `KitPackageSha256?:string`, and `LivePollSeconds:int=180`. Task 8 contains the fully reconstructed invocation.

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/dev/run-structured-log-runtime-evidence.ps1)) | Out-Null"
  ```

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/dev/run-structured-log-runtime-evidence.ps1)) | Out-Null"
  foreach($case in 'ContextAndProvisioning','ProcessSpecsAndLease','HealthAndSmoke','OwnedShutdown','ArtifactsAndOrchestration'){pwsh -NoProfile -File scripts/tests/test-run-structured-log-runtime-evidence.ps1 -Case $case; if($LASTEXITCODE -ne 0){throw "runner case failed: $case"}}
  ```

  Expected before implementation: missing runner/tests or contract failures.

- [ ] Integrate the five slices under one orchestration boundary with these invariants:

  - Use only `8005/5175/49104`; any pre-existing listener is HELD and is never stopped. Never call `start-all`, `stop-all`, default-port cleanup, deployment checkout, or kill-by-port.
  - If Kit/HOOPS assets are absent and `-KitProvisionMode Build`, run branch-local `bim-streaming-server\repo.bat build`, record cwd/argv/exit, then revalidate `kit.exe`, `hoops_main.py`, converter config and wrapper. `VerifiedPackage` is allowed only with explicit package path plus expected SHA-256 checked before extraction. A missing asset after provisioning is HELD.
  - Launch conversion (`start-host-native-conversion-service.ps1`), coordinator (`npm.cmd run dev`) and viewer (`npm.cmd run dev -- --host 127.0.0.1 --port 5175 --strictPort`) individually with `Start-Process -PassThru`, attempt-local stdout/stderr, and scoped environment. Coordinator gets alternate public bases, conversion `49104`, attempt-local stores and `LOG_ROOT`; viewer uses the validated `coordinatorApiBase` carrier.
  - Persist PID, parent PID, executable path, UTC start time, cwd, argv, env key names and owned port before continuing. Shutdown rechecks PID/path/start time, derives descendants, stops only the leased tree child-first, and is idempotent/fail-closed.
  - Health-check all three alternate endpoints, then set/restore the parent `LOG_ROOT` around the supported `smoke-bscheme-intake.ps1`. In one outer `try/finally`, run smoke and canonical runtime validator, always shutdown, restore every touched env key, and verify leased PIDs ended. A foreign listener after shutdown is evidence, not authority to stop it.
  - Emit `attempt-manifest.json`, `runtime-lease.json`, pidfiles, `command-provenance.jsonl`, `machine.json`, `fixture.json` with SHA-256, `health.json`, `bscheme-readiness.json`, `root-trace-timeline.json`, `runtime-log-validation.json`, `shutdown.json`, `artifact-manifest.json`, `pr-fields.json`, and secret-free `evidence-summary.md`. No manual logging harness or synchronous XHR.

- [ ] Make tests pass, run exact detect, and commit the tracked helper.

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  pwsh -NoProfile -File scripts/tests/test-run-structured-log-runtime-evidence.ps1
  pwsh -NoProfile -File scripts/tests/test-struct-log.ps1
  git diff --check
  ```

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  git add -- scripts/dev/run-structured-log-runtime-evidence.ps1 scripts/tests/test-run-structured-log-runtime-evidence.ps1
  git diff --cached --check
  git commit -m "task#7: add owned structured log evidence runner" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

### Task 8: Execute the real runtime and close production evidence

**Files:**

- Create: `docs/evidence/structured-log-baseline-2026-05-26.md`
- Modify: `openspec/changes/cross-service-structured-log-baseline/tasks.md`
- Generate (gitignored): `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/attempt-*/**`

- [ ] Create one fresh attempt and run the helper. This shell reconstructs every value:

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  $fixtureRoot='C:\Repos\active\iot\AI-BIM-governance\storage'; $fixture=@(Get-ChildItem -LiteralPath $fixtureRoot -Filter *.ifc -File)[0]; if(-not $fixture){throw 'HELD: authorized IFC fixture absent'}
  $attemptId='attempt-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-'+(git rev-parse --short HEAD)
  $attemptRoot=Join-Path $root "artifacts\spec-to-done\cross-service-structured-log-baseline\evidence\$attemptId"; if(Test-Path $attemptRoot){throw 'attempt exists'}
  $pointer=Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.json'; New-Item -ItemType Directory -Force (Split-Path $pointer -Parent)|Out-Null
  @{attempt_id=$attemptId;attempt_root=$attemptRoot;status='running';started_utc=(Get-Date).ToUniversalTime().ToString('o');head=(git rev-parse HEAD)}|ConvertTo-Json|Set-Content $pointer
  try {
    pwsh -NoProfile -File scripts/dev/run-structured-log-runtime-evidence.ps1 -AttemptRoot $attemptRoot -FixturePath $fixture.FullName -PythonExe (Join-Path $root '.venv\Scripts\python.exe') -CoordinatorPort 8005 -ViewerPort 5175 -ConversionPort 49104 -KitProvisionMode Build -LivePollSeconds 180
    if($LASTEXITCODE -ne 0){throw 'HELD: runtime evidence runner failed'}
    $state=Get-Content -Raw $pointer|ConvertFrom-Json; $state.status='succeeded'; $state|Add-Member -Force NoteProperty finished_utc (Get-Date).ToUniversalTime().ToString('o'); $state|ConvertTo-Json|Set-Content $pointer
  } catch {
    $state=Get-Content -Raw $pointer|ConvertFrom-Json; $state.status='failed'; $state|Add-Member -Force NoteProperty finished_utc (Get-Date).ToUniversalTime().ToString('o'); $state|Add-Member -Force NoteProperty error_type $_.Exception.GetType().FullName; $state|ConvertTo-Json|Set-Content $pointer; throw
  }
  ```

- [ ] Unconditionally rerun the complete affected checks; this shell has no dependency on prior variables:

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  & .\.venv\Scripts\python.exe -m pytest tests/contracts/structured-log -q -p no:cacheprovider; if($LASTEXITCODE -ne 0){throw 'contract tests failed'}
  Push-Location bim-review-coordinator; npm run verify; $c=$LASTEXITCODE; Pop-Location; if($c -ne 0){throw 'coordinator verify failed'}
  Push-Location bim-streaming-server; & ..\.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q -p no:cacheprovider; $s=$LASTEXITCODE; Pop-Location; if($s -ne 0){throw 'streaming tests failed'}
  Push-Location web-viewer-sample; npm run verify; $v=$LASTEXITCODE; Pop-Location; if($v -ne 0){throw 'viewer verify failed'}
  pwsh -NoProfile -File scripts/tests/test-struct-log.ps1; if($LASTEXITCODE -ne 0){throw 'struct-log tests failed'}
  pwsh -NoProfile -File scripts/tests/test-smoke-bscheme-structured-log.ps1; if($LASTEXITCODE -ne 0){throw 'smoke tests failed'}
  pwsh -NoProfile -File scripts/tests/test-run-structured-log-runtime-evidence.ps1; if($LASTEXITCODE -ne 0){throw 'runner tests failed'}
  ```

- [ ] Render the tracked evidence from the helper summary and inspect every source artifact before checking 10.1–10.5:

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  $pointer=Get-Content -Raw 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.json'|ConvertFrom-Json; if($pointer.status -ne 'succeeded'){throw 'HELD: active attempt is not succeeded'}; $attemptRoot=[string]$pointer.attempt_root
  $required='attempt-manifest.json','runtime-lease.json','command-provenance.jsonl','machine.json','fixture.json','health.json','bscheme-readiness.json','root-trace-timeline.json','runtime-log-validation.json','shutdown.json','artifact-manifest.json','pr-fields.json','evidence-summary.md'
  foreach($name in $required){if(-not(Test-Path (Join-Path $attemptRoot $name))){throw "HELD: missing $name"}}
  Copy-Item -LiteralPath (Join-Path $attemptRoot 'evidence-summary.md') -Destination 'docs\evidence\structured-log-baseline-2026-05-26.md'
  ```

  The fixed evidence template headings are: `Revision and machine`, `Fixture name-size-SHA256`, `Exact command provenance`, `Owned process lease and shutdown`, `Root trace timeline and runtime IDs`, `Schema/env-snapshot/redaction validation`, `OpenSpec 10.1-10.5 mapping`, `Verified facts`, `Inferences`, `Unverified risks`, `Skipped checks`. Use `apply_patch` to check only evidence-backed active `tasks.md` boxes. Do not copy raw env/secret/IFC data or claim WebRTC/render evidence.

- [ ] Strict-validate, detect, and commit Task 8. P3 ends after this commit; it does not push, create a PR, review, merge, archive, or enter P7.

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  npx --no-install openspec change validate cross-service-structured-log-baseline --strict; if($LASTEXITCODE -ne 0){throw 'change validation failed'}
  npx --no-install openspec validate --all --strict; if($LASTEXITCODE -ne 0){throw 'all validation failed'}
  git diff --check
  ```

  ```text
  mcp__gitnexus__detect_changes({repo:"C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\cross-service-structured-log-baseline",scope:"compare",base_ref:"origin/main"})
  ```

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  git add -- docs/evidence/structured-log-baseline-2026-05-26.md openspec/changes/cross-service-structured-log-baseline/tasks.md
  git diff --cached --check
  git commit -m "task#8: record structured log production evidence" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  git status --short
  ```

## P5/P6 implementation ship phase (not a P3 task)

Run only after P3 Task 8 is committed and review readiness is explicit.

- [ ] Generate and validate the implementation PR body before publication. Required fields are Lane S, approved Option A, all formal impacts plus index-durability disclosure, exact tests, attempt/root trace/runtime IDs, shutdown, known gaps, deployment path (`not run; no deployment checkout`), and `archive pending after implementation merge`:

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root
  $pointer=Get-Content -Raw 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.json'|ConvertFrom-Json; if($pointer.status -ne 'succeeded'){throw 'HELD: runtime attempt not succeeded'}
  $fields=Get-Content -Raw (Join-Path $pointer.attempt_root 'pr-fields.json')|ConvertFrom-Json; $bodyPath='artifacts\spec-to-done\cross-service-structured-log-baseline\implementation-pr.md'
  @("Change lane: S","Behavior contract changed: yes","Requirement source: openspec/changes/cross-service-structured-log-baseline/specs/cross-service-structured-log-baseline/spec.md","Approved option: A","Formal impacts: create_conversion_api_app MEDIUM direct2 impacted41; create LOW direct1; complete LOW direct0; adapter.convert MEDIUM direct7; _run_powershell_conversion MEDIUM direct5 impacted12; no processes; none HIGH","Index durability: temporary .gitnexusignore negation restored; future analyze may lose Python symbols","Tests: $($fields.tests)","Attempt: $($pointer.attempt_id)","Root trace: $($fields.root_trace_id)","Runtime IDs: $($fields.runtime_ids)","Shutdown: $($fields.shutdown_status)","Known gaps: $($fields.known_gaps)","Deployment path: not run; no deployment checkout","OpenSpec archive: pending after implementation merge") -join "`n`n"|Set-Content $bodyPath
  $body=Get-Content -Raw $bodyPath; foreach($required in 'Change lane: S','Behavior contract changed: yes','Requirement source: openspec/changes/cross-service-structured-log-baseline/specs/cross-service-structured-log-baseline/spec.md','Formal impacts:','Runtime IDs:','Shutdown:','Known gaps:','Deployment path:','OpenSpec archive: pending'){if($body -notmatch [regex]::Escape($required)){throw "HELD: PR body missing $required"}}
  ```

- [ ] Push and create/reuse exactly one PR for the current head OID, then run preflight with its real number:

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root; $branch='codex/openspec/cross-service-structured-log-baseline'; $headOid=git rev-parse HEAD
  $prs=@(gh pr list --head $branch --base main --state all --json number,state,url,headRefOid|ConvertFrom-Json|Where-Object headRefOid -eq $headOid); if($prs.Count -gt 1){throw 'HELD: multiple PRs for current head'}
  if($prs.Count -eq 0){git push -u origin $branch; if($LASTEXITCODE -ne 0){throw 'push failed'}; gh pr create --base main --head $branch --title 'feat: wire cross-service structured log trace' --body-file 'artifacts\spec-to-done\cross-service-structured-log-baseline\implementation-pr.md'; if($LASTEXITCODE -ne 0){throw 'PR create failed'}; $prs=@(gh pr list --head $branch --base main --state all --json number,state,url,headRefOid|ConvertFrom-Json|Where-Object headRefOid -eq $headOid)}
  elseif($prs[0].state -eq 'OPEN'){git push -u origin $branch; if($LASTEXITCODE -ne 0){throw 'push failed'}}
  $prNumber=[int]$prs[0].number
  if($prs[0].state -eq 'OPEN'){.\scripts\dev\check-pr-local-preflight.ps1 -PrNumber $prNumber; if($LASTEXITCODE -ne 0){throw 'preflight failed'}}
  @{pr_number=$prNumber;pr_url=$prs[0].url;head=(git rev-parse HEAD);phase='implementation_pr_open'}|ConvertTo-Json|Set-Content 'artifacts\spec-to-done\cross-service-structured-log-baseline\implementation-ship.json'
  ```

- [ ] **P5 hard gate:** call canonical `Workflow({name:'fu-adversarial-verify-generic',args:{root:$root,label:'cross-service-structured-log-baseline',findings:[...P3.finalReview.findings,...((P4.evidence&&P4.evidence.gaps)||[])],criticFocus:'通讀全 diff 找新誠實違規 / 行為 regression / spec-drift / 空測試 / DEMO DATA 漏標。'}})`. Gate exactly: output non-null, `critic` non-null, `verdicts.length` equals submitted findings count, `not_closed.length===0`, `new_issues.length===0`, and `critic.overall_safe===true`. Retry once with `resumeFromRunId` only for infra-null/mismatched verdict count; otherwise fix loop or HELD per canonical workflow. Serialize the unmodified StructuredOutput as evidence; do not invent an adapter schema。`gh pr checks` is not P5.

- [ ] **P6 hard gate:** reconstruct `$prNumber` from the unique current-head PR above, then call canonical `Workflow({name:'ship-item',args:{branch:'codex/openspec/cross-service-structured-log-baseline',prNumber:$prNumber,userFacing:false}})`. Consume only canonical output: null retries once then HELD; `merged===true` permits ancestry closeout; otherwise consume `heldReason` exactly per spec-to-done (production P1/P2 fix loop, `review_required` HELD, safeguard/consent cases, or other tool/CI failure). Serialize the unmodified StructuredOutput as evidence. There is no direct `gh pr merge` path outside ship-item.

- [ ] After and only after canonical P6 returns `merged===true`, persist the actual merge OID and prove ancestry:

  ```powershell
  $root='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; Set-Location $root; $branch='codex/openspec/cross-service-structured-log-baseline'; $headOid=git rev-parse HEAD
  $prs=@(gh pr list --head $branch --base main --state all --json number,state,headRefOid|ConvertFrom-Json|Where-Object headRefOid -eq $headOid); if($prs.Count -ne 1){throw 'HELD: current-head PR identity not unique'}; $prNumber=[int]$prs[0].number
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  $impl=gh pr view $prNumber --json state,mergedAt,mergeCommit,url|ConvertFrom-Json; if($impl.state -ne 'MERGED' -or -not $impl.mergeCommit.oid){throw 'HELD: P6 did not merge implementation'}
  $mergeOid=[string]$impl.mergeCommit.oid; git merge-base --is-ancestor $mergeOid origin/main; if($LASTEXITCODE -ne 0){throw 'HELD: merge absent from origin/main'}
  @{pr_number=$prNumber;pr_url=$impl.url;merge_oid=$mergeOid;merged_at=$impl.mergedAt;origin_main=(git rev-parse origin/main);phase='implementation_merged'}|ConvertTo-Json|Set-Content 'artifacts\spec-to-done\cross-service-structured-log-baseline\implementation-ship.json'
  ```

## Post-merge OpenSpec archive closeout phase (separate P5/P6; not a P3 task)

- [ ] After implementation ancestry is proven, idempotently create/reuse the archive worktree and commit only the archive:

  ```powershell
  $repo='C:\Repos\active\iot\AI-BIM-governance'; $archiveBranch='codex/openspec/archive-cross-service-structured-log-baseline'; $archiveWorktree='C:\Repos\active\iot\AI-BIM-governance\.worktrees\archive-cross-service-structured-log-baseline'; Set-Location $repo
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  $impl=gh pr view codex/openspec/cross-service-structured-log-baseline --json state,mergeCommit|ConvertFrom-Json; $mergeOid=[string]$impl.mergeCommit.oid
  if($impl.state -ne 'MERGED' -or -not $mergeOid){throw 'HELD: implementation PR not merged'}; git merge-base --is-ancestor $mergeOid origin/main; if($LASTEXITCODE -ne 0){throw 'HELD: implementation ancestry missing'}
  if(Test-Path $archiveWorktree){if((git -C $archiveWorktree branch --show-current) -ne $archiveBranch){throw 'HELD: archive path owned by another branch'}}else{git show-ref --verify --quiet "refs/heads/$archiveBranch"; if($LASTEXITCODE -eq 0){git worktree add $archiveWorktree $archiveBranch}else{git worktree add -b $archiveBranch $archiveWorktree origin/main}}
  Set-Location $archiveWorktree; git merge --ff-only origin/main; if($LASTEXITCODE -ne 0){throw 'archive branch freshness failed'}
  $canonical='openspec\specs\cross-service-structured-log-baseline\spec.md'; $canonicalHash=(Get-FileHash $canonical -Algorithm SHA256).Hash
  if(Test-Path 'openspec\changes\cross-service-structured-log-baseline'){npx --no-install openspec change validate cross-service-structured-log-baseline --strict; if($LASTEXITCODE -ne 0){throw 'pre-archive validation failed'}; npx --no-install openspec archive cross-service-structured-log-baseline --skip-specs -y; if($LASTEXITCODE -ne 0){throw 'archive failed'}}
  if((Get-FileHash $canonical -Algorithm SHA256).Hash -ne $canonicalHash){throw 'HELD: canonical hash changed'}
  if(Test-Path 'openspec\changes\cross-service-structured-log-baseline'){throw 'HELD: active change remains'}
  npx --no-install openspec validate --specs --strict; if($LASTEXITCODE -ne 0){throw 'spec validation failed'}; npx --no-install openspec validate --all --strict; if($LASTEXITCODE -ne 0){throw 'all validation failed'}
  git add -A -- openspec\changes\cross-service-structured-log-baseline openspec\changes\archive; git diff --cached --check
  git diff --cached --quiet; if($LASTEXITCODE -eq 0){Write-Host 'archive commit already present'}else{git commit -m "openspec: archive cross-service structured log baseline" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"}
  @{canonical_hash=$canonicalHash;implementation_merge_oid=$mergeOid;archive_head=(git rev-parse HEAD)}|ConvertTo-Json|Set-Content (Join-Path $repo 'artifacts\spec-to-done\cross-service-structured-log-baseline\archive-ship.json')
  ```

- [ ] Create/reuse the archive PR for its exact head OID and run preflight. Then require a separate archive `fu-adversarial` P5 artifact and archive ship-item P6 artifact; neither `gh pr checks` nor the first PR's gates can substitute:

  ```powershell
  $repo='C:\Repos\active\iot\AI-BIM-governance'; $archiveBranch='codex/openspec/archive-cross-service-structured-log-baseline'; $archiveWorktree='C:\Repos\active\iot\AI-BIM-governance\.worktrees\archive-cross-service-structured-log-baseline'; Set-Location $archiveWorktree; $headOid=git rev-parse HEAD
  $prs=@(gh pr list --head $archiveBranch --base main --state all --json number,state,url,headRefOid|ConvertFrom-Json|Where-Object headRefOid -eq $headOid); if($prs.Count -gt 1){throw 'HELD: multiple archive PRs for current head'}
  if($prs.Count -eq 0){$archiveBody=Join-Path $repo 'artifacts\spec-to-done\cross-service-structured-log-baseline\archive-pr.md'; @('Change lane: S','Behavior contract changed: no','Requirement source: openspec/changes/cross-service-structured-log-baseline/specs/cross-service-structured-log-baseline/spec.md','Archive-only closeout after implementation merge; canonical spec hash unchanged.') -join "`n`n"|Set-Content $archiveBody; git push -u origin $archiveBranch; if($LASTEXITCODE -ne 0){throw 'archive push failed'}; gh pr create --base main --head $archiveBranch --title 'openspec: archive cross-service structured log baseline' --body-file $archiveBody; if($LASTEXITCODE -ne 0){throw 'archive PR create failed'}; $prs=@(gh pr list --head $archiveBranch --base main --state all --json number,state,url,headRefOid|ConvertFrom-Json|Where-Object headRefOid -eq $headOid)}
  elseif($prs[0].state -eq 'OPEN'){git push -u origin $archiveBranch; if($LASTEXITCODE -ne 0){throw 'archive push failed'}}
  $archivePr=[int]$prs[0].number
  $shipPath=Join-Path $repo 'artifacts\spec-to-done\cross-service-structured-log-baseline\archive-ship.json'; $ship=Get-Content -Raw $shipPath|ConvertFrom-Json; $ship|Add-Member -Force NoteProperty archive_pr $archivePr; $ship|Add-Member -Force NoteProperty archive_url $prs[0].url; $ship|ConvertTo-Json|Set-Content $shipPath
  if($prs[0].state -eq 'OPEN'){.\scripts\dev\check-pr-local-preflight.ps1 -PrNumber $archivePr; if($LASTEXITCODE -ne 0){throw 'archive preflight failed'}}
  ```

  Archive **P5 hard gate** first reconstructs `$archiveReviewRegistry` from the archive diff/reviewer findings, then calls canonical `fu-adversarial-verify-generic` with `{root:$archiveWorktree,label:'archive-cross-service-structured-log-baseline',findings:$archiveReviewRegistry,criticFocus:'檢查 archive-only diff、canonical hash、active absence與 spec drift。'}`. Apply the same canonical non-null/critic/verdict-count/`not_closed`/`new_issues`/`critic.overall_safe` gates and retry/fix/HELD rules; serialize the raw StructuredOutput only.

  Archive **P6 hard gate** reconstructs `$archivePr` from `archive-ship.json` and calls canonical `Workflow({name:'ship-item',args:{branch:'codex/openspec/archive-cross-service-structured-log-baseline',prNumber:$archivePr,userFacing:false}})`. Only `merged===true` permits P7. Consume canonical `heldReason`; never call `gh pr merge` directly and never reuse the implementation P5/P6 result.

- [ ] Final P7 closeout reconstructs all state, proves the archive merge and canonical bytes, closes the board lease, and records final machine truth:

  ```powershell
  $repo='C:\Repos\active\iot\AI-BIM-governance'; $archiveWorktree='C:\Repos\active\iot\AI-BIM-governance\.worktrees\archive-cross-service-structured-log-baseline'; $archiveBranch='codex/openspec/archive-cross-service-structured-log-baseline'; Set-Location $repo
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  $state=Get-Content -Raw 'artifacts\spec-to-done\cross-service-structured-log-baseline\archive-ship.json'|ConvertFrom-Json; $archive=gh pr view ([int]$state.archive_pr) --json number,state,mergedAt,mergeCommit,url|ConvertFrom-Json; if($archive.state -ne 'MERGED' -or -not $archive.mergeCommit.oid){throw 'HELD: archive PR not merged'}
  $archiveMergeOid=[string]$archive.mergeCommit.oid; git merge-base --is-ancestor $archiveMergeOid origin/main; if($LASTEXITCODE -ne 0){throw 'HELD: archive ancestry missing'}
  $archiveDirty=@(git -C $archiveWorktree status --porcelain); if($archiveDirty.Count -gt 0){throw 'HELD: archive worktree dirty before final verification'}; git -C $archiveWorktree switch --detach origin/main; if($LASTEXITCODE -ne 0){throw 'archive worktree cannot inspect origin/main'}
  $canonical=Join-Path $archiveWorktree 'openspec\specs\cross-service-structured-log-baseline\spec.md'
  if((Get-FileHash $canonical -Algorithm SHA256).Hash -ne $state.canonical_hash){throw 'HELD: canonical hash drift'}
  if(Test-Path (Join-Path $archiveWorktree 'openspec\changes\cross-service-structured-log-baseline')){throw 'HELD: active change remains'}
  $implementationRoot='C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'; $boardMarker=Join-Path $implementationRoot 'artifacts\spec-to-done\cross-service-structured-log-baseline\board-session.txt'; if(-not(Test-Path $boardMarker)){throw 'HELD: durable implementation board marker missing'}
  $boardSession=(Get-Content -Raw $boardMarker).Trim(); if(-not $boardSession){throw 'HELD: empty board marker'}; node scripts/dev/agents-board.mjs done --agent codex --session $boardSession; if($LASTEXITCODE -ne 0){throw 'board close failed'}
  @{archive_pr=$archive.number;archive_url=$archive.url;archive_merge_oid=$archiveMergeOid;merged_at=$archive.mergedAt;origin_main=(git rev-parse origin/main);canonical_hash=$state.canonical_hash;active_change_absent=$true;phase='P7_complete'}|ConvertTo-Json|Set-Content 'artifacts\spec-to-done\cross-service-structured-log-baseline\final-closeout.json'
  git status --short --branch
  ```

No deployment checkout is used in either ship phase or archive closeout.
