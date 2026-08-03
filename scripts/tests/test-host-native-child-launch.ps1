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

    Assert-True (@($prefix) -contains '-NoProfile') "$platform prefix must pass -NoProfile"

    # The real call shape: prefix + the script and its arguments.
    # Compose exactly the way every caller does.
    $argv = @($prefix) + @('-File', '/tmp/launcher.ps1', '-PythonExe', '/tmp/python')
    Assert-Equal (@($prefix).Count + 4) $argv.Count "$platform argv must keep every argument separate"
    Assert-True ($argv -contains '-File') "$platform argv must carry -File as its own element"
    # Fails on a scalar prefix ('-NoProfile-File' fused by string concatenation).
    Assert-True (-not ($argv | Where-Object { $_ -is [string] -and $_ -like '*-NoProfile-*' })) "$platform argv must not fuse -NoProfile into the next argument"
    # Fails on a `,@(...)` prefix: Start-Process needs string[], and a nested
    # Object[] element makes it throw "Cannot convert 'System.Object[]'".
    foreach ($a in $argv) {
        Assert-True ($a -is [string]) "$platform argv element '$a' must be a string, not a nested array (Start-Process -ArgumentList takes string[])"
    }

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

# The @() wrapper is a CALL-SITE property: a caller that forgets it gets a scalar
# on Linux and silently fuses '-NoProfile' into the next argument. No unit test of
# the function can see that, so pin it statically instead.
$callSites = @(
    'scripts/deploy.ps1',
    'scripts/lib/host-native-launcher.ps1'
)
$seen = 0
foreach ($rel in $callSites) {
    $full = Join-Path $repoRoot $rel
    $lines = Get-Content -LiteralPath $full
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        # skip the definition and any comment mentioning it
        if ($line -match 'function Get-HostNativePowerShellArgumentPrefix') { continue }
        if ($line -match '^\s*#') { continue }
        if ($line -notmatch 'Get-HostNativePowerShellArgumentPrefix') { continue }
        $seen++
        Assert-True ($line -match '@\(\s*Get-HostNativePowerShellArgumentPrefix') `
            "${rel}:$($i + 1) must wrap the prefix call in @() - without it the single-element Linux result unrolls to a string and fuses arguments. Line: $($line.Trim())"
    }
}
Assert-True ($seen -ge 3) "expected at least 3 prefix call sites to check, found $seen (did a call site move?)"
Write-Host "[PASS] all $seen prefix call sites wrap in @()"

Write-Host '=== test-host-native-child-launch.ps1: ALL PASSED ==='
