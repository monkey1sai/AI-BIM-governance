# Cross-Service Structured Log Baseline Historical Closeout Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 只執行 OpenSpec `cross-service-structured-log-baseline` 的 10.1–10.5，以真實 IFC-ready→conversion→session→close runtime、明示的 viewer/PowerShell evidence harness、四單位 JSONL/trace/redaction 檢查及可稽核文件判定此歷史 change 能否誠實 archive。

**Architecture:** Production code、shared schema、四語言 adapter 與 contracts 已由歷史 PR 落在 `origin/main`，本輪不得重做或修補；真實 runtime 閉環使用既有 host-native stack 與 `smoke-bscheme-intake.ps1`，而沒有 production caller 的 viewer adapter及不屬於 fast-MVP smoke 的 PowerShell adapter，必須以同一 trace 的 evidence harness 明確分列。所有 runtime 產物寫入 gitignored `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/`，只有 evidence 文件與 OpenSpec closeout 內容進 commit；任何缺少的四單位 record、env snapshot、secret redaction 或自動 trace propagation 都是 HELD，不得以合成 record 宣稱 runtime 通過。

**Tech Stack:** Windows PowerShell 7、Node.js 20/npm、TypeScript/tsx、Python/pytest、host-native Kit/conversion runtime、JSONL/JSON Schema draft-07、OpenSpec CLI、GitNexus、Git/GitHub CLI。

**Assumptions and hard gates:**

- Branch 固定為 `codex/openspec/cross-service-structured-log-baseline`，worktree 固定為 `C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline`；predecessor archive commit `6c71eb0` 已在 branch。
- `userFacing=false`，不新增 browser E2E；viewer adapter evidence 是 Node 中載入 production adapter並 POST 真 coordinator endpoint，不是 UI evidence。
- 主 checkout 的唯一允許 fixture root 是 `C:\Repos\active\iot\AI-BIM-governance\storage`；只讀其中 top-level IFC，不複製、不 commit IFC/USDC/runtime artifacts。
- `web-viewer-sample/src/lib/structLog.ts` 當前沒有 production app caller；`scripts/dev/sync-agent-skills.ps1` 與 `scripts/lib/rebuild-test-deploy.ps1` 雖有 PowerShell runtime caller，但不屬於 fast-MVP smoke。兩者的 harness evidence必須標為 adapter invocation，不得寫成自動四服務 propagation。
- 只有 10.1–10.5 可由本輪更動。若任一 acceptance gate 需要 production symbol、contract、schema 或 adapter修正，立即以 `HELD@P3` 回報；不擴 scope。

### Task 1: Baseline, fixture, and host-native ownership gates

**Files:**

- Read: `.codex/skills/spec-to-done/ensure-host-native-ports-free.ps1`
- Read: `scripts/start-all.ps1`
- Read: `scripts/demo-health-check.ps1`
- Read: `scripts/smoke-bscheme-intake.ps1`
- Generate (gitignored): `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/baseline.json`

- [ ] From the worktree root, prove branch/base and confirm that only the predecessor archive commit is present before runtime work.

  ```powershell
  $root = 'C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline'
  Set-Location -LiteralPath $root
  git status --short --branch
  git log --oneline origin/main..HEAD
  git diff --check origin/main...HEAD
  ```

  Expected: branch is `codex/openspec/cross-service-structured-log-baseline`; log contains `6c71eb0`; status has no unexpected tracked edits; `git diff --check` exits 0.

- [ ] Verify the main-checkout fixture without printing IFC content and create the isolated evidence/log directories.

  ```powershell
  $runDir = Join-Path $root 'artifacts\spec-to-done\cross-service-structured-log-baseline'
  $evidenceDir = Join-Path $runDir 'evidence'
  $logRoot = Join-Path $evidenceDir 'runtime-logs'
  New-Item -ItemType Directory -Force -Path $evidenceDir,$logRoot | Out-Null
  $fixtures = @(Get-ChildItem -LiteralPath 'C:\Repos\active\iot\AI-BIM-governance\storage' -Filter '*.ifc' -File)
  if ($fixtures.Count -eq 0) { throw 'HELD: no top-level IFC fixture in authorized main-checkout storage root' }
  $fixtures | Select-Object Name,Length | Format-Table -AutoSize
  ```

  Expected: at least one top-level `.ifc` is listed by name/size; no fixture is added to git.

- [ ] Detect host-native port/process ownership before stopping anything, then run the required helper.

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1 -DetectOnly
  powershell -NoProfile -ExecutionPolicy Bypass -File .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1 -DetectOnly
  ```

  Expected: first call records ownership; the helper stops only recognized repo host-native runtime; final detect reports required Kit/conversion ports free. Unknown ownership is a hard stop, not authorization to kill by port or process name alone.

- [ ] Record the baseline without secret values.

  ```powershell
  [ordered]@{
    captured_at = (Get-Date).ToUniversalTime().ToString('o')
    branch = (git branch --show-current)
    head = (git rev-parse HEAD)
    origin_main = (git rev-parse origin/main)
    fixture_root = 'C:\Repos\active\iot\AI-BIM-governance\storage'
    fixture_names = @($fixtures.Name)
    log_root = $logRoot
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceDir 'baseline.json') -Encoding utf8
  ```

  Expected: `baseline.json` exists under the gitignored run directory and contains paths/IDs only, no `.env` value.

### Task 2: Observe the real IFC-ready → conversion → session → close runtime

**Files:**

- Generate (gitignored): `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/bscheme-readiness.json`
- Generate (gitignored): `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/runtime-summary.json`
- Generate (gitignored): `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/runtime-logs/**`

- [ ] Start the host-native stack with the isolated `LOG_ROOT`, then run the repository health check.

  ```powershell
  $env:LOG_ROOT = $logRoot
  .\scripts\start-all.ps1 -HealthTimeoutSeconds 60
  .\scripts\demo-health-check.ps1
  ```

  Expected: coordinator `:8004`, conversion API `:49101`, viewer `:5173`, and configured Kit health gates report healthy; any owned runtime failure remains evidence and stops this task.

- [ ] Run the existing B-scheme smoke against the authorized real IFC fixture and keep its report inside the run directory.

  ```powershell
  $smokePath = Join-Path $evidenceDir 'bscheme-readiness.json'
  .\scripts\smoke-bscheme-intake.ps1 `
    -EvidencePath $smokePath `
    -StorageRoot 'C:\Repos\active\iot\AI-BIM-governance\storage' `
    -CoordinatorBaseUrl 'http://127.0.0.1:8004' `
    -StreamingConversionApiBase 'http://127.0.0.1:49101' `
    -LivePollSeconds 180
  $smoke = Get-Content -Raw -LiteralPath $smokePath | ConvertFrom-Json
  $realTier = $smoke.tiers | Where-Object tier -eq 'real_ifc_intake_conversion'
  if ($realTier.status -ne 'passed') { throw "HELD: real IFC intake/conversion status=$($realTier.status); blocker=$($realTier.blocker)" }
  ```

  Expected: `real_ifc_fixture` and `real_ifc_intake_conversion` are `passed`; a real `ifc_ready_job_id` and `conversion_job_id` are present. Contract-only tiers never substitute for the live tier.

- [ ] Resolve the auto-created review session from the live job, close it through the real coordinator route, and persist only IDs/statuses.

  ```powershell
  $ifcReadyJobId = [string]$realTier.ids.ifc_ready_job_id
  $jobs = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:8004/api/external/ifc-ready?limit=100'
  $job = $jobs.items | Where-Object ifc_ready_job_id -eq $ifcReadyJobId | Select-Object -First 1
  if ($null -eq $job) { throw "HELD: live IFC-ready job not returned by coordinator: $ifcReadyJobId" }
  $sessionId = [string]$job.review_session_id
  if ([string]::IsNullOrWhiteSpace($sessionId)) { throw 'HELD: conversion completed without auto-created review_session_id' }
  $close = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8004/api/review-sessions/$sessionId/close" -ContentType 'application/json' -Body '{}'
  if ($close.status -ne 'closed') { throw "HELD: review session close status=$($close.status)" }
  $runtimeTrace = "rev_$sessionId"
  [ordered]@{
    ifc_ready_job_id = $ifcReadyJobId
    conversion_job_id = [string]$realTier.ids.conversion_job_id
    review_session_id = $sessionId
    review_trace_id = $runtimeTrace
    intake_conversion_status = $realTier.status
    close_status = $close.status
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceDir 'runtime-summary.json') -Encoding utf8
  ```

  Expected: the summary has non-empty three IDs, `intake_conversion_status=passed`, and `close_status=closed`; coordinator JSONL contains `rev_<session_id>` lifecycle start/closing/closed records. This proves 10.1 only and does not yet prove four-unit propagation.

### Task 3: Invoke the otherwise-unwired viewer and PowerShell adapters with the observed trace

**Files:**

- Read/execute: `web-viewer-sample/src/lib/structLog.ts`
- Read/execute: `scripts/lib/StructLog.psm1`
- Generate (gitignored): `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/adapter-harness-summary.json`

- [ ] Invoke the production viewer adapter under Node, emit a lifecycle record with the observed `rev_` trace, and POST through the live unauthenticated coordinator intake.

  ```powershell
  $env:BIM_TRACE_ID = $runtimeTrace
  $viewerResult = & .\bim-review-coordinator\node_modules\.bin\tsx.cmd -e "import {createBrowserLogger} from './web-viewer-sample/src/lib/structLog.ts'; const trace=process.env.BIM_TRACE_ID; if(!trace) throw new Error('BIM_TRACE_ID missing'); const logger=createBrowserLogger({initialTraceId:trace,endpoint:'http://127.0.0.1:8004/api/internal/viewer-log',enableTimer:false}); logger.lifecycle('evidence-harness','historical closeout adapter invocation',{phase:'closed',subject_kind:'review_session',subject_id:trace.slice(4)}); const flushed=await logger.flush(); await logger.shutdown(); if(flushed<1) throw new Error('viewer adapter did not flush'); console.log(JSON.stringify({adapter:'viewer',trace_id:trace,records_flushed:flushed}));"
  if ($LASTEXITCODE -ne 0) { throw 'HELD: viewer adapter harness failed' }
  ```

  Expected: one JSON summary reports `adapter=viewer`, the exact runtime trace, and `records_flushed>=1`; a schema-valid viewer JSONL line appears under the isolated log root. The evidence document must label this `adapter_harness`, because the app has no production caller.

- [ ] Invoke the production PowerShell module with the same trace and let logger creation emit its actual `env_snapshot` before a lifecycle record.

  ```powershell
  Import-Module .\scripts\lib\StructLog.psm1 -Force
  $scriptLogger = New-StructLogger -Service scripts -Component 'structured-log-closeout' -LogRoot $logRoot -InitialTraceId $runtimeTrace
  $scriptLogger | Write-StructLifecycle -Msg 'historical closeout adapter invocation' -Data @{
    phase = 'closed'
    subject_kind = 'script_run'
    subject_id = $scriptLogger.RunId
  }
  if ($scriptLogger.RecordsWritten -lt 2) { throw 'HELD: PowerShell adapter did not emit env_snapshot plus lifecycle' }
  [ordered]@{
    trace_id = $runtimeTrace
    viewer_stdout = @($viewerResult)
    scripts_run_id = $scriptLogger.RunId
    scripts_records_written = $scriptLogger.RecordsWritten
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceDir 'adapter-harness-summary.json') -Encoding utf8
  ```

  Expected: scripts JSONL has the exact runtime trace, one `env_snapshot`, and one lifecycle record. The evidence document must label this `adapter_harness`, because existing PowerShell runtime callers are outside the fast-MVP smoke.

- [ ] Query coordinator structured-log health after viewer intake and preserve counters in the harness summary.

  ```powershell
  $health = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:8004/api/internal/structLog/health'
  if ($health.viewer_intake.records_accepted -lt 1) { throw 'HELD: coordinator did not persist the viewer adapter record' }
  $harnessPath = Join-Path $evidenceDir 'adapter-harness-summary.json'
  $harness = Get-Content -Raw -LiteralPath $harnessPath | ConvertFrom-Json
  $harness | Add-Member -NotePropertyName viewer_records_accepted -NotePropertyValue $health.viewer_intake.records_accepted -Force
  $harness | Add-Member -NotePropertyName viewer_records_dropped -NotePropertyValue $health.viewer_intake.records_dropped -Force
  $harness | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $harnessPath -Encoding utf8
  ```

  Expected: accepted count is at least one; dropped count is recorded, not silently ignored.

### Task 4: Validate four-unit JSONL, timeline, schema, env snapshots, and redaction

**Files:**

- Read: `tests/contracts/structured-log/schema.json`
- Generate (gitignored): `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/log-validation.json`
- Generate (gitignored): `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/timeline.json`

- [ ] Enumerate JSONL per service and fail if any unit has no actual file.

  ```powershell
  $services = @('coordinator','streaming-server','viewer','scripts')
  $filesByService = @{}
  foreach ($service in $services) {
    $filesByService[$service] = @(Get-ChildItem -LiteralPath (Join-Path $logRoot $service) -Recurse -Filter '*.jsonl' -File -ErrorAction SilentlyContinue)
    if ($filesByService[$service].Count -eq 0) { throw "HELD: no JSONL produced for $service" }
  }
  $filesByService.GetEnumerator() | ForEach-Object { [pscustomobject]@{ service=$_.Key; files=$_.Value.Count } } | Format-Table -AutoSize
  ```

  Expected: all four service names have at least one JSONL file. Streaming-server must come from the host-native runtime/Kit path; a test fixture or manually fabricated record is not acceptable.

- [ ] Parse every line, validate every record against the shared schema with the existing contract validator, and extract the chosen trace sorted by timestamp.

  ```powershell
  & .\.venv\Scripts\python.exe -m pytest tests\contracts\structured-log\test_validate.py tests\contracts\structured-log\test_cross_service_integration.py -q -p no:cacheprovider
  if ($LASTEXITCODE -ne 0) { throw 'HELD: structured-log contract validation failed' }
  $allRecords = foreach ($service in $services) {
    foreach ($file in $filesByService[$service]) {
      $lineNo = 0
      foreach ($line in Get-Content -LiteralPath $file.FullName) {
        $lineNo++
        try { $record = $line | ConvertFrom-Json -ErrorAction Stop } catch { throw "HELD: malformed JSONL $($file.FullName):$lineNo" }
        [pscustomobject]@{ service=$service; file=$file.FullName; line=$lineNo; record=$record }
      }
    }
  }
  $timeline = @($allRecords | Where-Object { $_.record.trace_id -eq $runtimeTrace } | Sort-Object { [datetime]$_.record.ts })
  $timeline | ForEach-Object { [ordered]@{ ts=$_.record.ts; service=$_.record.service; event_type=$_.record.event_type; msg=$_.record.msg; file=$_.file; line=$_.line } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceDir 'timeline.json') -Encoding utf8
  ```

  Expected: pytest passes; every JSONL line parses; `timeline.json` is ordered by `ts`. Runtime-derived coordinator/streaming observations and harness-derived viewer/scripts observations remain distinguishable by component/message.

- [ ] Enforce the honest propagation and env-snapshot gates without printing any environment value.

  ```powershell
  $traceServices = @($timeline | ForEach-Object { [string]$_.record.service } | Sort-Object -Unique)
  $snapshotServices = @($allRecords | Where-Object { $_.record.event_type -eq 'env_snapshot' } | ForEach-Object { [string]$_.record.service } | Sort-Object -Unique)
  $missingTrace = @($services | Where-Object { $_ -notin $traceServices })
  $missingSnapshot = @($services | Where-Object { $_ -notin $snapshotServices })
  $redactionViolations = @()
  foreach ($entry in $allRecords | Where-Object { $_.record.event_type -eq 'env_snapshot' }) {
    foreach ($var in @($entry.record.data.vars)) {
      $key = [string]$var.key
      $marker = [string]$var.value_or_redacted
      if ($key -match '(?i)(TOKEN|SECRET|KEY|PASSWORD|AUTH|CREDENTIAL)' -and $marker -notmatch '^\[REDACTED:type=') {
        $redactionViolations += [pscustomobject]@{ service=$entry.service; key=$key; file=$entry.file; line=$entry.line }
      }
    }
  }
  [ordered]@{
    trace_id = $runtimeTrace
    trace_services = $traceServices
    env_snapshot_services = $snapshotServices
    missing_trace_services = $missingTrace
    missing_env_snapshot_services = $missingSnapshot
    redaction_violation_keys = @($redactionViolations | Select-Object service,key,file,line)
    automatic_runtime_propagation_claimed = $false
    viewer_and_scripts_evidence_kind = 'adapter_harness'
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidenceDir 'log-validation.json') -Encoding utf8
  if ($missingTrace.Count -gt 0) { throw "HELD: chosen trace absent from services: $($missingTrace -join ', ')" }
  if ($missingSnapshot.Count -gt 0) { throw "HELD: env_snapshot absent from services: $($missingSnapshot -join ', ')" }
  if ($redactionViolations.Count -gt 0) { throw "HELD: secret-pattern keys lack redaction markers: $($redactionViolations.key -join ', ')" }
  ```

  Expected: all four names are present in both arrays and violation list is empty. Known source inspection says the viewer adapter currently has no automatic logger-creation snapshot API; if runtime confirms that gap, task 10.4 stays unchecked and P3 is HELD because production repair is outside authorized 10.1–10.5 scope. Never add a hand-written viewer `env_snapshot` to force this gate green.

### Task 5: Write durable evidence and update only OpenSpec tasks 10.1–10.5

**Files:**

- Create: `docs/evidence/structured-log-baseline-2026-05-26.md`
- Modify: `openspec/changes/cross-service-structured-log-baseline/tasks.md`

- [ ] Create the durable evidence document from observed artifacts, with these exact sections and no secret values: `Scope and machine context`, `Commands`, `True runtime closed loop`, `Adapter harness disclosure`, `Four-unit files`, `Trace timeline`, `Environment snapshot and redaction`, `Verified facts`, `Inferences`, `Unverified risks`, `Artifact paths`.

  The document must name the branch/head, Windows/PowerShell/Node/Python versions, authorized IFC fixture name and SHA-256, `ifc_ready_job_id`, `conversion_job_id`, `review_session_id`, chosen `trace_id`, per-service file counts, per-service record/event summaries, env-snapshot presence, redaction result, smoke status, and shutdown result. It must say verbatim: `automatic four-service propagation claimed: no` and `viewer/scripts records in this run are adapter-harness evidence, not production app-path evidence`.

  Expected: every claim points to `baseline.json`, `bscheme-readiness.json`, `runtime-summary.json`, `adapter-harness-summary.json`, `log-validation.json`, or `timeline.json`; no raw environment value or fixture content appears.

- [ ] Mark each of 10.1–10.5 `[x]` only when its matching observation passed; preserve all historical 1–9 and 11 text byte-for-byte.

  ```powershell
  git diff -- openspec\changes\cross-service-structured-log-baseline\tasks.md
  rg -n '^\- \[[ x]\] 10\.[1-5]' openspec\changes\cross-service-structured-log-baseline\tasks.md
  ```

  Expected: exactly five 10.x lines are checked only after Task 4 passes; no other task checkbox or historical count changes.

- [ ] Run focused document/change validation, inspect staged scope, and commit the evidence closeout.

  ```powershell
  npx --no-install openspec validate cross-service-structured-log-baseline --strict
  git diff --check
  git add -- docs\evidence\structured-log-baseline-2026-05-26.md openspec\changes\cross-service-structured-log-baseline\tasks.md
  git diff --cached --name-only
  git diff --cached --check
  git commit -m "docs: record structured-log runtime evidence" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected: strict validation passes; staged names are exactly the evidence doc and tasks file; commit succeeds. If any 10.x observation is missing, do not commit a false checkmark—record HELD state instead.

### Task 6: Run affected verification and GitNexus scope gate

**Files:**

- Read/execute: `tests/contracts/structured-log/**`
- Read/execute: `bim-review-coordinator/tests/app/viewerLogIntake.test.ts`
- Read/execute: `web-viewer-sample/scripts/verify-struct-log.mjs`
- Read/execute: `bim-streaming-server/tests/test_conversion_authority_api.py`
- Read/execute: `scripts/tests/test-struct-log.ps1`

- [ ] Run the affected checks from their prescribed working directories.

  ```powershell
  Set-Location -LiteralPath $root
  & .\.venv\Scripts\python.exe -m pytest tests\contracts\structured-log -q -p no:cacheprovider
  if ($LASTEXITCODE -ne 0) { throw 'root structured-log tests failed' }
  Push-Location bim-review-coordinator
  npm run verify
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'coordinator verify failed' }
  Pop-Location
  Push-Location web-viewer-sample
  npm run typecheck
  npm run test:struct-log
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'viewer structured-log verification failed' }
  Pop-Location
  Push-Location bim-streaming-server
  & ..\.venv\Scripts\python.exe -m pytest tests\test_conversion_authority_api.py -q -p no:cacheprovider
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'streaming conversion authority tests failed' }
  Pop-Location
  pwsh -NoProfile -File scripts\tests\test-struct-log.ps1
  if ($LASTEXITCODE -ne 0) { throw 'PowerShell structured-log tests failed' }
  ```

  Expected: root structured-log suite, coordinator verify, viewer typecheck/adapter test, streaming conversion authority, and PowerShell adapter tests all exit 0. Record exact counts from stdout in the evidence document rather than copying historical counts.

- [ ] Run strict OpenSpec validation and PR local preflight.

  ```powershell
  npx --no-install openspec validate cross-service-structured-log-baseline --strict
  npx --no-install openspec validate --all --strict
  .\scripts\dev\check-pr-local-preflight.ps1
  ```

  Expected: both OpenSpec validations and local preflight exit 0; any skip is recorded as a known gap, not pass.

- [ ] Run GitNexus `detect_changes({scope:"compare", base_ref:"origin/main"})`; because this closeout modifies no production symbols, expected changed symbols/processes are zero. Independently cross-check with Git.

  ```powershell
  git diff --name-status origin/main...HEAD
  git diff --check origin/main...HEAD
  ```

  Expected: Git shows only predecessor archive plus plan/evidence/OpenSpec closeout paths; GitNexus reports no production symbol/flow impact. If linked-worktree indexing is stale/unavailable, report `UNKNOWN` with the Git diff fallback and do not invent a pass.

### Task 7: Archive the completed change and prepare ship-ready evidence

**Files:**

- Move/delete by OpenSpec CLI: `openspec/changes/cross-service-structured-log-baseline/**`
- Modify if required by archive sync: `openspec/specs/cross-service-structured-log-baseline/spec.md`
- Create by OpenSpec CLI: `openspec/changes/archive/2026-07-24-cross-service-structured-log-baseline/**`

- [ ] Stop only this worktree-owned stack and preserve shutdown evidence before archive.

  ```powershell
  Set-Location -LiteralPath $root
  .\scripts\stop-all.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1 -DetectOnly
  Remove-Item Env:\BIM_TRACE_ID -ErrorAction SilentlyContinue
  Remove-Item Env:\LOG_ROOT -ErrorAction SilentlyContinue
  ```

  Expected: tracked pidfile-owned services stop; final detect shows no owned listener on required ports. Unknown processes are not stopped.

- [ ] Archive only after all five 10.x tasks are checked and both strict validations are green.

  ```powershell
  $remaining = rg -n '^\- \[ \] 10\.[1-5]' openspec\changes\cross-service-structured-log-baseline\tasks.md
  if ($LASTEXITCODE -eq 0 -or $remaining) { throw 'HELD: smoke/runtime evidence tasks remain open' }
  npx --no-install openspec archive cross-service-structured-log-baseline -y
  npx --no-install openspec validate --specs --strict
  npx --no-install openspec validate --all --strict
  git diff --check
  ```

  Expected: active change directory is gone, dated archive exists, canonical spec remains valid, and both strict validations exit 0. No `--skip-specs` or `--no-validate` is used.

- [ ] Inspect exact archive delta, run GitNexus compare again, and commit archive closeout.

  ```powershell
  git status --short
  git diff --name-status
  git diff --check
  git add -- openspec\changes\archive\2026-07-24-cross-service-structured-log-baseline openspec\specs\cross-service-structured-log-baseline\spec.md
  git diff --cached --name-status
  git diff --cached --check
  git commit -m "openspec: archive structured-log baseline" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  Expected: staged delta contains only the dated archive and any CLI-produced canonical spec sync; commit succeeds. If the archive date/path differs in actual CLI output, stage the exact CLI-produced dated path and record it in closeout rather than fabricating the expected path.

- [ ] Rebase/merge freshness and ship-readiness gate before P6.

  ```powershell
  git status --short
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  $mergeBase = git merge-base HEAD origin/main
  $originMain = git rev-parse origin/main
  if ($mergeBase -ne $originMain) { git rebase origin/main }
  npx --no-install openspec validate --all --strict
  .\scripts\dev\check-pr-local-preflight.ps1
  git diff --check origin/main...HEAD
  git status --short
  ```

  Expected: unpublished branch is rebased onto current `origin/main`, validations rerun after rebase, and worktree is clean. P6 PR body must disclose `Change lane=S`, `Behavior contract changed=yes`, requirement source path, `userFacing=false`, true runtime versus harness evidence, GitNexus result/fallback, exact evidence paths, and `automatic four-service propagation claimed: no`; merge proceeds only through the spec-to-done ship gate.
