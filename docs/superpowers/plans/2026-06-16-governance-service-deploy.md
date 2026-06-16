# Governance Service Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.\scripts\deploy.ps1 -Build` start and verify host-native `governance-service` so A1/M1 closeout can be operated from `http://127.0.0.1:8004/ui/#/a1` without a second terminal.

**Architecture:** Keep `governance-service` host-native on `127.0.0.1:49102`. `deploy.ps1` manages it through `scripts/lib/host-native-launcher.ps1`, writes PID/log/signature files under `scripts\.run`, injects `HOST_GOVERNANCE_API_BASE=http://host.docker.internal:<port>` for Docker coordinator, and verifies `/health` in Phase 5. No governance Docker container is added.

**Tech Stack:** PowerShell 5.1 compatible deploy scripts, FastAPI/uvicorn host-native Python service, existing Docker compose web-plane, existing coordinator `/api/governance/*` proxy, existing custom PowerShell test scripts.

---

## Files

- Modify: `scripts/lib/host-native-launcher.ps1`
- Modify: `scripts/deploy.ps1`
- Modify: `scripts/stop-all.ps1`
- Modify: `scripts/tests/test-deploy-dryrun.ps1`
- Add: `scripts/tests/test-deploy-governance-static.ps1`
- Optional docs update: `governance-service/README.md`

Do not modify existing untracked files under `artifacts/`, `test-results/`, or unrelated `docs/superpowers/*conv-coverage*` files.

## Constraints

- Do not work on `main`; use a feature branch.
- Before changing existing functions/classes/methods that are indexed by GitNexus, run impact analysis and report risk. For these PowerShell script edits, first try `gitnexus_impact` on `Start-HostNativeConversion`, `Start-HostNativeKit`, and deploy helper names if available; if the index is stale, run `npx gitnexus analyze` before continuing.
- Do not add a new production dependency.
- Do not Dockerize `governance-service`.
- Do not commit unless the user explicitly asks for commit/push/PR. If commit is requested later, run `gitnexus_detect_changes` before committing.
- Preserve PowerShell 5.1 compatibility.

## Task 1: Add host-native governance launcher

- [ ] **Step 1: Inspect current launcher patterns**

Read:

```powershell
Get-Content -Raw scripts\lib\host-native-launcher.ps1
Get-Content -Raw governance-service\README.md
```

Confirm existing reusable functions:

- `Start-HostNativeService`
- `Wait-HostNativeHealth`
- `Start-HostNativeConversion`
- `Start-HostNativeKit`

- [ ] **Step 2: Add `Start-HostNativeGovernance`**

Modify `scripts/lib/host-native-launcher.ps1`.

Add a function after `Start-HostNativeConversion` and before `Start-HostNativeKit`:

```powershell
function Start-HostNativeGovernance {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int] $Port = 49102,
        [string] $DbPath = '',
        [string] $FileLibraryRoot = ''
    )
    $runDir = Join-Path $RepoRoot 'scripts\.run'
    if (-not (Test-Path -LiteralPath $runDir)) {
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    }

    $serviceRoot = Join-Path $RepoRoot 'governance-service'
    $python312 = 'C:\Program Files\Python312\python.exe'
    $repoVenvPython = Join-Path $RepoRoot '.venv\Scripts\python.exe'
    $pythonExe = if (Test-Path -LiteralPath $python312 -PathType Leaf) {
        $python312
    } elseif (Test-Path -LiteralPath $repoVenvPython -PathType Leaf) {
        $repoVenvPython
    } else {
        'python'
    }

    Remove-Item Env:PYTHONNOUSERSITE -ErrorAction SilentlyContinue
    & $pythonExe -c "import ifcopenshell, fastapi, uvicorn" *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "governance-service Python cannot import ifcopenshell, fastapi, and uvicorn: $pythonExe"
    }

    $env:GOV_PORT = "$Port"
    if (-not [string]::IsNullOrWhiteSpace($DbPath)) {
        $env:GOV_DB_PATH = $DbPath
    }
    if (-not [string]::IsNullOrWhiteSpace($FileLibraryRoot)) {
        $env:BIM_FILE_LIBRARY_ROOT = $FileLibraryRoot
    }

    return (Start-HostNativeService `
        -Name 'governance-service' `
        -WorkingDirectory $serviceRoot `
        -FilePath $pythonExe `
        -ArgumentList @('-m','uvicorn','app:app','--host','127.0.0.1','--port',"$Port") `
        -RunDir $runDir)
}
```

Expected result: the function delegates all process/log/PID behavior to `Start-HostNativeService` and does not duplicate `Start-Process`.

- [ ] **Step 3: Syntax check**

Run:

```powershell
powershell -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts\lib\host-native-launcher.ps1)) | Out-Null"
```

Expected: exit code 0.

## Task 2: Wire governance into deploy parameters and runtime state

- [ ] **Step 1: Add deploy parameters**

Modify `scripts/deploy.ps1` param block:

```powershell
[switch] $SkipGovernance,
[int]    $GovernancePort = 49102,
```

Place them near `-SkipConversion` because all three are host-native runtime controls.

- [ ] **Step 2: Add script-scope paths**

Near the existing runtime signature paths, add:

```powershell
$script:governanceRuntimeSignaturePath = Join-Path $RunDir 'governance-service.params.json'
```

- [ ] **Step 3: Add governance runtime helpers**

Near `New-ConversionRuntimeSignature`, add:

```powershell
function New-GovernanceRuntimeSignature {
    param(
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)][string] $DbPath,
        [Parameter(Mandatory = $true)][string] $FileLibraryRoot
    )
    return ([pscustomobject]@{
        host            = '127.0.0.1'
        port            = $Port
        dbPath          = $DbPath
        fileLibraryRoot = $FileLibraryRoot
    } | ConvertTo-Json -Compress)
}
```

Reuse `Test-KitRuntimeSignatureMatches` and `Set-KitRuntimeSignature` for this signature file unless you choose to rename those generic helpers in a separate, GitNexus-checked refactor. Do not do that rename in this task.

- [ ] **Step 4: Resolve governance settings after env/volume resolution**

After `$volume` is resolved and before Phase 3 port audit, define:

```powershell
$resolvedGovernancePort = Resolve-DeployIntValue `
    -Name 'GOV_PORT' `
    -EnvFile $resolvedEnvFile `
    -Default 49102 `
    -ExplicitValue $GovernancePort `
    -HasExplicitValue `
    -Min 1 `
    -Max 65535

$resolvedGovernanceDbPath = Join-Path $RepoRoot 'storage\governance.db'
$resolvedGovernanceFileLibraryRoot = if ($volume -and $volume.runtimeStorageRoot) {
    $volume.runtimeStorageRoot
} else {
    Join-Path $RepoRoot 'storage'
}
$governanceRuntimeSignature = New-GovernanceRuntimeSignature `
    -Port $resolvedGovernancePort `
    -DbPath $resolvedGovernanceDbPath `
    -FileLibraryRoot $resolvedGovernanceFileLibraryRoot
$resolvedGovernanceApiBaseForDocker = if ($SkipGovernance) { '' } else { "http://host.docker.internal:$resolvedGovernancePort" }
if (-not $SkipGovernance) {
    [Environment]::SetEnvironmentVariable('HOST_GOVERNANCE_API_BASE', $resolvedGovernanceApiBaseForDocker, 'Process')
    if ($PSBoundParameters.ContainsKey('GovernancePort') -or $resolvedGovernancePort -ne 49102) {
        $shouldRefreshWebPlane = $true
    }
}
```

- [ ] **Step 5: Add governance fields to dry-run audit**

In the `$auditObj.runtime` object, add:

```powershell
governanceSkipped = [bool]$SkipGovernance
governancePort = $resolvedGovernancePort
governanceApiBaseForDocker = $resolvedGovernanceApiBaseForDocker
governanceDbPath = $resolvedGovernanceDbPath
governanceFileLibraryRoot = $resolvedGovernanceFileLibraryRoot
```

Expected: `deploy.ps1 -DryRun` still exits before Phase 4, but `scripts\.run\deploy-audit.json` records whether governance would be started and which endpoint Docker coordinator would use.

- [ ] **Step 6: Include governance in port audit**

Find the Phase 3 call:

```powershell
$ports = Test-PortAvailability -RepoRoot $RepoRoot -KitSignalPort $resolvedKitSignalPort -KitMediaPort $resolvedKitMediaPort -ExtraHostNativePorts $resolvedSpectatorSignalPorts -ExtraHostNativeUdpPorts $resolvedSpectatorMediaPorts
```

Change it to include governance port unless skipped:

```powershell
$extraHostNativePorts = @($resolvedSpectatorSignalPorts)
if (-not $SkipGovernance) { $extraHostNativePorts += $resolvedGovernancePort }
$ports = Test-PortAvailability -RepoRoot $RepoRoot -KitSignalPort $resolvedKitSignalPort -KitMediaPort $resolvedKitMediaPort -ExtraHostNativePorts $extraHostNativePorts -ExtraHostNativeUdpPorts $resolvedSpectatorMediaPorts
```

Expected: a stranger process on 49102 triggers the existing Phase 3 guard.

## Task 3: Add Phase 4 governance lifecycle

- [ ] **Step 1: Insert governance before conversion**

Change Phase 4 comment to:

```powershell
# Phase 4: Start (依賴順序 4a → 4b → 4c → 4d)
```

Insert a new block before current conversion block:

```powershell
# 4a: host-native governance-service
if ($SkipGovernance) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4a host-native governance (--SkipGovernance)' -LogPath $LogPath | Out-Null
} else {
    $governanceHealthUrl = "http://127.0.0.1:$resolvedGovernancePort/health"
    $governanceAlreadyRunning = Test-AlreadyRunning -Name 'governance-service' -RunDir $RunDir
    if ($governanceAlreadyRunning -and -not (Test-KitRuntimeSignatureMatches -Path $script:governanceRuntimeSignaturePath -Expected $governanceRuntimeSignature)) {
        Write-DeployTag -Tag 'fix' -Message 'Phase 4a restarting host-native governance because runtime parameters changed' -LogPath $LogPath | Out-Null
        Stop-HostNativeService -Name 'governance-service' -RunDir $RunDir | Out-Null
        $governanceAlreadyRunning = $false
    }
    if ($governanceAlreadyRunning) {
        if (Wait-HostNativeHealth -Name 'governance-service' -Url $governanceHealthUrl -TimeoutSec 5) {
            Write-DeployTag -Tag 'skip' -Message "Phase 4a host-native governance already running ($governanceHealthUrl 200)" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'fix' -Message "Phase 4a restarting host-native governance because wrapper is alive but $governanceHealthUrl is unhealthy" -LogPath $LogPath | Out-Null
            Stop-HostNativeService -Name 'governance-service' -RunDir $RunDir | Out-Null
            $governanceAlreadyRunning = $false
        }
    }
    if (-not $governanceAlreadyRunning) {
        Write-DeployTag -Tag 'ok' -Message 'Phase 4a starting host-native governance-service' -LogPath $LogPath | Out-Null
        $startInfo = Start-HostNativeGovernance `
            -RepoRoot $RepoRoot `
            -Port $resolvedGovernancePort `
            -DbPath $resolvedGovernanceDbPath `
            -FileLibraryRoot $resolvedGovernanceFileLibraryRoot
        Write-DeployTag -Tag 'ok' -Message "governance PID=$($startInfo.Pid) log=$($startInfo.LogPath)" -LogPath $LogPath | Out-Null
        $ok = Wait-HostNativeHealth -Name 'governance-service' -Url $governanceHealthUrl -TimeoutSec 30
        if (-not $ok) {
            Write-DeployTag -Tag 'fail' -Message "stage=4a Phase 4a governance-service $governanceHealthUrl did not return 200 within 30s" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4a (governance)'
            exit 4
        }
        Set-KitRuntimeSignature -Path $script:governanceRuntimeSignaturePath -Value $governanceRuntimeSignature
        Write-DeployTag -Tag 'ok' -Message "Phase 4a governance-service ready ($governanceHealthUrl 200)" -LogPath $LogPath | Out-Null
    }
}
```

- [ ] **Step 2: Renumber existing Phase 4 labels**

Change:

- conversion `4a` -> `4b`
- Kit `4b` -> `4c`
- docker compose `4c` -> `4d`

This includes comments, log messages, `stage=...`, and `FailedPhase` labels.

- [ ] **Step 3: Inject Docker coordinator governance base URL**

Before starting `scripts\start-web-plane-docker.ps1`, add:

```powershell
if (-not $SkipGovernance) {
    [Environment]::SetEnvironmentVariable(
        'HOST_GOVERNANCE_API_BASE',
        "http://host.docker.internal:$resolvedGovernancePort",
        'Process'
    )
}
```

Expected: `compose.host-kit.yml` passes `GOVERNANCE_API_BASE` into the coordinator container.

## Task 4: Add Phase 5 governance verification

- [ ] **Step 1: Probe direct governance health**

In Phase 5, after `Probe-Url` helper definitions and before conversion probe, add:

```powershell
if (-not $SkipGovernance) {
    if (-not (Probe-Url -Name 'governance' -Url "http://127.0.0.1:$resolvedGovernancePort/health")) { $verifyFails += 'governance' }
}
```

- [ ] **Step 2: Probe coordinator governance proxy when Docker is running**

If `governanceProxy.ts` has no `/api/governance/health` route, do not add one in this deploy task. Instead, use the existing browser-facing file-library health proxy:

```powershell
if (-not $SkipDocker -and -not $SkipGovernance) {
    if (-not (Probe-Url -Name 'coordinator-governance-files-tree' -Url 'http://127.0.0.1:8004/api/governance/files/tree')) { $verifyFails += 'coordinator-governance-files-tree' }
}
```

Expected: this verifies Docker coordinator can reach host-native governance through `host.docker.internal`.

## Task 5: Update stop-all

- [ ] **Step 1: Add governance expected service**

Modify `scripts/stop-all.ps1`.

Add to `$ExpectedServices`:

```powershell
@{ Name = "governance-service"; Ports = @(49102) },
```

Place it near the other host-native services.

- [ ] **Step 2: Verify stop-all syntax**

Run:

```powershell
powershell -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts\stop-all.ps1)) | Out-Null"
```

Expected: exit code 0.

## Task 6: Update dry-run and static tests

- [ ] **Step 1: Extend `test-deploy-dryrun.ps1`**

Modify `scripts/tests/test-deploy-dryrun.ps1` so it asserts dry-run audit contains governance runtime intent without entering Phase 4.

After the existing `deploy-audit.json` check, add:

```powershell
$audit = Get-Content -LiteralPath $auditJson -Raw | ConvertFrom-Json
Assert-Equal 49102 $audit.runtime.governancePort 'default governance port is 49102'
Assert-Equal $false $audit.runtime.governanceSkipped 'default governance is not skipped'
Assert-Equal 'http://host.docker.internal:49102' $audit.runtime.governanceApiBaseForDocker 'default Docker governance base URL'
Write-TestPass 'governance dry-run audit defaults'
```

Also add a skip test invocation:

```powershell
$skipGovernanceOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $deploy -DryRun -SkipGovernance *>&1 | Out-String
Assert-True (-not ($skipGovernanceOutput -match 'Phase 4:')) 'Phase 4 not entered under -DryRun -SkipGovernance'
$skipGovernanceAudit = Get-Content -LiteralPath $auditJson -Raw | ConvertFrom-Json
Assert-Equal $true $skipGovernanceAudit.runtime.governanceSkipped 'governance skip state recorded in dry-run audit'
Assert-Equal '' $skipGovernanceAudit.runtime.governanceApiBaseForDocker 'skipped governance has no Docker base URL'
Write-TestPass 'governance skip dry-run audit'
```

- [ ] **Step 2: Add static deploy governance test**

Create `scripts/tests/test-deploy-governance-static.ps1`:

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$deploy = Get-Content -Raw (Join-Path $RepoRoot 'scripts\deploy.ps1')
$launcher = Get-Content -Raw (Join-Path $RepoRoot 'scripts\lib\host-native-launcher.ps1')
$stopAll = Get-Content -Raw (Join-Path $RepoRoot 'scripts\stop-all.ps1')

function Assert-Contains {
    param([string] $Text, [string] $Pattern, [string] $Message)
    if ($Text -notmatch [regex]::Escape($Pattern)) {
        throw $Message
    }
}

Assert-Contains $deploy '[switch] $SkipGovernance' 'deploy.ps1 must expose -SkipGovernance'
Assert-Contains $deploy '[int]    $GovernancePort = 49102' 'deploy.ps1 must expose -GovernancePort 49102'
Assert-Contains $deploy 'Start-HostNativeGovernance' 'deploy.ps1 must start governance through host-native launcher'
Assert-Contains $deploy 'HOST_GOVERNANCE_API_BASE' 'deploy.ps1 must inject coordinator governance base URL'
Assert-Contains $deploy 'coordinator-governance-files-tree' 'deploy.ps1 must verify coordinator to governance proxy'
Assert-Contains $launcher 'function Start-HostNativeGovernance' 'launcher must define Start-HostNativeGovernance'
Assert-Contains $launcher "-Name 'governance-service'" 'launcher must use governance-service PID/log name'
Assert-Contains $stopAll 'governance-service' 'stop-all.ps1 must know governance-service'

[scriptblock]::Create($deploy) | Out-Null
[scriptblock]::Create($launcher) | Out-Null
[scriptblock]::Create($stopAll) | Out-Null
Write-Host 'PASS deploy governance static checks'
```

- [ ] **Step 3: Run tests**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-deploy-governance-static.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-deploy-dryrun.ps1
```

Expected:

```txt
PASS deploy governance static checks
PASS ...
```

## Task 7: Runtime smoke

- [ ] **Step 1: Clean current runtime**

Run:

```powershell
.\scripts\stop-all.ps1
```

Expected: exits 0 or reports nothing relevant running.

- [ ] **Step 2: Start A1-only deploy smoke**

Run:

```powershell
.\scripts\deploy.ps1 -Build -SkipKit -SkipConversion -StrictPostVerify
```

Expected:

- `Phase 4a governance-service ready`
- `Phase 4d docker compose up complete`
- `verify governance http=200`
- `verify coordinator-governance-files-tree http=200`
- summary points to `http://127.0.0.1:8004/ui`

- [ ] **Step 3: Manual HTTP probes**

Run:

```powershell
Invoke-WebRequest http://127.0.0.1:49102/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8004/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8004/api/governance/files/tree -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8004/ui -UseBasicParsing
```

Expected: all return 2xx.

## Task 8: A1 browser evidence

- [ ] **Step 1: Run Playwright A1 smoke**

Use existing A1 E2E spec if available:

```powershell
cd web-viewer-sample
npm run e2e -- --project=chromium --grep "A1"
```

If the grep does not select the intended test, inspect `web-viewer-sample/e2e` and run the A1 closeout spec directly.

- [ ] **Step 2: Capture evidence**

Evidence must include:

- Frontend URL: `http://127.0.0.1:8004/ui/#/a1`
- Buttons tested: file picker, run rules, expand failure drawer, create issue, export Excel/BCF if present in the scenario
- Fixture: `storage/fixture-bytes.ifc` or exact fixture path used
- Visible result: five-step state reaches scored/issued/delivered; failure drawer shows GUID/name/type/storey
- Trace/screenshot path under `test-results/` or `artifacts/e2e/`

## Task 9: Final change review

- [ ] **Step 1: Check diff**

Run:

```powershell
git diff -- scripts\lib\host-native-launcher.ps1 scripts\deploy.ps1 scripts\stop-all.ps1 scripts\tests\test-deploy-dryrun.ps1 scripts\tests\test-deploy-governance-static.ps1 governance-service\README.md
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 2: GitNexus detect changes**

If implementation changed code/scripts and user asks to commit:

```powershell
npx gitnexus detect-changes
```

Expected: affected scope is limited to deploy scripts, host-native launcher, stop-all, tests, and optional README.

- [ ] **Step 3: Report status**

Final response must include:

- Changed files
- Validation commands and pass/fail status
- Runtime URL
- PID/log files
- Evidence path
- Known risks
- Whether commit was intentionally skipped because user did not ask for it
