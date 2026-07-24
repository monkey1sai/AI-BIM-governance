[CmdletBinding()]
param(
    [switch] $StreamingOnly,
    [switch] $TsOnly,
    [switch] $PyOnly,
    [switch] $ContinueOnError,
    [Alias('Profile')][ValidateSet('Developer', 'Deployment')][string] $VerifyProfile = 'Developer',
    [switch] $PlanOnly,
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
    $StreamingTarget = @{
        Name = 'bim-streaming-server'
        Cmd = $PowerShell
        Args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\tests\test-stage-loading-contract.ps1')
        Cwd = 'bim-streaming-server'
        Required = $false
    }
    if ($StreamingOnly) {
        $Targets += $StreamingTarget
    }
    else {
        if (-not $TsOnly) {
            # B-scheme T8 §9.1：default verify 不再依賴已刪 _bim-control / _worker；
            # 改以 repo-root tests/（外部平台 contracts + test-only fakes）作 Python 覆蓋。
            $Targets += @{ Name = 'tests (contracts+fakes)'; Cmd = $Python; Args = @('-m', 'pytest', 'tests', '-q', '-p', 'no:cacheprovider'); Cwd = '.'; Required = $false }
        }
        if (-not $PyOnly) {
            $Targets += @{ Name = 'bim-review-coordinator'; Cmd = 'npm'; Args = @('run', 'verify'); Cwd = 'bim-review-coordinator'; Required = $false }
            $Targets += @{ Name = 'web-viewer-sample'; Cmd = 'npm'; Args = @('run', 'verify'); Cwd = 'web-viewer-sample'; Required = $false }
        }
        if (-not $TsOnly -and -not $PyOnly) {
            $Targets += $StreamingTarget
        }
    }
}

if ($publishInventory) {
    Write-Host "[PLAN] profile=$($VerifyProfile.ToLowerInvariant())" -ForegroundColor Cyan
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
