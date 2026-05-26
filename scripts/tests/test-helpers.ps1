# scripts\tests\test-helpers.ps1
# 共用測試 helper,沿用 scripts\tests\test-pr-review-agent.ps1 風格。
# Repo 不用 Pester(版本 3.4.0 老),所有測試都用「dot-source 受測 module +
# 自訂 assert + temp sandbox」純 PowerShell 風格。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)] $Condition,
        [Parameter(Mandatory = $true)][string] $Message
    )
    if ($Condition -is [array]) {
        $Condition = ($Condition.Count -gt 0 -and -not ($Condition -contains $false))
    }
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)] $Expected,
        [Parameter(Mandatory = $true)] $Actual,
        [Parameter(Mandatory = $true)][string] $Message
    )
    if ($Expected -ne $Actual) {
        throw "ASSERT FAILED: $Message (expected='$Expected' actual='$Actual')"
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $ScriptBlock,
        [Parameter(Mandatory = $true)][string] $Message
    )
    $thrown = $false
    try { & $ScriptBlock } catch { $thrown = $true }
    Assert-True $thrown $Message
}

function New-TestSandbox {
    param([string] $Prefix = 'deploy-test')
    $path = Join-Path ([System.IO.Path]::GetTempPath()) "$Prefix-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

function Remove-TestSandbox {
    param([Parameter(Mandatory = $true)][string] $Path)
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Write-TestPass {
    param([Parameter(Mandatory = $true)][string] $Name)
    Write-Host "[PASS] $Name" -ForegroundColor Green
}

function Write-TestFail {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Message
    )
    Write-Host "[FAIL] $Name :: $Message" -ForegroundColor Red
}
