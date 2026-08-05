# Shared helpers for emitting tiered demo-runtime smoke/readiness evidence.
#
# Tier statuses follow the demo-runtime-readiness-smoke capability:
#   passed | failed | blocked | deferred | not_observed
#
# Owners are the responsible repo / folder boundary, matching AGENTS.md.
#
# Usage:
#   . "$PSScriptRoot/lib/smoke-evidence.ps1"
#   $record  = New-SmokeEvidenceRecord -Command $MyInvocation.Line -Cwd (Get-Location).Path
#   Add-SmokeTier -Record $record -Tier 'streaming_internal_conversion' -Status 'blocked' -Owner 'bim-streaming-server' `
#                 -Blocker 'no dev IFC fixture under DEV_IFC_FIXTURE_ROOT' `
#                 -NextCommand 'Copy a real .ifc under storage/ then rerun' `
#                 -Ids @{ dev_storage_root = $root }
#   Save-SmokeEvidence -Record $record -Path $EvidencePath

Set-StrictMode -Version Latest

# Per-OS listener primitives. Guarded so this lib stays dot-sourceable standalone.
if (-not (Get-Command -Name 'Get-PlatformTcpListenerPid' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'platform/platform-adapter.ps1')
}
if (-not (Get-Command -Name 'Get-DeployTargetRegistry' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'deploy-target-registry.ps1')
}

$Script:SmokeTierStatuses = @('passed', 'failed', 'blocked', 'deferred', 'not_observed')
$Script:SmokeKnownOwners = @(
    'bim-review-coordinator',
    'bim-streaming-server',
    'web-viewer-sample',
    'tests/fakes',
    'scripts'
)

function Resolve-DevIfcFixtureRoot {
    [CmdletBinding()]
    param(
        [string] $Override
    )

    $candidate = $Override
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $candidate = $env:DEV_IFC_FIXTURE_ROOT
    }
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        # Legacy fallback for superseded worker smoke scripts.
        $candidate = $env:WORKER_DEV_STORAGE_ROOT
    }
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $candidate = 'C:\Repos\active\iot\AI-BIM-governance\storage'
    }

    if ([System.IO.Path]::IsPathRooted($candidate)) {
        return [System.IO.Path]::GetFullPath($candidate)
    }
    $base = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
    return [System.IO.Path]::GetFullPath((Join-Path $base $candidate))
}

function Resolve-WorkerDevStorageRoot {
    [CmdletBinding()]
    param(
        [string] $Override
    )

    return Resolve-DevIfcFixtureRoot -Override $Override
}

function Get-DevIfcFixtureSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Root
    )

    $exists = Test-Path -LiteralPath $Root
    $isDirectory = $exists -and (Test-Path -LiteralPath $Root -PathType Container)

    $fixtures = @()
    if ($isDirectory) {
        $fixtures = @(
            Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Extension -ieq '.ifc' } |
                ForEach-Object {
                    $separators = [char[]]"\/"
                    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd($separators)
                    $fileFull = [System.IO.Path]::GetFullPath($_.FullName)
                    if ($fileFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                        $relativePath = $fileFull.Substring($rootFull.Length).TrimStart($separators)
                    } else {
                        $relativePath = $_.Name
                    }
                    [pscustomobject]@{
                        filename      = $_.Name
                        relative_path = $relativePath.Replace('\', '/')
                        size_bytes    = [int64]$_.Length
                        modified_at   = $_.LastWriteTimeUtc.ToString('o')
                    }
                }
        )
    }

    [pscustomobject]@{
        root           = $Root
        exists         = [bool]$exists
        is_directory   = [bool]$isDirectory
        fixture_count  = [int]$fixtures.Count
        fixtures       = @($fixtures)
    }
}

function Get-WorkerDevFixtureSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Root
    )

    return Get-DevIfcFixtureSummary -Root $Root
}

function Get-KitLauncherPreflight {
    [CmdletBinding()]
    param(
        [string] $RepoRoot
    )

    if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
        $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
    }
    $platformKind = "$(Get-PlatformName)_host_native"
    $registry = Get-DeployTargetRegistry
    $descriptors = @($registry.targets | Where-Object { [string]$_.kind -eq $platformKind })
    if ($descriptors.Count -ne 1) {
        throw "smoke_evidence: expected exactly one public deploy descriptor for '$platformKind' (found $($descriptors.Count))."
    }
    $launch = Resolve-DeployTargetKitLaunch -Target $descriptors[0] -DeployRootOverride $RepoRoot
    $launcher = [string]$launch.LauncherPath
    $present = Test-Path -LiteralPath $launcher -PathType Leaf
    $rerun = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
    [pscustomobject]@{
        launcher_path     = $launcher
        launcher_present  = [bool]$present
        next_command      = if ($present) {
            "& '$rerun' -SkipAutoLoad -PreflightOnly"
        } else {
            "Run '$([string]$launch.BuildCommand)' in bim-streaming-server, then rerun '$rerun -PreflightOnly'"
        }
        preflight_script  = $rerun
        build_command     = [string]$launch.BuildCommand
    }
}

function Test-KitSignalingPortListening {
    [CmdletBinding()]
    param(
        [string] $BindAddress = '127.0.0.1',
        [int] $Port = 49100,
        [ValidateRange(1, 10000)][int] $ConnectTimeoutMs = 500,
        [scriptblock] $ListenerPidProbe = { param($candidatePort) Get-PlatformTcpListenerPid -Port $candidatePort }
    )

    # Windows-only cmdlet: off Windows this recorded "no listener" in the evidence
    # regardless of reality, which is worse than recording nothing.
    try {
        $owner = & $ListenerPidProbe $Port
        $hasListener = ($null -ne $owner)
    } catch {
        $hasListener = $false
    }

    $endpointReachable = $false
    if ($hasListener) {
        $client = [Net.Sockets.TcpClient]::new()
        $async = $null
        try {
            $async = $client.BeginConnect($BindAddress, $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne($ConnectTimeoutMs)) {
                $client.EndConnect($async)
                $endpointReachable = [bool]$client.Connected
            }
        } catch {
            $endpointReachable = $false
        } finally {
            if ($null -ne $async) { $async.AsyncWaitHandle.Close() }
            $client.Dispose()
        }
    }

    [pscustomobject]@{
        host       = $BindAddress
        port       = $Port
        listening  = [bool]$endpointReachable
    }
}

function New-SmokeEvidenceRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Command,
        [Parameter(Mandatory = $true)][string] $Cwd,
        [hashtable] $Context
    )

    $contextOrdered = [ordered]@{}
    if ($Context) {
        foreach ($key in $Context.Keys) { $contextOrdered[$key] = $Context[$key] }
    }
    $record = [ordered]@{
        schema_version = 'demo-runtime-readiness-smoke/v1'
        capability     = 'demo-runtime-readiness-smoke'
        emitted_at     = (Get-Date).ToUniversalTime().ToString('o')
        command        = $Command
        cwd            = $Cwd
        context        = $contextOrdered
        tiers          = New-Object System.Collections.Generic.List[object]
    }
    # Wrap in single-element array to prevent PowerShell from enumerating the OrderedDictionary
    # (returning it bare unrolls to DictionaryEntry items in the caller's scope).
    return ,$record
}

function Add-SmokeTier {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Record,
        [Parameter(Mandatory = $true)][string] $Tier,
        [Parameter(Mandatory = $true)][ValidateSet('passed', 'failed', 'blocked', 'deferred', 'not_observed')]
        [string] $Status,
        [Parameter(Mandatory = $true)][string] $Owner,
        [string] $Blocker = '',
        [string] $NextCommand = '',
        [hashtable] $Ids,
        [string[]] $EvidencePaths,
        [hashtable] $Detail
    )

    if ($Script:SmokeKnownOwners -notcontains $Owner) {
        Write-Verbose "Unknown smoke evidence owner '$Owner'; allowed values include $($Script:SmokeKnownOwners -join ', ')"
    }

    $idsOrdered = [ordered]@{}
    if ($Ids) {
        foreach ($key in $Ids.Keys) { $idsOrdered[$key] = $Ids[$key] }
    }
    $detailOrdered = [ordered]@{}
    if ($Detail) {
        foreach ($key in $Detail.Keys) { $detailOrdered[$key] = $Detail[$key] }
    }
    $entry = [ordered]@{
        tier           = $Tier
        status         = $Status
        owner          = $Owner
        ids            = $idsOrdered
        blocker        = $Blocker
        next_command   = $NextCommand
        evidence_paths = @($EvidencePaths)
        detail         = $detailOrdered
    }
    [void]$Record.tiers.Add($entry)
    # Prevent OrderedDictionary enumeration on return.
    return ,$entry
}

function Save-SmokeEvidence {
    # NOTE: skip [Parameter(Mandatory)] here and use explicit null checks.
    # Also avoid `Split-Path -LiteralPath -Parent` for the directory — under PowerShell 7's
    # advanced binding it can raise "Parameter set cannot be resolved" when invoked inside
    # a function with mixed-type params. .NET Path.GetDirectoryName is unambiguous.
    param(
        $Record,
        [string] $Path
    )
    if ($null -eq $Record) { throw 'Save-SmokeEvidence: -Record is required.' }
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Save-SmokeEvidence: -Path is required.' }

    $directory = [System.IO.Path]::GetDirectoryName($Path)
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $json = $Record | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
    return $Path
}

function Write-SmokeTierSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Record
    )
    foreach ($entry in $Record.tiers) {
        $blocker = if ([string]::IsNullOrWhiteSpace($entry.blocker)) { '' } else { " blocker=$($entry.blocker)" }
        Write-Host "[smoke] tier=$($entry.tier) status=$($entry.status) owner=$($entry.owner)$blocker"
    }
}
