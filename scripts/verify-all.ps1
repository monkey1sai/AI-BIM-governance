[CmdletBinding()]
param(
    [switch] $StreamingOnly,
    [switch] $TsOnly,
    [switch] $PyOnly,
    [switch] $ContinueOnError,
    [string] $RepoRoot = '',
    [string] $PythonPath = '',
    [string] $NpmPath = '',
    [string] $PowerShellPath = ''
)

# 跨 repo verify 入口。對 current demo repos 依序跑 verify：
#   tests/contracts + tests/fakes                    → python -m pytest tests -q
#   bim-review-coordinator                            → npm run verify
#   web-viewer-sample                                 → npm run verify
#   bim-streaming-server                              → scripts/tests/test-stage-loading-contract.ps1
#
# 任一失敗即中斷（除非指定 -ContinueOnError）。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    (Resolve-Path -LiteralPath $RepoRoot).Path
}
$Python = if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $candidatePython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $candidatePython -PathType Leaf) { $candidatePython } else { "python" }
} else {
    (Resolve-Path -LiteralPath $PythonPath).Path
}
$Npm = if ([string]::IsNullOrWhiteSpace($NpmPath)) {
    "npm"
} else {
    (Resolve-Path -LiteralPath $NpmPath).Path
}
$PowerShell = if ([string]::IsNullOrWhiteSpace($PowerShellPath)) {
    (Get-Process -Id $PID -ErrorAction SilentlyContinue).Path
} else {
    (Resolve-Path -LiteralPath $PowerShellPath).Path
}
if ([string]::IsNullOrWhiteSpace($PowerShell) -or -not (Test-Path -LiteralPath $PowerShell -PathType Leaf)) {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        $PowerShell = $pwsh.Source
    }
    else {
        $PowerShell = "powershell.exe"
    }
}

$Targets = @()

$StreamingTarget = @{
    Name = "bim-streaming-server"
    Cmd = $PowerShell
    Args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\tests\test-stage-loading-contract.ps1")
    Cwd = "bim-streaming-server"
}
if ($StreamingOnly) {
    $Targets += $StreamingTarget
}
else {
    if (-not $TsOnly) {
        # B-scheme T8 §9.1：default verify 不再依賴已刪 _bim-control / _worker；
        # 改以 repo-root tests/（外部平台 contracts + test-only fakes）作 Python 覆蓋。
        $Targets += @{ Name = "tests (contracts+fakes)"; Cmd = $Python; Args = @("-m", "pytest", "tests", "-q", "-p", "no:cacheprovider"); Cwd = "." }
    }
    if (-not $PyOnly) {
        $Targets += @{ Name = "bim-review-coordinator"; Cmd = $Npm; Args = @("run", "verify"); Cwd = "bim-review-coordinator" }
        $Targets += @{ Name = "web-viewer-sample";      Cmd = $Npm; Args = @("run", "verify"); Cwd = "web-viewer-sample" }
    }
    if (-not $TsOnly -and -not $PyOnly) {
        $Targets += $StreamingTarget
    }
}

$Failures = @()
$Passed = @()

foreach ($t in $Targets) {
    $cwd = Join-Path $RepoRoot $t.Cwd
    if (-not (Test-Path $cwd)) {
        Write-Host "[SKIP] $($t.Name) — directory not found at $cwd" -ForegroundColor Yellow
        continue
    }
    Write-Host ""
    Write-Host "==> [$($t.Name)] $($t.Cmd) $($t.Args -join ' ')" -ForegroundColor Cyan
    Push-Location $cwd
    try {
        & $t.Cmd @($t.Args)
        $code = $LASTEXITCODE
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

Write-Host ""
Write-Host "======================================"
Write-Host "Passed:  $($Passed -join ', ')"
Write-Host "Failed:  $($Failures -join ', ')"
Write-Host "======================================"

if ($Failures.Count -gt 0) { exit 1 } else { exit 0 }
