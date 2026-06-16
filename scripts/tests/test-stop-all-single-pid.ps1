[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$RunDir = Join-Path $RepoRoot 'scripts\.run'
$PidFile = Join-Path $RunDir 'governance-service.pid'
$StopAll = Join-Path $RepoRoot 'scripts\stop-all.ps1'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)] $Condition,
        [Parameter(Mandatory = $true)][string] $Message
    )
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
Set-Content -LiteralPath $PidFile -Value '999999' -Encoding ASCII

try {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $StopAll 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    Assert-True ($exitCode -eq 0) 'stop-all exits 0 with a single stale pid file'
    Assert-True ($output -notmatch "property 'Count'") 'single pid file does not trigger strict-mode Count error'
    Assert-True ($output -match 'governance-service') 'test exercised the governance-service pid path'
} finally {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

Write-Host 'PASS stop-all single pid file'
