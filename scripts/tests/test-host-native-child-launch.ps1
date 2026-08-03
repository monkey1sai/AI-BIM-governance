[CmdletBinding()]
param()

# Regression guard for the cross-platform child-process launch arguments.
#
# The Linux deploy died with "The argument '-NoProfile-File' is not recognized":
# off Windows the prefix is a SINGLE element, and PowerShell unrolls a
# single-element array on return, so the caller's `<prefix> + @('-File', ...)`
# degraded from array concatenation to STRING concatenation. On Windows the
# prefix has three elements and never unrolls, so the bug was invisible there -
# which is exactly why both branches are exercised here by injecting -Platform
# rather than trusting whichever OS happens to run the suite.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}
function Assert-Equal {
    param($Expected, $Actual, [Parameter(Mandatory = $true)][string] $Message)
    if ($Expected -ne $Actual) { throw "ASSERT FAILED: $Message (expected='$Expected' actual='$Actual')" }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repoRoot 'scripts/lib/host-native-launcher.ps1')

foreach ($platform in @('windows', 'linux')) {
    $prefix = Get-HostNativePowerShellArgumentPrefix -Platform $platform

    Assert-True ($prefix -is [array]) "$platform prefix must stay an array (a scalar turns the caller's + into string concatenation)"
    Assert-True ($prefix -contains '-NoProfile') "$platform prefix must pass -NoProfile"

    # The real call shape: prefix + the script and its arguments.
    $argv = @($prefix) + @('-File', '/tmp/launcher.ps1', '-PythonExe', '/tmp/python')
    Assert-Equal ($prefix.Count + 4) $argv.Count "$platform argv must keep every argument separate"
    Assert-True ($argv -contains '-File') "$platform argv must carry -File as its own element"
    Assert-True (-not ($argv | Where-Object { $_ -like '*-NoProfile-*' })) "$platform argv must not fuse -NoProfile into the next argument"

    Write-Host "[PASS] $platform child-launch arguments"
}

# -ExecutionPolicy is Windows-only; pwsh rejects it.
$win = Get-HostNativePowerShellArgumentPrefix -Platform 'windows'
$lin = Get-HostNativePowerShellArgumentPrefix -Platform 'linux'
Assert-True ($win -contains '-ExecutionPolicy') 'windows prefix must set -ExecutionPolicy'
Assert-True (-not ($lin -contains '-ExecutionPolicy')) 'non-windows prefix must NOT pass -ExecutionPolicy (pwsh rejects it)'
Write-Host '[PASS] -ExecutionPolicy is Windows-only'

Assert-Equal 'powershell.exe' (Get-HostNativePowerShellExe -Platform 'windows') 'windows PowerShell executable'
Assert-Equal 'pwsh' (Get-HostNativePowerShellExe -Platform 'linux') 'non-windows PowerShell executable'
Write-Host '[PASS] PowerShell executable per platform'

Write-Host '=== test-host-native-child-launch.ps1: ALL PASSED ==='
