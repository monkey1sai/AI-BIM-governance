[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'status')][string] $Action = 'status',
    [string] $ChangeId,
    [string] $RunId,
    [string] $Offset = '0'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:IsolatedStackPolicy = [ordered]@{
    base = [ordered]@{ coordinator = 8005; governance = 49103; viewer = 5180 }
    reserved = @(8004, 49102, 49101, 8010, 5173, 5174, 49100) + @(49110..49150)
}

function Assert-SafeStackSegment {
    param([string] $Name, [string] $Value)
    $deviceName = if ([string]::IsNullOrEmpty($Value)) { '' } else { $Value.Split('.', 2)[0] }
    if ([string]::IsNullOrWhiteSpace($Value) -or
        $Value -in @('.', '..') -or
        $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
        $Value -match '[. ]$' -or
        $deviceName -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') {
        throw "$Name must be one safe path segment (1..64 chars: A-Z, a-z, 0-9, dot, underscore, dash)."
    }
}

function Resolve-IsolatedStackPorts {
    param([string] $OffsetInput)
    if ($OffsetInput -notmatch '^[0-4]$') {
        throw 'Offset must be one integer from 0 through 4.'
    }
    $resolvedOffset = [int]$OffsetInput
    $ports = [ordered]@{
        coordinator = $script:IsolatedStackPolicy.base.coordinator + $resolvedOffset
        governance = $script:IsolatedStackPolicy.base.governance + $resolvedOffset
        viewer = $script:IsolatedStackPolicy.base.viewer + $resolvedOffset
    }
    $resolved = [pscustomobject]$ports
    Assert-IsolatedPortSetDisjoint -Ports $resolved
    return $resolved
}

function Assert-IsolatedPortSetDisjoint {
    param($Ports)
    $conflicts = @(
        @($Ports.coordinator, $Ports.governance, $Ports.viewer) |
            Where-Object { $script:IsolatedStackPolicy.reserved -contains $_ }
    )
    if ($conflicts.Count -gt 0) {
        throw "Resolved ports intersect reserved ports: $($conflicts -join ',')."
    }
}

function Resolve-IsolatedStackManifestPath {
    param([string] $RepoRoot, [string] $ChangeId, [string] $RunId)
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    return Join-Path $RepoRoot "artifacts\e2e\$ChangeId\$RunId\stack-manifest.json"
}

function Assert-IsolatedStackStartPreflight {
    param(
        [string] $RepoRoot, [string] $ChangeId, [string] $RunId, [string] $OffsetInput,
        [scriptblock] $ListenerLookup = {
            param($port)
            Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
                Select-Object -First 1
        }
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $ports = Resolve-IsolatedStackPorts -OffsetInput $OffsetInput
    $manifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId
    if (Test-Path -LiteralPath $manifestPath) {
        throw "Manifest collision: $manifestPath"
    }
    foreach ($port in @($ports.coordinator, $ports.governance)) {
        $listener = & $ListenerLookup $port
        if ($null -ne $listener) {
            throw "Port $port is occupied; ownership is unknown. No process was stopped."
        }
    }
    [pscustomobject]@{ ports = $ports; manifest_path = $manifestPath; offset = [int]$OffsetInput }
}

if ($MyInvocation.InvocationName -ne '.') {
    throw 'Direct execution is unavailable until the Task 4 dispatcher is implemented. Dot-source this file only for tests.'
}
