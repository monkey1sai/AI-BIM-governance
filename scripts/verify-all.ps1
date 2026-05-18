[CmdletBinding()]
param(
    [switch] $StreamingOnly,
    [switch] $TsOnly,
    [switch] $PyOnly,
    [switch] $ContinueOnError
)

# 跨 repo verify 入口。對 current demo repos 依序跑 verify：
#   _bim-control / _worker                           → python -m pytest tests -q
#   bim-review-coordinator                            → npm run verify
#   web-viewer-sample                                 → npm run verify
#   bim-streaming-server                              → scripts/tests/test-stage-loading-contract.ps1
#
# 任一失敗即中斷（除非指定 -ContinueOnError）。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { $Python = "python" }
$PowerShell = (Get-Process -Id $PID -ErrorAction SilentlyContinue).Path
if ([string]::IsNullOrWhiteSpace($PowerShell) -or -not (Test-Path $PowerShell)) {
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
        # B-scheme T2：_bim-control / _worker 已自 repo 刪除（外部平台由 tests/fakes 模擬）。
        # 新的 repo-root tests/（fakes + contracts）pytest 目標由 T8 readiness/smoke rewrite 加入。
    }
    if (-not $PyOnly) {
        $Targets += @{ Name = "bim-review-coordinator"; Cmd = "npm"; Args = @("run", "verify"); Cwd = "bim-review-coordinator" }
        $Targets += @{ Name = "web-viewer-sample";      Cmd = "npm"; Args = @("run", "verify"); Cwd = "web-viewer-sample" }
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
