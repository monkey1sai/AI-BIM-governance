[CmdletBinding()]
param(
    [switch] $StreamingOnly,
    [switch] $TsOnly,
    [switch] $PyOnly,
    [switch] $ContinueOnError,
    [Alias('Profile')][ValidateSet('Developer', 'Deployment')][string] $VerifyProfile = 'Developer',
    [switch] $PlanOnly,
    [switch] $Json,
    [string[]] $ChangedPath = @(),
    [switch] $Full,
    [ValidatePattern('^[0-9a-f]{40}$')][string] $Subject,
    [string] $OutcomeOut,
    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

# 跨 repo verify 入口。Developer profile 依序跑完整開發 contract；
# Deployment profile 只驗證 canonical pruning contract 保留的 artifact 與已部署 runtime。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$Python = Join-Path $RepoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) { $Python = 'python' }
$PowerShell = (Get-Process -Id $PID -ErrorAction SilentlyContinue).Path
if ([string]::IsNullOrWhiteSpace($PowerShell) -or -not (Test-Path $PowerShell)) {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        $PowerShell = $pwsh.Source
    }
    else {
        $PowerShell = 'powershell.exe'
    }
}

function Test-DeploymentRequiredArtifacts {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string[]] $RequiredRelativePaths
    )

    $missing = @(
        foreach ($relativePath in $RequiredRelativePaths) {
            if (-not (Test-Path -LiteralPath (Join-Path $Root $relativePath) -PathType Leaf)) {
                $relativePath
            }
        }
    )
    if ($missing.Count -gt 0) {
        throw "deployment required artifact missing: $($missing -join ', ')"
    }
}

function Test-DeploymentHttpEndpoint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Uri
    )

    try {
        $requestParameters = @{ Uri = $Uri; TimeoutSec = 10; ErrorAction = 'Stop' }
        if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('UseBasicParsing')) {
            $requestParameters.UseBasicParsing = $true
        }
        $response = Invoke-WebRequest @requestParameters
        if ($response.StatusCode -ne 200) {
            throw "unexpected HTTP status $($response.StatusCode)"
        }
    } catch {
        throw "deployment $Name check failed: $($_.Exception.Message)"
    }
}

function New-DeploymentHealthTarget {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Uri
    )

    return @{
        Name = $Name
        Cwd = '.'
        Required = $true
        Detail = "GET $Uri"
        Action = {
            Test-DeploymentHttpEndpoint -Name $Name -Uri $Uri
        }.GetNewClosure()
    }
}

if ($VerifyProfile -eq 'Deployment' -and ($StreamingOnly -or $TsOnly -or $PyOnly)) {
    throw 'Deployment profile does not accept StreamingOnly, TsOnly, or PyOnly filters.'
}

function Invoke-VerificationPlannerProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $NodePath,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $NodePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'Verification planner process could not be started.' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw 'Verification planner process timed out.'
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if ($stdout.Length + $stderr.Length -gt 4194304) {
            throw 'Verification planner output exceeded the size limit.'
        }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
    } finally {
        $process.Dispose()
    }
}
if ($Json -and -not $PlanOnly) {
    throw 'Json output is supported only with PlanOnly.'
}
if (-not [string]::IsNullOrWhiteSpace($OutcomeOut) -and ($PlanOnly -or $Json -or [string]::IsNullOrWhiteSpace($Subject))) {
    throw 'OutcomeOut requires an executing Developer run and a full lowercase Subject commit.'
}
if ($VerifyProfile -eq 'Deployment' -and ($Json -or $ChangedPath.Count -gt 0 -or $Full -or
    -not [string]::IsNullOrWhiteSpace($Subject) -or -not [string]::IsNullOrWhiteSpace($OutcomeOut))) {
    throw 'Deployment is a legacy_profile_not_migrated adapter and does not accept Json, ChangedPath, Full, Subject, or OutcomeOut.'
}
if (($ChangedPath.Count -gt 0 -or $Full) -and ($StreamingOnly -or $TsOnly -or $PyOnly)) {
    throw 'ChangedPath/Full dispatch cannot be combined with legacy Developer filters.'
}

$Targets = @()
$OmittedTargets = @()
$publishInventory = $PlanOnly -or $VerifyProfile -eq 'Deployment'

if ($VerifyProfile -eq 'Deployment') {
    # The deployment checkout intentionally prunes authoring/tooling scripts;
    # load the verifier's contract from this canonical script directory.
    . (Join-Path $PSScriptRoot 'lib\rebuild-test-deploy.ps1')
    $pruningContract = Get-TestDeployPruningContract
    $requiredArtifacts = @('scripts\deploy.ps1') + @($pruningContract.PreservedProductionFiles)
    Test-DeploymentRequiredArtifacts -Root $RepoRoot -RequiredRelativePaths $requiredArtifacts

    $Targets += @{
        Name = 'deployment required artifacts'
        Cwd = '.'
        Required = $true
        Detail = ($requiredArtifacts -join ', ')
        Action = {
            Test-DeploymentRequiredArtifacts -Root $RepoRoot -RequiredRelativePaths $requiredArtifacts
        }.GetNewClosure()
    }
    $Targets += New-DeploymentHealthTarget -Name 'coordinator health' -Uri 'http://127.0.0.1:8004/health'
    $Targets += New-DeploymentHealthTarget -Name 'governance health' -Uri 'http://127.0.0.1:49102/health'
    $Targets += New-DeploymentHealthTarget -Name 'conversion health' -Uri 'http://127.0.0.1:49101/health'
    $Targets += New-DeploymentHealthTarget -Name 'kit manager health' -Uri 'http://127.0.0.1:8010/health'
    $Targets += New-DeploymentHealthTarget -Name 'viewer endpoint' -Uri 'http://127.0.0.1:5173/'
    $OmittedTargets += @(
        @{ Name = 'tests (contracts+fakes)'; Reason = 'authoring contracts are intentionally pruned from deployment checkout' },
        @{ Name = 'bim-review-coordinator (full verify)'; Reason = 'developer suite requires root contract fixtures outside deployment profile' },
        @{ Name = 'web-viewer-sample (full verify)'; Reason = 'developer suite requires authoring fixtures and host dependencies absent after canonical cleanup' },
        @{ Name = 'bim-streaming-server stage-loading contract'; Reason = 'source-level contract suite is retained for developer and CI profiles, not deployed runtime verification' }
    )
}
else {
    $manifestPath = Join-Path $RepoRoot 'scripts\verification-manifest.json'
    $plannerPath = Join-Path $RepoRoot 'scripts\lib\verification-plan.mjs'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $plannerPath -PathType Leaf)) {
        throw 'Developer verification manifest or planner is missing.'
    }
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $node) { throw 'Node.js is required to read the verification manifest.' }

    $plannerArgs = @($plannerPath, '--manifest', $manifestPath)
    if ($ChangedPath.Count -gt 0 -or $Full) {
        foreach ($path in $ChangedPath) { $plannerArgs += @('--path', $path) }
        if ($Full) { $plannerArgs += '--full' }
    }
    else {
        $developerProfile = if ($StreamingOnly) {
            'developer-streaming'
        } elseif ($TsOnly -and $PyOnly) {
            'developer-none'
        } elseif ($TsOnly) {
            'developer-ts'
        } elseif ($PyOnly) {
            'developer-py'
        } else {
            'developer'
        }
        $plannerArgs += @('--default-profile', $developerProfile)
    }

    if (-not [string]::IsNullOrWhiteSpace($OutcomeOut)) {
        $runnerPath = Join-Path $RepoRoot 'scripts\lib\verification-runner.mjs'
        if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { throw 'Developer verification runner is missing.' }
        $runnerArgs = @($runnerPath, '--repo-root', $RepoRoot) + @($plannerArgs | Select-Object -Skip 1) + @('--subject', $Subject, '--outcome-out', $OutcomeOut)
        if ($ContinueOnError) { $runnerArgs += '--continue-on-error' }
        & $node.Source @runnerArgs
        exit $LASTEXITCODE
    }

    $plannerResult = Invoke-VerificationPlannerProcess -NodePath $node.Source `
        -Arguments $plannerArgs -WorkingDirectory $RepoRoot
    $plannerExitCode = $plannerResult.ExitCode
    $planJson = $plannerResult.Stdout.TrimEnd("`r", "`n")
    if ([string]::IsNullOrWhiteSpace($planJson)) {
        throw 'Verification planner returned no JSON document.'
    }
    if ($Json) {
        [Console]::Out.WriteLine($planJson)
        exit $plannerExitCode
    }
    try {
        $PlanDocument = $planJson | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    } catch {
        throw 'Verification planner returned invalid JSON.'
    }
    if ($plannerExitCode -ne 0) {
        Write-Host "[FAIL] planner result=$($PlanDocument.result) — unknown_paths=$(@($PlanDocument.unknown_paths) -join ',')" -ForegroundColor Red
        foreach ($errorItem in @($PlanDocument.errors)) {
            Write-Host "[FAIL] planner $($errorItem.code) — $($errorItem.message)" -ForegroundColor Red
        }
        exit $plannerExitCode
    }

    foreach ($plannedTarget in @($PlanDocument.targets | Where-Object { $_.required })) {
        $plannedGates = @($plannedTarget.gates)
        foreach ($gate in $plannedGates) {
            if (-not $gate.configured) {
                $omittedName = [string]$plannedTarget.display_name
                if ($plannedGates.Count -gt 1) { $omittedName = "$omittedName [$($gate.id)]" }
                $OmittedTargets += @{ Name = $omittedName; Reason = "not_configured:$($gate.not_configured_reason)" }
                continue
            }
            $command = switch ([string]$gate.command.executable) {
                'python' { $Python }
                'pwsh' { $PowerShell }
                default { [string]$gate.command.executable }
            }
            $name = [string]$plannedTarget.display_name
            if ($plannedGates.Count -gt 1) { $name = "$name [$($gate.id)]" }
            $Targets += @{
                Name = $name
                Cmd = $command
                Args = @($gate.command.args | ForEach-Object { [string]$_ })
                Cwd = [string]$gate.cwd
                Required = $PlanDocument.dispatch -ne 'profile'
                Reason = [string]$plannedTarget.reason
            }
        }
    }
}

if ($publishInventory) {
    if ($VerifyProfile -eq 'Developer' -and $null -ne $PlanDocument -and $PlanDocument.dispatch -ne 'profile') {
        Write-Host "[PLAN] dispatch=$($PlanDocument.dispatch) result=$($PlanDocument.result)" -ForegroundColor Cyan
    }
    else {
        Write-Host "[PLAN] profile=$($VerifyProfile.ToLowerInvariant())" -ForegroundColor Cyan
    }
    foreach ($target in $Targets) {
        $detail = if ($target.ContainsKey('Detail')) { $target.Detail } else { "$($target.Cmd) $($target.Args -join ' ')" }
        Write-Host "[EXECUTE] $($target.Name) — $detail"
    }
    foreach ($omitted in $OmittedTargets) {
        Write-Host "[OMIT] $($omitted.Name) — $($omitted.Reason)" -ForegroundColor Yellow
    }
    if ($PlanOnly) { exit 0 }
}

$Failures = @()
$Passed = @()

foreach ($t in $Targets) {
    $cwd = Join-Path $RepoRoot $t.Cwd
    if (-not (Test-Path $cwd)) {
        if ($t.Required) {
            $Failures += $t.Name
            Write-Host "[FAIL] $($t.Name) — required directory not found at $cwd" -ForegroundColor Red
            if (-not $ContinueOnError) { break }
        }
        else {
            Write-Host "[SKIP] $($t.Name) — directory not found at $cwd" -ForegroundColor Yellow
        }
        continue
    }
    $detail = if ($t.ContainsKey('Detail')) { $t.Detail } else { "$($t.Cmd) $($t.Args -join ' ')" }
    Write-Host "`n==> [$($t.Name)] $detail" -ForegroundColor Cyan
    Push-Location $cwd
    try {
        if ($t.ContainsKey('Action')) {
            & $t.Action
            $code = 0
        }
        else {
            & $t.Cmd @($t.Args)
            $code = $LASTEXITCODE
        }
    } catch {
        Write-Host "  exception: $_" -ForegroundColor Red
        $code = 1
    } finally {
        Pop-Location
    }
    if ($code -ne 0) {
        $Failures += $t.Name
        Write-Host "[FAIL] $($t.Name) (exit $code)" -ForegroundColor Red
        if (-not $ContinueOnError) { break }
    } else {
        $Passed += $t.Name
        Write-Host "[OK]   $($t.Name)" -ForegroundColor Green
    }
}

Write-Host "`n======================================"
Write-Host "Passed:  $($Passed -join ', ')"
Write-Host "Failed:  $($Failures -join ', ')"
Write-Host '======================================'

if ($Failures.Count -gt 0) { exit 1 } else { exit 0 }
