[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'status')][string] $Action = 'status',
    [string] $ChangeId,
    [string] $RunId,
    [string] $Offset,
    [Alias('RepoRoot')][string] $CliRepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module -Force (Join-Path $PSScriptRoot '..\lib\StructLog.psm1')

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

function Get-IsolatedPortListener {
    param(
        [int] $Port,
        [scriptblock] $ConnectionLookup = { Get-NetTCPConnection -ErrorAction Stop }
    )
    $connections = @(& $ConnectionLookup)
    $listeners = @($connections | Where-Object { [int]$_.LocalPort -eq $Port -and [string]$_.State -eq 'Listen' })
    if ($listeners.Count -gt 1) { throw "Multiple listeners were found on isolated port $Port." }
    $listeners | Select-Object -First 1
}

function Assert-IsolatedStackStartPreflight {
    param(
        [string] $RepoRoot, [string] $ChangeId, [string] $RunId, [string] $OffsetInput,
        [scriptblock] $ListenerLookup = {
            param($port)
            Get-IsolatedPortListener -Port $port
        }
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $ports = Resolve-IsolatedStackPorts -OffsetInput $OffsetInput
    $manifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId
    if (Test-Path -LiteralPath $manifestPath) {
        throw "Manifest collision: $manifestPath"
    }
    foreach ($port in @($ports.coordinator, $ports.governance, $ports.viewer)) {
        $listener = & $ListenerLookup $port
        if ($null -ne $listener) {
            throw "Port $port is occupied; ownership is unknown. No process was stopped."
        }
    }
    [pscustomobject]@{ ports = $ports; manifest_path = $manifestPath; offset = [int]$OffsetInput }
}

function Assert-IsolatedCleanWorktree {
    param([string] $RepoRoot, [scriptblock] $StatusFn = { param($root) & git -C $root status --porcelain --untracked-files=all })
    $entries = @(& $StatusFn $RepoRoot | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($entries.Count -gt 0) {
        throw 'Isolated stack start requires a clean worktree; tracked or nonignored untracked changes are not allowed.'
    }
}

function ConvertTo-IsolatedWindowsArgumentLine {
    param([string[]] $Arguments)
    @($Arguments | ForEach-Object {
        $argument = [string]$_
        if ($argument -notmatch '[\s"]') { return $argument }
        '"' + ([regex]::Replace($argument, '(\\*)"', '$1$1\\"') -replace '(\\+)$', '$1$1') + '"'
    }) -join ' '
}

function Resolve-IsolatedStackReservation {
    param(
        [string] $RepoRoot, [string] $ChangeId, [string] $RunId, [int] $Offset,
        [string] $TrustedGitCommonDirectory,
        [scriptblock] $GitCommonDirectoryFn = {
            param($root)
            $value = & git -C $root rev-parse --git-common-dir
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($value -join ''))) {
                throw "Cannot resolve the shared Git directory for isolated stack reservations: $root"
            }
            $raw = ($value -join '').Trim()
            if ([IO.Path]::IsPathRooted($raw)) { return [IO.Path]::GetFullPath($raw) }
            [IO.Path]::GetFullPath((Join-Path $root $raw))
        }
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $RepoRoot = [IO.Path]::GetFullPath($RepoRoot)
    $runPath = Join-Path $RepoRoot "artifacts\e2e\$ChangeId\$RunId\.stack-reservation.json"
    $manifestPath = Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId
    $gitCommonDirectory = if ([string]::IsNullOrWhiteSpace($TrustedGitCommonDirectory)) {
        [string](& $GitCommonDirectoryFn $RepoRoot)
    } else {
        $TrustedGitCommonDirectory
    }
    if ([string]::IsNullOrWhiteSpace($gitCommonDirectory) -or -not [IO.Path]::IsPathRooted($gitCommonDirectory)) {
        throw 'Shared Git directory resolver must return an absolute path.'
    }
    $gitCommonDirectory = [IO.Path]::GetFullPath($gitCommonDirectory)
    $portPath = Join-Path $gitCommonDirectory "isolated-stack-reservations\offset-$Offset.reservation.json"
    [pscustomobject]@{
        repo_root=$RepoRoot; change_id=$ChangeId; run_id=$RunId; offset=$Offset
        manifest_path=$manifestPath
        ports=(Resolve-IsolatedStackPorts -OffsetInput ([string]$Offset))
        paths=@([IO.Path]::GetFullPath($runPath),[IO.Path]::GetFullPath($portPath))
        gate_path=[IO.Path]::GetFullPath((Join-Path $gitCommonDirectory 'isolated-stack-reservations\.transaction.lock'))
        _git_common_directory=$gitCommonDirectory
        _git_common_directory_fn=$GitCommonDirectoryFn
    }
}

function Enter-IsolatedStackReservationTransaction {
    param([string]$GatePath,[int]$TimeoutMilliseconds=5000)
    if ($TimeoutMilliseconds -lt 0) { throw 'Reservation transaction timeout must be non-negative.' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $GatePath) | Out-Null
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        try {
            return [IO.File]::Open($GatePath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        } catch [IO.IOException] {
            if ([DateTime]::UtcNow -ge $deadline) {
                throw "Timed out acquiring isolated stack reservation transaction gate: $GatePath"
            }
            Start-Sleep -Milliseconds 25
        }
    } while ($true)
}

function Get-IsolatedReservationLauncherIdentity {
    param([scriptblock]$ProcessLookup={param($processId) Get-Process -Id $processId -ErrorAction Stop})
    $process = & $ProcessLookup $PID
    if ($null -eq $process) { throw "Launcher process $PID is not running." }
    $processIdProperty = if ($process.PSObject.Properties['Id']) { $process.PSObject.Properties['Id'] } else { $process.PSObject.Properties['ProcessId'] }
    $creationProperty = if ($process.PSObject.Properties['StartTime']) { $process.PSObject.Properties['StartTime'] } else { $process.PSObject.Properties['CreationDate'] }
    if ($null -eq $processIdProperty -or $null -eq $creationProperty) { throw 'Launcher process identity is incomplete.' }
    [pscustomobject]@{
        pid=[int]$processIdProperty.Value
        creation_identity=(ConvertTo-IsolatedCreationIdentity $creationProperty.Value)
    }
}

function Test-IsolatedJsonInteger {
    param($Value,[long]$Minimum,[long]$Maximum)
    $isInteger = $Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64]
    if (-not $isInteger) { return $false }
    try {
        $integer = [long]$Value
        return $integer -ge $Minimum -and $integer -le $Maximum
    } catch {
        return $false
    }
}

function Test-IsolatedCanonicalUtcTimestamp {
    param($Value)
    if ($Value -isnot [string] -or $Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$') { return $false }
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        $Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal,
        [ref]$parsed
    )) { return $false }
    return $parsed.Offset -eq [TimeSpan]::Zero -and $parsed.UtcDateTime.ToString('o') -ceq $Value
}

function ConvertFrom-IsolatedReservationJson {
    param(
        [Parameter(Mandatory=$true)][string]$RawJson,
        [AllowNull()]$SupportsDateKind=$null
    )
    if ($null -eq $SupportsDateKind) {
        $convertFromJsonCommand = Get-Command ConvertFrom-Json -CommandType Cmdlet -ErrorAction Stop
        $SupportsDateKind = $convertFromJsonCommand.Parameters.ContainsKey('DateKind')
    }
    if ($SupportsDateKind -isnot [bool]) { throw 'ConvertFrom-Json DateKind capability must be Boolean.' }
    if ($SupportsDateKind) {
        return $RawJson | ConvertFrom-Json -Depth 12 -DateKind String
    }

    $record = $RawJson | ConvertFrom-Json -Depth 12
    $document = $null
    try {
        $document = [Text.Json.JsonDocument]::Parse($RawJson)
        $root = $document.RootElement
        if ($root.ValueKind -ne [Text.Json.JsonValueKind]::Object) {
            throw 'Reservation JSON root must be an object.'
        }
        foreach ($propertyName in @('owner_creation_identity','updated_at')) {
            $rawValue = [Text.Json.JsonElement]::new()
            if (-not $root.TryGetProperty($propertyName, [ref]$rawValue) -or
                $rawValue.ValueKind -ne [Text.Json.JsonValueKind]::String -or
                $null -eq $record.PSObject.Properties[$propertyName]) {
                throw "Reservation JSON property must be a string: $propertyName"
            }
            $record.PSObject.Properties[$propertyName].Value = $rawValue.GetString()
        }
    } finally {
        if ($null -ne $document) { $document.Dispose() }
    }
    return $record
}

function Read-IsolatedStackReservationRecord {
    param([string]$Path,[scriptblock]$GitCommonDirectoryFn,[string]$TrustedGitCommonDirectory)
    try {
        $rawRecord = Get-Content -Raw -LiteralPath $Path
        $record = ConvertFrom-IsolatedReservationJson -RawJson $rawRecord
    } catch {
        throw "Isolated stack reservation record is malformed and cannot be reclaimed: $Path"
    }
    $expectedProperties = @(
        'change_id','manifest_path','offset','owner','owner_creation_identity','owner_pid','ports',
        'repo_root','reservation_id','reservation_path','reservation_paths','run_id','schema_version','state','updated_at'
    ) | Sort-Object
    $actualProperties = @($record.PSObject.Properties.Name | Sort-Object)
    $expectedPortProperties = @('coordinator','governance','viewer')
    $actualPortProperties = if ($null -ne $record.PSObject.Properties['ports']) { @($record.ports.PSObject.Properties.Name | Sort-Object) } else { @() }
    if (($actualProperties -join '|') -cne ($expectedProperties -join '|') -or
        ($actualPortProperties -join '|') -cne ($expectedPortProperties -join '|')) {
        throw "Isolated stack reservation record schema is untrusted: $Path"
    }
    $stringProperties = @(
        'schema_version','owner','state','reservation_id','owner_creation_identity','repo_root','change_id',
        'run_id','manifest_path','reservation_path','updated_at'
    )
    $invalidValueFields = [Collections.Generic.List[string]]::new()
    foreach ($propertyName in $stringProperties) {
        if ($record.PSObject.Properties[$propertyName].Value -isnot [string]) { $invalidValueFields.Add($propertyName) }
    }
    if ($record.reservation_paths -isnot [Array] -or @($record.reservation_paths).Count -ne 2 -or
        @($record.reservation_paths | Where-Object { $_ -isnot [string] }).Count -gt 0) { $invalidValueFields.Add('reservation_paths') }
    if (-not (Test-IsolatedJsonInteger -Value $record.offset -Minimum 0 -Maximum 4)) { $invalidValueFields.Add('offset') }
    if (-not (Test-IsolatedJsonInteger -Value $record.owner_pid -Minimum 1 -Maximum ([int]::MaxValue))) { $invalidValueFields.Add('owner_pid') }
    foreach ($portName in @('coordinator','governance','viewer')) {
        if (-not (Test-IsolatedJsonInteger -Value $record.ports.$portName -Minimum 1 -Maximum 65535)) { $invalidValueFields.Add("ports.$portName") }
    }
    if (-not (Test-IsolatedCanonicalUtcTimestamp $record.owner_creation_identity)) { $invalidValueFields.Add('owner_creation_identity') }
    if (-not (Test-IsolatedCanonicalUtcTimestamp $record.updated_at)) { $invalidValueFields.Add('updated_at') }
    if ($invalidValueFields.Count -gt 0) {
        throw "Isolated stack reservation record values are untrusted ($($invalidValueFields -join ', ')): $Path"
    }
    $recordResolveParameters = @{
        RepoRoot=[string]$record.repo_root; ChangeId=[string]$record.change_id; RunId=[string]$record.run_id; Offset=[int]$record.offset
    }
    if (-not [string]::IsNullOrWhiteSpace($TrustedGitCommonDirectory)) {
        $recordRepoRoot = [IO.Path]::GetFullPath([string]$record.repo_root)
        if (Test-Path -LiteralPath $recordRepoRoot) {
            if (-not (Test-Path -LiteralPath $recordRepoRoot -PathType Container)) {
                throw "Isolated stack reservation repo root is not a directory: $Path"
            }
            if ($null -ne $GitCommonDirectoryFn) { $recordResolveParameters.GitCommonDirectoryFn = $GitCommonDirectoryFn }
        } else {
            $recordResolveParameters.TrustedGitCommonDirectory = $TrustedGitCommonDirectory
        }
    } elseif ($null -ne $GitCommonDirectoryFn) {
        $recordResolveParameters.GitCommonDirectoryFn = $GitCommonDirectoryFn
    }
    try { $recordResolution = Resolve-IsolatedStackReservation @recordResolveParameters } catch {
        throw "Isolated stack reservation tuple cannot be resolved safely: $Path"
    }
    if (-not [string]::IsNullOrWhiteSpace($TrustedGitCommonDirectory) -and
        -not [string]::Equals(
            [IO.Path]::GetFullPath([string]$recordResolution._git_common_directory),
            [IO.Path]::GetFullPath($TrustedGitCommonDirectory),
            [StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Isolated stack reservation belongs to a different Git common directory: $Path"
    }
    $reservationGuid = [Guid]::Empty
    $recordPaths = @($record.reservation_paths)
    $expectedPaths = @($recordResolution.paths)
    $pathsMatch = $recordPaths.Count -eq $expectedPaths.Count
    if ($pathsMatch) {
        for ($index=0; $index -lt $expectedPaths.Count; $index++) {
            if (-not [string]::Equals([IO.Path]::GetFullPath([string]$recordPaths[$index]),[IO.Path]::GetFullPath([string]$expectedPaths[$index]),[StringComparison]::OrdinalIgnoreCase)) {
                $pathsMatch = $false
                break
            }
        }
    }
    if ([string]$record.schema_version -cne 'isolated-stack-reservation/v1' -or
        [string]$record.owner -cne 'isolated-branch-stack' -or
        -not [Guid]::TryParseExact([string]$record.reservation_id,'D',[ref]$reservationGuid) -or
        @('active','recovery') -cnotcontains [string]$record.state -or
        -not [string]::Equals([IO.Path]::GetFullPath([string]$record.repo_root),[string]$recordResolution.repo_root,[StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([IO.Path]::GetFullPath([string]$record.manifest_path),[string]$recordResolution.manifest_path,[StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([IO.Path]::GetFullPath([string]$record.reservation_path),[IO.Path]::GetFullPath($Path),[StringComparison]::OrdinalIgnoreCase) -or
        -not $pathsMatch -or
        [int]$record.ports.coordinator -ne [int]$recordResolution.ports.coordinator -or
        [int]$record.ports.governance -ne [int]$recordResolution.ports.governance -or
        [int]$record.ports.viewer -ne [int]$recordResolution.ports.viewer -or
        [int]$record.owner_pid -le 0 -or
        [string]::IsNullOrWhiteSpace([string]$record.owner_creation_identity)) {
        throw "Isolated stack reservation record identity is untrusted: $Path"
    }
    $record | Add-Member -Force -NotePropertyName _resolution -NotePropertyValue $recordResolution
    return $record
}

function Test-IsolatedStackReservationResolutionMatch {
    param($Left,$Right)
    if ($null -eq $Left -or $null -eq $Right) { return $false }
    if (-not [string]::Equals([string]$Left.repo_root,[string]$Right.repo_root,[StringComparison]::OrdinalIgnoreCase) -or
        [string]$Left.change_id -cne [string]$Right.change_id -or
        [string]$Left.run_id -cne [string]$Right.run_id -or
        [int]$Left.offset -ne [int]$Right.offset -or
        -not [string]::Equals([string]$Left.manifest_path,[string]$Right.manifest_path,[StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([string]$Left.gate_path,[string]$Right.gate_path,[StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }
    $leftPaths = @($Left.paths)
    $rightPaths = @($Right.paths)
    if ($leftPaths.Count -ne $rightPaths.Count) { return $false }
    for ($index=0; $index -lt $leftPaths.Count; $index++) {
        if (-not [string]::Equals([string]$leftPaths[$index],[string]$rightPaths[$index],[StringComparison]::OrdinalIgnoreCase)) { return $false }
    }
    return $true
}

function Test-IsolatedReservationLauncherActive {
    param($Record,[scriptblock]$ProcessLookup={param($processId) Get-Process -Id $processId -ErrorAction SilentlyContinue})
    $process = & $ProcessLookup ([int]$Record.owner_pid)
    if ($null -eq $process) { return $false }
    $processIdProperty = if ($process.PSObject.Properties['Id']) { $process.PSObject.Properties['Id'] } else { $process.PSObject.Properties['ProcessId'] }
    $creationProperty = if ($process.PSObject.Properties['StartTime']) { $process.PSObject.Properties['StartTime'] } else { $process.PSObject.Properties['CreationDate'] }
    if ($null -eq $processIdProperty -or $null -eq $creationProperty) { throw 'Reservation owner process identity lookup was incomplete.' }
    [int]$processIdProperty.Value -eq [int]$Record.owner_pid -and
        (ConvertTo-IsolatedCreationIdentity $creationProperty.Value) -ceq (ConvertTo-IsolatedCreationIdentity $Record.owner_creation_identity)
}

function Test-IsolatedStackBackendProcessCandidate {
    param($Resolution,$Process)
    if ($null -eq $Process -or $null -eq $Process.PSObject.Properties['CommandLine']) { return $false }
    $commandLine = [string]$Process.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine)) { return $false }
    $candidates = @(
        [pscustomobject]@{
            entrypoint=(Join-Path $Resolution.repo_root 'governance-service')
            marker='--port'; port=[int]$Resolution.ports.governance
        },
        [pscustomobject]@{
            entrypoint=(Join-Path $Resolution.repo_root 'bim-review-coordinator\src\index.ts')
            marker='--isolated-stack-port'; port=[int]$Resolution.ports.coordinator
        }
    )
    foreach ($candidate in $candidates) {
        $portPattern = "(?:^|\s)$([regex]::Escape($candidate.marker))\s+$($candidate.port)(?:\s|`"|$)"
        if ($commandLine.Contains([string]$candidate.entrypoint,[StringComparison]::OrdinalIgnoreCase) -and
            $commandLine -match $portPattern) {
            return $true
        }
    }
    return $false
}

function Test-IsolatedStackReservationReclaimable {
    param(
        $Resolution,$Record,
        [scriptblock]$ListenerLookup={param($port) Get-IsolatedPortListener -Port $port},
        [scriptblock]$BackendProcessInventoryLookup={Get-CimInstance Win32_Process -ErrorAction Stop}
    )
    if (Test-Path -LiteralPath $Resolution.manifest_path -PathType Leaf) {
        try {
            $manifest = Read-IsolatedStackManifest -Path $Resolution.manifest_path
            Assert-IsolatedStackManifestIdentity -Manifest $manifest -RepoRoot $Resolution.repo_root -ChangeId $Resolution.change_id `
                -RunId $Resolution.run_id -OffsetInput ([string]$Resolution.offset)
        } catch {
            throw "Matching stack manifest is invalid; reservation remains held: $($Resolution.manifest_path)"
        }
        $manifestReservationId = $manifest.PSObject.Properties['reservation_id']
        if ($null -eq $manifestReservationId -or [string]$manifestReservationId.Value -cne [string]$Record.reservation_id) {
            throw 'Stack manifest reservation identity does not match the reservation records.'
        }
        $reservationHeld = $manifest.PSObject.Properties['reservation_held']
        if ($null -ne $reservationHeld -and [bool]$reservationHeld.Value) { return $false }
        return $true
    }
    foreach ($port in @([int]$Resolution.ports.coordinator,[int]$Resolution.ports.governance)) {
        $listeners = @(& $ListenerLookup $port | Where-Object { $null -ne $_ })
        if ($listeners.Count -gt 0) { return $false }
    }
    $backendCandidates = @(& $BackendProcessInventoryLookup | Where-Object {
        Test-IsolatedStackBackendProcessCandidate -Resolution $Resolution -Process $_
    })
    if ($backendCandidates.Count -gt 0) { return $false }
    foreach ($port in @([int]$Resolution.ports.coordinator,[int]$Resolution.ports.governance)) {
        $listeners = @(& $ListenerLookup $port | Where-Object { $null -ne $_ })
        if ($listeners.Count -gt 0) { return $false }
    }
    return $true
}

function Write-IsolatedStackReservationRecordAtomic {
    param([string]$Path,$Value)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory ".stack-reservation.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
        [IO.File]::Move($temporary,$Path,$false)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function New-IsolatedStackReservationRecord {
    param($Resolution,[string]$Path,[string]$ReservationId,$OwnerIdentity,[ValidateSet('active','recovery')][string]$State='active')
    [ordered]@{
        schema_version='isolated-stack-reservation/v1'; owner='isolated-branch-stack'; state=$State
        reservation_id=$ReservationId; owner_pid=[int]$OwnerIdentity.pid
        owner_creation_identity=(ConvertTo-IsolatedCreationIdentity $OwnerIdentity.creation_identity)
        repo_root=$Resolution.repo_root; change_id=$Resolution.change_id; run_id=$Resolution.run_id
        offset=$Resolution.offset; ports=$Resolution.ports; manifest_path=$Resolution.manifest_path
        reservation_paths=@($Resolution.paths); reservation_path=$Path; updated_at=[DateTime]::UtcNow.ToString('o')
    }
}

function Set-IsolatedStackReservationRecoveryHeld {
    param($Reservation)
    $reservationIdProperty = $Reservation.PSObject.Properties['reservation_id']
    $ownerPidProperty = $Reservation.PSObject.Properties['owner_pid']
    $ownerCreationProperty = $Reservation.PSObject.Properties['owner_creation_identity']
    if ($null -eq $reservationIdProperty -or $null -eq $ownerPidProperty -or $null -eq $ownerCreationProperty) {
        throw 'Cannot persist recovery-held state without the exact reservation owner identity.'
    }
    $ownerIdentity = [pscustomobject]@{pid=[int]$ownerPidProperty.Value;creation_identity=[string]$ownerCreationProperty.Value}
    $gate = Enter-IsolatedStackReservationTransaction -GatePath $Reservation.gate_path
    try {
        foreach ($path in @($Reservation.paths)) {
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $record = Read-IsolatedStackReservationRecord -Path $path -GitCommonDirectoryFn $Reservation._git_common_directory_fn `
                    -TrustedGitCommonDirectory $Reservation._git_common_directory
                if (-not (Test-IsolatedStackReservationResolutionMatch -Left $record._resolution -Right $Reservation) -or
                    [string]$record.reservation_id -cne [string]$reservationIdProperty.Value) {
                    throw "Reservation identity changed before recovery persistence; no record was changed: $path"
                }
            }
        }
        foreach ($path in @($Reservation.paths)) {
            $record = New-IsolatedStackReservationRecord -Resolution $Reservation -Path $path `
                -ReservationId ([string]$reservationIdProperty.Value) -OwnerIdentity $ownerIdentity -State recovery
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                Write-IsolatedJsonAtomic -Path $path -Value $record
            } else {
                Write-IsolatedStackReservationRecordAtomic -Path $path -Value $record
            }
        }
    } finally {
        $gate.Dispose()
    }
}

function Acquire-IsolatedStackReservations {
    param(
        [string] $RepoRoot, [string] $ChangeId, [string] $RunId, [int] $Offset,
        [scriptblock] $GitCommonDirectoryFn,
        [scriptblock] $OwnerIdentityFn={Get-IsolatedReservationLauncherIdentity},
        [scriptblock] $ProcessLookup={param($processId) Get-Process -Id $processId -ErrorAction SilentlyContinue},
        [scriptblock] $ListenerLookup={param($port) Get-IsolatedPortListener -Port $port},
        [scriptblock] $BackendProcessInventoryLookup={Get-CimInstance Win32_Process -ErrorAction Stop}
    )
    $resolveParameters = @{ RepoRoot=$RepoRoot; ChangeId=$ChangeId; RunId=$RunId; Offset=$Offset }
    if ($null -ne $GitCommonDirectoryFn) { $resolveParameters.GitCommonDirectoryFn = $GitCommonDirectoryFn }
    $reservation = Resolve-IsolatedStackReservation @resolveParameters
    $reservationId = [Guid]::NewGuid().ToString('D')
    $ownerIdentity = & $OwnerIdentityFn
    if ($null -eq $ownerIdentity -or [int]$ownerIdentity.pid -le 0 -or [string]::IsNullOrWhiteSpace([string]$ownerIdentity.creation_identity)) {
        throw 'Current launcher reservation identity is incomplete.'
    }
    $created = [System.Collections.Generic.List[string]]::new()
    $gate = Enter-IsolatedStackReservationTransaction -GatePath $reservation.gate_path
    try {
        $existing = [System.Collections.Generic.List[object]]::new()
        $pendingPaths = [Collections.Generic.Queue[string]]::new()
        $seenPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($path in @($reservation.paths)) { if ($seenPaths.Add($path)) { $pendingPaths.Enqueue($path) } }
        while ($pendingPaths.Count -gt 0) {
            $path = $pendingPaths.Dequeue()
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $record = Read-IsolatedStackReservationRecord -Path $path -GitCommonDirectoryFn $reservation._git_common_directory_fn `
                    -TrustedGitCommonDirectory $reservation._git_common_directory
                $existing.Add($record)
                foreach ($relatedPath in @($record._resolution.paths)) {
                    if ($seenPaths.Add($relatedPath)) { $pendingPaths.Enqueue($relatedPath) }
                }
            }
        }
        if ($existing.Count -gt 0) {
            $existingIds = @($existing | ForEach-Object { [string]$_.reservation_id } | Sort-Object -Unique)
            $existingOwners = @($existing | ForEach-Object { "$($_.owner_pid)|$($_.owner_creation_identity)" } | Sort-Object -Unique)
            $existingTuples = @($existing | ForEach-Object {
                "$($_._resolution.repo_root)|$($_._resolution.change_id)|$($_._resolution.run_id)|$($_._resolution.offset)|$($_._resolution.manifest_path)"
            } | Sort-Object -Unique)
            if ($existingIds.Count -ne 1 -or $existingOwners.Count -ne 1 -or $existingTuples.Count -ne 1) {
                throw 'Isolated stack reservation records disagree; no record was changed.'
            }
            if (@($existing | Where-Object { [string]$_.state -ceq 'recovery' }).Count -gt 0) {
                throw 'Recovery-held reservation cannot be auto-reclaimed.'
            }
            $representative = $existing[0]
            if (Test-IsolatedReservationLauncherActive -Record $representative -ProcessLookup $ProcessLookup) {
                throw "Isolated stack reservation is already held: $($representative._resolution.paths -join ', ')"
            }
            if (-not (Test-IsolatedStackReservationReclaimable -Resolution $representative._resolution -Record $representative `
                -ListenerLookup $ListenerLookup -BackendProcessInventoryLookup $BackendProcessInventoryLookup)) {
                throw 'Stale reservation could not be proven safe to reclaim; no process or record was changed.'
            }
            $provenStalePaths = @($existing | ForEach-Object { [string]$_.reservation_path } | Sort-Object -Unique)
            foreach ($path in $provenStalePaths) {
                if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
                if (Test-Path -LiteralPath $path) { throw "Failed to remove proven-stale reservation record: $path" }
            }
        }
        foreach ($path in @($reservation.paths)) {
            $record = New-IsolatedStackReservationRecord -Resolution $reservation -Path $path -ReservationId $reservationId -OwnerIdentity $ownerIdentity
            Write-IsolatedStackReservationRecordAtomic -Path $path -Value $record
            $created.Add($path)
        }
        $reservation | Add-Member -Force -NotePropertyName reservation_id -NotePropertyValue $reservationId
        $reservation | Add-Member -Force -NotePropertyName owner_pid -NotePropertyValue ([int]$ownerIdentity.pid)
        $reservation | Add-Member -Force -NotePropertyName owner_creation_identity -NotePropertyValue (ConvertTo-IsolatedCreationIdentity $ownerIdentity.creation_identity)
        return $reservation
    } catch {
        foreach ($path in @($created)) {
            try {
                $record = Read-IsolatedStackReservationRecord -Path $path -GitCommonDirectoryFn $reservation._git_common_directory_fn `
                    -TrustedGitCommonDirectory $reservation._git_common_directory
                if (Test-IsolatedStackReservationResolutionMatch -Left $record._resolution -Right $reservation) {
                    if ([string]$record.reservation_id -ceq $reservationId) { Remove-Item -LiteralPath $path -Force }
                }
            } catch {}
        }
        throw
    } finally {
        $gate.Dispose()
    }
}

function Release-IsolatedStackReservations {
    param($Reservation)
    if ($null -eq $Reservation) { return }
    $reservationIdProperty = $Reservation.PSObject.Properties['reservation_id']
    if ($null -eq $reservationIdProperty -or [string]::IsNullOrWhiteSpace([string]$reservationIdProperty.Value)) {
        throw 'Reservation release requires the exact reservation_id token.'
    }
    $gate = Enter-IsolatedStackReservationTransaction -GatePath $Reservation.gate_path
    try {
        $records = [System.Collections.Generic.List[object]]::new()
        foreach ($path in @($Reservation.paths)) {
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $record = Read-IsolatedStackReservationRecord -Path $path -GitCommonDirectoryFn $Reservation._git_common_directory_fn `
                    -TrustedGitCommonDirectory $Reservation._git_common_directory
                if (-not (Test-IsolatedStackReservationResolutionMatch -Left $record._resolution -Right $Reservation) -or
                    [string]$record.reservation_id -cne [string]$reservationIdProperty.Value) {
                    throw "Reservation identity changed before release; no record was removed: $path"
                }
                $records.Add([pscustomobject]@{path=$path;record=$record})
            }
        }
        foreach ($entry in @($records)) { Remove-Item -LiteralPath $entry.path -Force }
        foreach ($path in @($Reservation.paths)) {
            if (Test-Path -LiteralPath $path) { throw "Failed to release isolated stack reservation: $path" }
        }
    } finally {
        $gate.Dispose()
    }
}

function Resolve-IsolatedRuntime {
    param([string] $RepoRoot)
    $pythonCandidates = @(
        (Join-Path $RepoRoot 'governance-service\.venv\Scripts\python.exe'),
        (Join-Path $RepoRoot '.venv\Scripts\python.exe'),
        'C:\Program Files\Python312\python.exe'
    )
    $pythonExe = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $pythonExe) { throw 'No supported host Python was found.' }
    $nodeExe = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    $tsxCli = Join-Path $RepoRoot 'bim-review-coordinator\node_modules\tsx\dist\cli.mjs'
    if (-not (Test-Path -LiteralPath $tsxCli -PathType Leaf)) { throw "Missing current-worktree tsx CLI: $tsxCli" }
    [pscustomobject]@{ python = $pythonExe; node = $nodeExe; tsx = $tsxCli }
}

function Resolve-IsolatedStackStateLayout {
    param([string] $RepoRoot, [string] $RunDirectory)
    $fixtureRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'storage'))
    $stateRoot = [IO.Path]::GetFullPath((Join-Path $RunDirectory 'state'))
    $governanceRoot = Join-Path $stateRoot 'governance'
    $coordinatorRoot = Join-Path $stateRoot 'coordinator'
    [pscustomobject]@{
        fixture_root = $fixtureRoot
        state_root = $stateRoot
        governance_root = $governanceRoot
        governance_db = Join-Path $governanceRoot 'governance.db'
        governance_federation_out = Join-Path $governanceRoot 'federated'
        coordinator_root = $coordinatorRoot
    }
}

function New-IsolatedBackendEnvironment {
    param(
        [ValidateSet('governance','coordinator')][string] $Role,
        $StateLayout,
        $Ports
    )
    if ($Role -eq 'governance') {
        return @{
            GOV_PORT = "$($Ports.governance)"
            GOV_DB_PATH = [string]$StateLayout.governance_db
            GOV_FED_OUT = [string]$StateLayout.governance_federation_out
            BIM_FILE_LIBRARY_ROOT = [string]$StateLayout.fixture_root
            RUNTIME_STORAGE_ROOT = [string]$StateLayout.fixture_root
            LOG_ROOT = (Join-Path $StateLayout.governance_root 'logs')
        }
    }

    $coordinatorRoot = [string]$StateLayout.coordinator_root
    $fixtureArtifacts = Join-Path $StateLayout.fixture_root 'artifacts'
    $coordinatorStorage = Join-Path $coordinatorRoot 'storage'
    @{
        PORT = "$($Ports.coordinator)"
        HOST = '127.0.0.1'
        GOVERNANCE_API_BASE = "http://127.0.0.1:$($Ports.governance)"
        COORDINATOR_PUBLIC_BASE_URL = "http://127.0.0.1:$($Ports.coordinator)"
        VIEWER_PUBLIC_BASE_URL = "http://127.0.0.1:$($Ports.viewer)"
        CORS_ORIGINS = "http://127.0.0.1:$($Ports.viewer)"
        SESSION_STORE_DIR = (Join-Path $coordinatorRoot 'sessions')
        EVENT_LOG_DIR = (Join-Path $coordinatorRoot 'events')
        CALLBACK_OUTBOX_STORE_PATH = (Join-Path $coordinatorRoot 'callback-outbox.json')
        CONVERSION_LEDGER_STORE_PATH = (Join-Path $coordinatorRoot 'conversion-ledger.json')
        ARTIFACT_HEALTH_LEDGER_STORE_PATH = (Join-Path $coordinatorRoot 'artifact-health-ledger.json')
        EXTERNAL_IFC_READY_STORE_PATH = (Join-Path $coordinatorRoot 'external-ifc-ready.json')
        STORAGE_ROOT = $coordinatorStorage
        STORAGE_HOST_ROOT = $coordinatorStorage
        RUNTIME_STORAGE_ROOT = $coordinatorStorage
        EDGE_RUNTIME_DATA_ROOT = (Join-Path $coordinatorRoot 'edge-runtime')
        A4_CONVERSION_ARTIFACTS_ROOT = $fixtureArtifacts
        A4_CONVERSION_ARTIFACTS_HOST_ROOT = $fixtureArtifacts
        LOG_ROOT = (Join-Path $coordinatorRoot 'logs')
        MINIO_WATCH_ENABLED = 'false'
    }
}

function ConvertTo-IsolatedCreationIdentity {
    param($CreationDate)
    if ($CreationDate -is [DateTimeOffset]) {
        return $CreationDate.UtcDateTime.ToString('o')
    }
    if ($CreationDate -is [datetime]) {
        return $CreationDate.ToUniversalTime().ToString('o')
    }
    $value = [string]$CreationDate
    if ($value -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$') {
        $parsed = [DateTimeOffset]::MinValue
        if ([DateTimeOffset]::TryParse(
            $value,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AllowWhiteSpaces,
            [ref]$parsed
        )) {
            return $parsed.UtcDateTime.ToString('o')
        }
    }
    return $value
}

function Get-IsolatedProcessIdentity {
    param(
        [int] $ProcessId,
        [string] $Entrypoint,
        [scriptblock] $ProcessLookup = { param($id) Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop }
    )
    $process = & $ProcessLookup $ProcessId
    if ($null -eq $process) { throw "Process $ProcessId is not running." }
    $commandLine = [string]$process.CommandLine
    if (-not $commandLine.Contains($Entrypoint, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Process $ProcessId command line does not contain exact entrypoint $Entrypoint."
    }
    [pscustomobject]@{
        pid = [int]$process.ProcessId
        entrypoint = $Entrypoint
        command_line = $commandLine
        creation_identity = ConvertTo-IsolatedCreationIdentity $process.CreationDate
        executable_path = [string]$process.ExecutablePath
    }
}

function New-IsolatedStackLifecycleData {
    param(
        [string]$StructRunId,
        [string]$ChangeId,
        [string]$StackRunId,
        [ValidateSet('start','status','stop','rollback')][string]$Action,
        [ValidateSet('start','active','closing','closed')][string]$Phase,
        [string]$Status
    )
    $data = @{
        phase = $Phase
        subject_kind = 'script_run'
        subject_id = $StructRunId
        change_id = $ChangeId
        stack_run_id = $StackRunId
        action = $Action
    }
    if (-not [string]::IsNullOrWhiteSpace($Status)) { $data.status = $Status }
    return $data
}

function Test-IsolatedProcessOwnership {
    param($Expected, $Actual)
    $null -ne $Actual `
      -and [int]$Expected.pid -eq [int]$Actual.pid `
      -and [string]$Expected.entrypoint -ceq [string]$Actual.entrypoint `
      -and [string]$Expected.command_line -ceq [string]$Actual.command_line `
      -and (ConvertTo-IsolatedCreationIdentity $Expected.creation_identity) -ceq (ConvertTo-IsolatedCreationIdentity $Actual.creation_identity)
}

function Test-IsolatedListenerProcessOwnership {
    param(
        $Expected,
        [int] $ListenerProcessId,
        [int] $Port,
        [scriptblock] $ProcessLookup = { param($processId) Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop },
        [int] $MaxDepth = 16
    )
    if ($ListenerProcessId -le 0 -or $Port -le 0 -or $MaxDepth -lt 1) { return $false }

    $entrypoint = [string]$Expected.entrypoint
    $portMarker = if ([string]$Expected.role -eq 'governance') { '--port' } else { '--isolated-stack-port' }
    if ([string]::IsNullOrWhiteSpace($entrypoint)) { return $false }

    $expectedCreationIdentity = ConvertTo-IsolatedCreationIdentity $Expected.creation_identity
    $expectedCreationInstant = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        $expectedCreationIdentity,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AllowWhiteSpaces,
        [ref]$expectedCreationInstant
    )) { return $false }

    $visited = [Collections.Generic.HashSet[int]]::new()
    $currentProcessId = $ListenerProcessId
    $descendantCreationInstant = $null
    for ($depth = 0; $depth -lt $MaxDepth; $depth++) {
        if (-not $visited.Add($currentProcessId)) { return $false }
        try {
            $snapshots = @(& $ProcessLookup $currentProcessId | Where-Object { $null -ne $_ })
        } catch {
            return $false
        }
        if ($snapshots.Count -ne 1 -or [int]$snapshots[0].ProcessId -ne $currentProcessId) { return $false }
        $snapshot = $snapshots[0]
        $creationIdentity = ConvertTo-IsolatedCreationIdentity $snapshot.CreationDate
        $creationInstant = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse(
            $creationIdentity,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AllowWhiteSpaces,
            [ref]$creationInstant
        ) -or $creationInstant -lt $expectedCreationInstant) { return $false }
        if ($null -ne $descendantCreationInstant -and $creationInstant -gt $descendantCreationInstant) { return $false }
        $descendantCreationInstant = $creationInstant

        if ($depth -eq 0) {
            $listenerCommandLine = [string]$snapshot.CommandLine
            if (-not $listenerCommandLine.Contains($entrypoint, [StringComparison]::OrdinalIgnoreCase) -or
                $listenerCommandLine -notmatch "(?:^|\s)$([regex]::Escape($portMarker))\s+$Port(?:\s|$)") {
                return $false
            }
        }
        if ($currentProcessId -eq [int]$Expected.pid) {
            return $creationIdentity -ceq $expectedCreationIdentity
        }
        $parentProcessId = [int]$snapshot.ParentProcessId
        if ($parentProcessId -le 0) { return $false }
        $currentProcessId = $parentProcessId
    }
    return $false
}

function Start-IsolatedBackend {
    param(
        [ValidateSet('governance','coordinator')][string] $Role,
        [string] $WorkingDirectory, [string] $Executable,
        [string[]] $Arguments, [hashtable] $Environment, [string] $RunDirectory,
        [string] $Entrypoint,
        [scriptblock] $StartProcessFn = {
            param($exe,$argumentList,$cwd,$envMap,$stdout,$stderr,$role,$entrypoint,$expectedPortMarker,$expectedPort)
            $wrapperPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\lib\start-child-with-environment.ps1'))
            $payloadJson = [ordered]@{ environment=$envMap; arguments=@($argumentList) } | ConvertTo-Json -Compress -Depth 8
            $payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payloadJson))
            $markerBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$expectedPortMarker))
            $wrapperArguments = @(
                '-NoProfile','-NonInteractive','-File',$wrapperPath,
                '-Executable',$exe,'-PayloadBase64',$payloadBase64,'-EntrypointMarker',$entrypoint,
                '-Role',$role,'-ExpectedPortMarkerBase64',$markerBase64,'-ExpectedPort',$expectedPort,
                '-BindingMarker',"isolated-$role-port-$expectedPort $expectedPortMarker $expectedPort"
            )
            $pwsh = (Get-Command pwsh -CommandType Application -ErrorAction Stop).Source
            Start-Process -FilePath $pwsh -ArgumentList (ConvertTo-IsolatedWindowsArgumentLine -Arguments $wrapperArguments) -WorkingDirectory $cwd `
              -WindowStyle Hidden -PassThru `
              -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        },
        [scriptblock] $IdentityLookup = { param($processId,$entry) Get-IsolatedProcessIdentity -ProcessId $processId -Entrypoint $entry },
        [scriptblock] $StopSpawnedProcessFn = {
            param($spawnedProcess)
            if ($null -ne $spawnedProcess -and -not $spawnedProcess.HasExited) {
                $spawnedProcess.Kill($true)
                $spawnedProcess.WaitForExit()
            }
        }
    )

    $roleBinding = if ($Role -eq 'governance') {
        [pscustomobject]@{ marker='--port'; forbidden_marker='--isolated-stack-port'; environment_key='GOV_PORT' }
    } else {
        [pscustomobject]@{ marker='--isolated-stack-port'; forbidden_marker='--port'; environment_key='PORT' }
    }
    $argumentList = [string[]]@($Arguments)
    $markerIndexes = @(
        for ($index = 0; $index -lt $argumentList.Count; $index++) {
            if ($argumentList[$index] -ceq [string]$roleBinding.marker) { $index }
        }
    )
    $forbiddenMarkerCount = @($argumentList | Where-Object { $_ -ceq [string]$roleBinding.forbidden_marker }).Count
    if ($markerIndexes.Count -ne 1 -or $forbiddenMarkerCount -ne 0) {
        throw "Isolated $Role arguments must contain exactly one '$($roleBinding.marker)' marker and no '$($roleBinding.forbidden_marker)' marker."
    }
    $portIndex = [int]$markerIndexes[0]
    if ($portIndex + 1 -ge $argumentList.Count) {
        throw "Isolated $Role arguments are missing the port value after '$($roleBinding.marker)'."
    }
    $expectedPort = 0
    if (-not [int]::TryParse($argumentList[$portIndex + 1], [ref]$expectedPort) -or $expectedPort -lt 1 -or $expectedPort -gt 65535) {
        throw "Isolated $Role arguments contain an invalid backend port."
    }
    $environmentKey = [string]$roleBinding.environment_key
    if (-not $Environment.ContainsKey($environmentKey)) {
        throw "Isolated $Role environment is missing '$environmentKey'."
    }
    $environmentPort = 0
    if (-not [int]::TryParse([string]$Environment[$environmentKey], [ref]$environmentPort) -or $environmentPort -ne $expectedPort) {
        throw "Isolated $Role argument port must match environment '$environmentKey'."
    }
    $expectedPortMarker = [string]$roleBinding.marker

    New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null
    $stdout = Join-Path $RunDirectory "$Role.stdout.log"
    $stderr = Join-Path $RunDirectory "$Role.stderr.log"
    $process = & $StartProcessFn $Executable $argumentList $WorkingDirectory $Environment $stdout $stderr $Role $Entrypoint $expectedPortMarker $expectedPort
    try {
        $identity = & $IdentityLookup ([int]$process.Id) $Entrypoint
    } catch {
        try { & $StopSpawnedProcessFn $process } catch {}
        throw
    }
    $identity | Add-Member -NotePropertyName 'role' -NotePropertyValue $Role
    $identity | Add-Member -NotePropertyName 'stdout_path' -NotePropertyValue $stdout
    $identity | Add-Member -NotePropertyName 'stderr_path' -NotePropertyValue $stderr
    $identity
}

function Wait-IsolatedHealth {
    param(
        [string] $Url, [int] $TimeoutSeconds = 45,
        [scriptblock] $Probe = { param($uri) Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $uri }
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { if ((& $Probe $Url).StatusCode -eq 200) { return $true } } catch {}
        Start-Sleep -Milliseconds 500
    }
    $false
}

function Stop-IsolatedBackends {
    param(
        [object[]] $Processes,
        [scriptblock] $IdentityLookup = { param($e) Get-IsolatedProcessIdentity -ProcessId ([int]$e.pid) -Entrypoint ([string]$e.entrypoint) },
        [scriptblock] $ProcessHandleLookup = { param($processId) Get-Process -Id $processId -ErrorAction Stop },
        [scriptblock] $StopProcessFn = {
            param($processId,$processHandle,$safeProcessHandle)
            if ($null -eq $processHandle -or $null -eq $safeProcessHandle) { throw "Pinned process handle is required for $processId." }
            if ([bool]$safeProcessHandle.IsInvalid -or [bool]$safeProcessHandle.IsClosed) { throw "Pinned process handle for $processId is no longer valid." }
            $processHandle.Kill($true)
            if (-not $processHandle.WaitForExit(5000) -or -not [bool]$processHandle.HasExited) {
                throw "Process $processId did not exit after the kill request."
            }
        },
        [scriptblock] $MissingProcessFn,
        [switch] $AllowMissing
    )
    $verified = [System.Collections.Generic.List[object]]::new()
    $results = [System.Collections.Generic.List[object]]::new()
    $prevalidationFailed = $false
    foreach ($expected in $Processes) {
        if ($expected.PSObject.Properties['stop_status'] -and [string]$expected.stop_status -eq 'stopped') {
            $results.Add([pscustomobject]@{role=$expected.role;pid=$expected.pid;status='already_stopped';reason='persisted_stop_state'})
            continue
        }
        try { $actual = & $IdentityLookup $expected } catch {
            if ($null -ne $MissingProcessFn -and [bool](& $MissingProcessFn $expected)) {
                $results.Add([pscustomobject]@{role=$expected.role;pid=$expected.pid;status='already_stopped';reason='process_absent_and_port_free'})
            } else {
                $reason = if ($AllowMissing) { 'rollback_identity_unproven' } else { 'identity_lookup_failed' }
                $results.Add([pscustomobject]@{role=$expected.role;pid=$expected.pid;status='not_owned';reason=$reason})
                $prevalidationFailed = $true
            }
            continue
        }
        if (-not (Test-IsolatedProcessOwnership -Expected $expected -Actual $actual)) {
            $results.Add([pscustomobject]@{role=$expected.role;pid=$expected.pid;status='not_owned';reason='identity_mismatch'})
            $prevalidationFailed = $true
            continue
        }
        $verified.Add($expected)
    }
    if ($prevalidationFailed) { return @($results) }
    foreach ($process in @($verified | Sort-Object { [array]::IndexOf($Processes, $_) } -Descending)) {
        $processHandle = $null
        $safeProcessHandle = $null
        try {
            if ($null -ne $ProcessHandleLookup) {
                $processHandle = & $ProcessHandleLookup ([int]$process.pid)
                if ($null -eq $processHandle -or [int]$processHandle.Id -ne [int]$process.pid -or [bool]$processHandle.HasExited) {
                    throw "Fresh process handle for $($process.pid) is unavailable."
                }
                $safeProcessHandle = $processHandle.SafeHandle
                if ($null -eq $safeProcessHandle -or [bool]$safeProcessHandle.IsInvalid -or [bool]$safeProcessHandle.IsClosed) {
                    throw "Fresh process handle for $($process.pid) cannot be pinned."
                }
            }
            $immediate = & $IdentityLookup $process
            if (-not (Test-IsolatedProcessOwnership -Expected $process -Actual $immediate)) {
                $results.Add([pscustomobject]@{role=$process.role;pid=$process.pid;status='not_owned';reason='identity_changed_before_stop'})
                return @($results)
            }
        } catch {
            $results.Add([pscustomobject]@{role=$process.role;pid=$process.pid;status='not_owned';reason="fresh_revalidation_failed: $($_.Exception.Message)"})
            return @($results)
        }
        try {
            & $StopProcessFn ([int]$process.pid) $processHandle $safeProcessHandle
            $results.Add([pscustomobject]@{role=$process.role;pid=$process.pid;status='stopped';reason=$null})
        } catch {
            $results.Add([pscustomobject]@{role=$process.role;pid=$process.pid;status='stop_failed';reason=$_.Exception.Message})
        }
    }
    @($results)
}

function Write-IsolatedJsonAtomic {
    param([string] $Path, $Value, [switch] $NoClobber)
    if ($NoClobber -and (Test-Path -LiteralPath $Path)) { throw "Manifest collision: $Path" }
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory ".stack-manifest.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
        [System.IO.File]::Move($temporary, $Path, -not $NoClobber)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Read-IsolatedStackManifest {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Stack manifest not found: $Path" }
    Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 12
}

function Assert-IsolatedStackManifestProcesses {
    param($Manifest,[string]$RepoRoot)
    $processesProperty = $Manifest.PSObject.Properties['processes']
    if ($null -eq $processesProperty) { throw 'Manifest process records are missing.' }
    $processes = @($processesProperty.Value)
    if ($processes.Count -eq 0) { throw 'Manifest must contain at least one backend process record.' }

    $allowedRoles = @('governance','coordinator')
    $seenRoles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $seenProcessIds = [Collections.Generic.HashSet[int]]::new()
    foreach ($process in $processes) {
        if ($null -eq $process) { throw 'Manifest backend process record is null.' }
        foreach ($requiredField in @('role','pid','entrypoint','command_line','creation_identity')) {
            if ($null -eq $process.PSObject.Properties[$requiredField]) {
                throw "Manifest backend process record is missing $requiredField."
            }
        }
        $role = [string]$process.role
        if ($allowedRoles -notcontains $role) { throw "Manifest backend process role is invalid: $role" }
        if (-not $seenRoles.Add($role)) { throw "Manifest backend process role is duplicated: $role" }
        $resolvedProcessId = 0
        if (-not [int]::TryParse([string]$process.pid, [ref]$resolvedProcessId) -or $resolvedProcessId -le 0) {
            throw "Manifest backend process PID is invalid for role $role."
        }
        if (-not $seenProcessIds.Add($resolvedProcessId)) { throw "Manifest backend process PID is duplicated: $resolvedProcessId" }
        if ([string]::IsNullOrWhiteSpace([string]$process.command_line) -or
            [string]::IsNullOrWhiteSpace([string]$process.creation_identity)) {
            throw "Manifest backend process identity is incomplete for role $role."
        }
        $expectedEntrypoint = if ($role -eq 'governance') {
            [IO.Path]::GetFullPath((Join-Path $RepoRoot 'governance-service'))
        } else {
            [IO.Path]::GetFullPath((Join-Path $RepoRoot 'bim-review-coordinator\src\index.ts'))
        }
        $actualEntrypoint = [string]$process.entrypoint
        if (-not $actualEntrypoint.Equals($expectedEntrypoint, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Manifest backend process entrypoint is invalid for role $role."
        }
        $expectedPort = [int]$Manifest.ports.$role
        $commandLine = [string]$process.command_line
        $portMarker = if ($role -eq 'governance') { '--port' } else { '--isolated-stack-port' }
        $directPortPattern = '(?:^|\s){0}\s+{1}(?:[\s"]|$)' -f [regex]::Escape($portMarker), $expectedPort
        $directPortBinding = $commandLine -match $directPortPattern
        if (-not $commandLine.Contains($expectedEntrypoint, [StringComparison]::OrdinalIgnoreCase) -or
            -not $directPortBinding) {
            throw "Manifest backend process command line is not bound to the canonical $role entrypoint and resolved port."
        }
    }

    $startFailureProperty = $Manifest.PSObject.Properties['start_failure']
    $reservationProperty = $Manifest.PSObject.Properties['reservation_held']
    if ($null -ne $startFailureProperty) {
        if ($null -eq $startFailureProperty.Value -or $null -eq $reservationProperty) {
            throw 'Recovery manifest start failure/reservation state is incomplete.'
        }
        $isStopped = -not [string]::IsNullOrWhiteSpace([string]$Manifest.stopped_at)
        if (-not $isStopped -and -not [bool]$reservationProperty.Value) {
            throw 'Active recovery manifest must retain its reservation.'
        }
    } else {
        if (($null -ne $reservationProperty -and [bool]$reservationProperty.Value) -or
            $processes.Count -ne 2 -or
            -not $seenRoles.Contains('governance') -or
            -not $seenRoles.Contains('coordinator')) {
            throw 'Successful manifest must contain exactly one governance and one coordinator process.'
        }
    }
}

function Assert-IsolatedStackManifestIdentity {
    param($Manifest,[string]$RepoRoot,[string]$ChangeId,[string]$RunId,[string]$OffsetInput)
    if ([string]$Manifest.schema_version -cne 'isolated-branch-stack/v1' -or
        [string]$Manifest.stack_kind -cne 'isolated_branch_stack') {
        throw 'Manifest schema/stack identity mismatch.'
    }
    if ([string]$Manifest.change_id -cne $ChangeId -or [string]$Manifest.run_id -cne $RunId) {
        throw 'Manifest change/run identity mismatch.'
    }
    $expectedRoot = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
    $actualRoot = [IO.Path]::GetFullPath([string]$Manifest.worktree_root).TrimEnd('\')
    if (-not $actualRoot.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Manifest worktree identity mismatch.'
    }
    $ports = Resolve-IsolatedStackPorts -OffsetInput $OffsetInput
    if ([int]$Manifest.offset -ne [int]$OffsetInput -or
        [int]$Manifest.ports.coordinator -ne $ports.coordinator -or
        [int]$Manifest.ports.governance -ne $ports.governance -or
        [int]$Manifest.ports.viewer -ne $ports.viewer) {
        throw 'Manifest offset/port identity mismatch.'
    }
    if ([string]$Manifest.base_urls.coordinator -cne "http://127.0.0.1:$($ports.coordinator)" -or
        [string]$Manifest.base_urls.governance -cne "http://127.0.0.1:$($ports.governance)" -or
        [string]$Manifest.base_urls.viewer -cne "http://127.0.0.1:$($ports.viewer)") {
        throw 'Manifest base URL identity mismatch.'
    }
    if ([string]$Manifest.lifecycle_owners.governance -cne 'repo_launcher' -or
        [string]$Manifest.lifecycle_owners.coordinator -cne 'repo_launcher' -or
        [string]$Manifest.lifecycle_owners.viewer -cne 'playwright_webserver') {
        throw 'Manifest lifecycle owner identity mismatch.'
    }
    if ([int]$Manifest.viewer.expected_port -ne $ports.viewer -or
        [string]$Manifest.viewer.owner -cne 'playwright_webserver' -or
        $null -eq $Manifest.viewer.managed_by_launcher -or
        [bool]$Manifest.viewer.managed_by_launcher) {
        throw 'Manifest viewer identity mismatch.'
    }
    Assert-IsolatedStackManifestProcesses -Manifest $Manifest -RepoRoot $RepoRoot
}

function New-IsolatedStackManifest {
    param([string]$RepoRoot,[string]$ChangeId,[string]$RunId,$Preflight,[string]$HeadSha,[object[]]$Processes,$StateLayout,$Reservation)
    [ordered]@{
        schema_version='isolated-branch-stack/v1'; stack_kind='isolated_branch_stack'
        change_id=$ChangeId; run_id=$RunId; worktree_root=$RepoRoot; offset=$Preflight.offset
        reservation_id=[string]$Reservation.reservation_id
        ports=$Preflight.ports
        base_urls=[ordered]@{
            coordinator="http://127.0.0.1:$($Preflight.ports.coordinator)"
            governance="http://127.0.0.1:$($Preflight.ports.governance)"
            viewer="http://127.0.0.1:$($Preflight.ports.viewer)"
        }
        head_sha=$HeadSha; started_at=[DateTime]::UtcNow.ToString('o'); stopped_at=$null
        backend_ready=[ordered]@{governance=$true;coordinator=$true}
        lifecycle_owners=[ordered]@{governance='repo_launcher';coordinator='repo_launcher';viewer='playwright_webserver'}
        viewer=[ordered]@{expected_port=$Preflight.ports.viewer;owner='playwright_webserver';managed_by_launcher=$false}
        read_only_fixture_root=[string]$StateLayout.fixture_root
        mutable_state=[ordered]@{
            root=[string]$StateLayout.state_root
            governance_db=[string]$StateLayout.governance_db
            governance_federation_out=[string]$StateLayout.governance_federation_out
            coordinator_root=[string]$StateLayout.coordinator_root
        }
        processes=$Processes
    }
}

function Get-IsolatedStackStatus {
    param(
        $Manifest,[string]$ManifestPath,[scriptblock]$IdentityLookup,[scriptblock]$HealthFn,
        [scriptblock]$ListenerLookupFn,[scriptblock]$ListenerProcessOwnershipFn
    )
    $backend = foreach ($expected in @($Manifest.processes)) {
        $actual = $null
        try { $actual = & $IdentityLookup $expected } catch {}
        $processOwned = Test-IsolatedProcessOwnership -Expected $expected -Actual $actual
        $owned = $false
        $ready = $false
        if ($processOwned) {
            $port = [int]$Manifest.ports.([string]$expected.role)
            $listeners = @()
            try { $listeners = @(& $ListenerLookupFn $port | Where-Object { $null -ne $_ }) } catch {}
            if ($listeners.Count -eq 1) {
                try {
                    $owned = [bool](& $ListenerProcessOwnershipFn $expected ([int]$listeners[0].OwningProcess) $port)
                } catch {
                    $owned = $false
                }
            }
        }
        if ($owned) {
            $healthUrl = "$($Manifest.base_urls.($expected.role))/health"
            try { $ready = [bool](& $HealthFn $healthUrl) } catch { $ready = $false }
        }
        [pscustomobject]@{ role=$expected.role;pid=$expected.pid;owned=$owned;ready=$ready }
    }
    $backend = @($backend)
    $isRecovery = $null -ne $Manifest.PSObject.Properties['start_failure']
    $status = if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.stopped_at)) {
        'stopped'
    } elseif (-not $isRecovery -and
        $backend.Count -eq 2 -and
        @($backend.role | Sort-Object -Unique).Count -eq 2 -and
        @($backend | Where-Object { -not $_.owned -or -not $_.ready }).Count -eq 0) {
        'active'
    } else {
        'degraded'
    }
    [pscustomobject]@{status=$status;stack_kind=$Manifest.stack_kind;backend=@($backend);viewer=$Manifest.viewer;manifest_path=$ManifestPath}
}

function New-IsolatedMissingProcessGuard {
    param($Ports,[scriptblock]$ProcessExistsFn,[scriptblock]$ListenerLookupFn)
    {
        param($expected)
        try {
            if ([bool](& $ProcessExistsFn ([int]$expected.pid))) { return $false }
            $port = [int]$Ports.($expected.role)
            return $null -eq (& $ListenerLookupFn $port)
        } catch {
            return $false
        }
    }.GetNewClosure()
}

function Assert-IsolatedStackStopPortOwnership {
    param($Manifest,[object[]]$Processes,[scriptblock]$ListenerLookupFn,[scriptblock]$ListenerProcessOwnershipFn)
    foreach ($expected in $Processes) {
        $role = [string]$expected.role
        $port = [int]$Manifest.ports.$role
        $listeners = @(& $ListenerLookupFn $port | Where-Object { $null -ne $_ })
        if ($listeners.Count -gt 1) { throw "Multiple listeners were found on isolated $role port $port. No process was stopped." }
        if ($listeners.Count -eq 0) { continue }
        $alreadyStopped = $expected.PSObject.Properties['stop_status'] -and [string]$expected.stop_status -eq 'stopped'
        $listenerOwned = $false
        if (-not $alreadyStopped) {
            try {
                $listenerOwned = [bool](& $ListenerProcessOwnershipFn $expected ([int]$listeners[0].OwningProcess) $port)
            } catch {
                $listenerOwned = $false
            }
        }
        if ($alreadyStopped -or -not $listenerOwned) {
            throw "Listener on isolated $role port $port is not owned by the expected process. No process was stopped."
        }
    }
}

function Wait-IsolatedBackendTermination {
    param(
        $Expected,[int]$Port,[scriptblock]$ProcessExistsFn,[scriptblock]$ListenerLookupFn,
        [int]$TimeoutMilliseconds = 5000
    )
    if ($TimeoutMilliseconds -lt 0) { throw 'Termination timeout must be non-negative.' }
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        try {
            $processExists = [bool](& $ProcessExistsFn ([int]$Expected.pid))
            $listeners = @(& $ListenerLookupFn $Port | Where-Object { $null -ne $_ })
            if ($listeners.Count -gt 1) { return $false }
            if (-not $processExists -and $listeners.Count -eq 0) { return $true }
        } catch {
            return $false
        }
        if ([DateTime]::UtcNow -ge $deadline) { break }
        Start-Sleep -Milliseconds 50
    } while ($true)
    return $false
}

function Stop-IsolatedStackRun {
    param(
        $Manifest,[string]$ManifestPath,[scriptblock]$IdentityLookup,[scriptblock]$StopProcessFn,
        [scriptblock]$ProcessExistsFn,[scriptblock]$ListenerLookupFn,[scriptblock]$ListenerProcessOwnershipFn,
        [scriptblock]$ProcessHandleLookup,
        [int]$TerminationTimeoutMilliseconds = 5000
    )
    if ($Manifest.stopped_at) { return [pscustomobject]@{status='already_stopped';manifest_path=$ManifestPath} }
    $manifestProcesses = @($Manifest.processes)
    if ($manifestProcesses.Count -eq 0) { throw 'Refusing to stop an isolated stack without backend process records.' }
    Assert-IsolatedStackStopPortOwnership -Manifest $Manifest -Processes $manifestProcesses -ListenerLookupFn $ListenerLookupFn `
        -ListenerProcessOwnershipFn $ListenerProcessOwnershipFn
    $missingProcessFn = New-IsolatedMissingProcessGuard -Ports $Manifest.ports -ProcessExistsFn $ProcessExistsFn -ListenerLookupFn $ListenerLookupFn
    $results = @(Stop-IsolatedBackends -Processes $manifestProcesses -IdentityLookup $IdentityLookup -ProcessHandleLookup $ProcessHandleLookup -StopProcessFn $StopProcessFn -MissingProcessFn $missingProcessFn)
    $Manifest | Add-Member -Force -NotePropertyName stop_state -NotePropertyValue ([ordered]@{ attempted_at=[DateTime]::UtcNow.ToString('o'); entries=$results })
    foreach ($result in $results) {
        $process = @($Manifest.processes | Where-Object { $_.role -eq $result.role -and $_.pid -eq $result.pid }) | Select-Object -First 1
        if ($process -and $result.status -in @('stopped','already_stopped')) {
            $port = [int]$Manifest.ports.([string]$process.role)
            if (-not (Wait-IsolatedBackendTermination -Expected $process -Port $port -ProcessExistsFn $ProcessExistsFn `
                -ListenerLookupFn $ListenerLookupFn -TimeoutMilliseconds $TerminationTimeoutMilliseconds)) {
                $result.status = 'stop_failed'
                $result.reason = 'process_or_listener_remained_after_stop'
            }
        }
        if ($process -and $result.status -in @('stopped','already_stopped')) {
            $process | Add-Member -Force -NotePropertyName stop_status -NotePropertyValue 'stopped'
            $Manifest.backend_ready.($result.role) = $false
        }
    }
    $failed = @($results | Where-Object { $_.status -in @('not_owned','stop_failed') })
    if ($failed.Count -eq 0) {
        $Manifest.stopped_at=[DateTime]::UtcNow.ToString('o')
        $Manifest.backend_ready.governance=$false
        $Manifest.backend_ready.coordinator=$false
    }
    Write-IsolatedJsonAtomic -Path $ManifestPath -Value $Manifest
    if ($failed.Count -gt 0) { throw "Partial stop; recoverable per-process state persisted for: $($failed.role -join ',')" }
    [pscustomobject]@{status='stopped';manifest_path=$ManifestPath}
}

function Start-IsolatedStackRun {
    param(
        $RepoRoot,$ChangeId,$RunId,$Preflight,$Runtime,$Reservation,$StartBackendFn,$HealthFn,$IdentityLookup,$StopProcessFn,$HeadShaFn,
        [scriptblock]$ProcessExistsFn,[scriptblock]$ListenerLookupFn,[scriptblock]$ProcessHandleLookup,
        [scriptblock]$ReservationRecoveryHoldFn={param($reservation) Set-IsolatedStackReservationRecoveryHeld -Reservation $reservation},
        $LifecycleLogger
    )
    $runDirectory=Split-Path -Parent $Preflight.manifest_path
    $stateLayout=Resolve-IsolatedStackStateLayout -RepoRoot $RepoRoot -RunDirectory $runDirectory
    foreach ($directory in @(
        $stateLayout.state_root,
        $stateLayout.governance_root,
        (Join-Path $stateLayout.governance_root 'federated'),
        (Join-Path $stateLayout.governance_root 'logs'),
        $stateLayout.coordinator_root,
        (Join-Path $stateLayout.coordinator_root 'sessions'),
        (Join-Path $stateLayout.coordinator_root 'events'),
        (Join-Path $stateLayout.coordinator_root 'logs'),
        (Join-Path $stateLayout.coordinator_root 'storage'),
        (Join-Path $stateLayout.coordinator_root 'edge-runtime')
    )) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $started=[System.Collections.Generic.List[object]]::new()
    try {
        $head=& $HeadShaFn $RepoRoot
        if($head -notmatch '^[0-9a-f]{40}$'){throw 'HEAD identity is not a 40-character commit SHA'}

        $governanceRoot=Join-Path $RepoRoot 'governance-service'
        $governanceSpec=@{
            Role='governance';WorkingDirectory=$governanceRoot;Executable=$Runtime.python
            Arguments=@('-m','uvicorn','--app-dir',$governanceRoot,'app:app','--host','127.0.0.1','--port',"$($Preflight.ports.governance)")
            Environment=(New-IsolatedBackendEnvironment -Role governance -StateLayout $stateLayout -Ports $Preflight.ports)
            RunDirectory=$runDirectory;Entrypoint=$governanceRoot
        }
        $governance=& $StartBackendFn $governanceSpec
        $started.Add($governance)
        if(-not (& $HealthFn "http://127.0.0.1:$($Preflight.ports.governance)/health")){throw 'governance health failed'}

        $indexPath=Join-Path $RepoRoot 'bim-review-coordinator\src\index.ts'
        $coordinatorSpec=@{
            Role='coordinator';WorkingDirectory=(Join-Path $RepoRoot 'bim-review-coordinator');Executable=$Runtime.node
            Arguments=@($Runtime.tsx,$indexPath,'--isolated-stack-port',"$($Preflight.ports.coordinator)")
            Environment=(New-IsolatedBackendEnvironment -Role coordinator -StateLayout $stateLayout -Ports $Preflight.ports)
            RunDirectory=$runDirectory;Entrypoint=$indexPath
        }
        $coordinator=& $StartBackendFn $coordinatorSpec
        $started.Add($coordinator)
        if(-not (& $HealthFn "http://127.0.0.1:$($Preflight.ports.coordinator)/health")){throw 'coordinator health failed'}

        $manifest=New-IsolatedStackManifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $Preflight -HeadSha $head -Processes @($started) -StateLayout $stateLayout -Reservation $Reservation
        Write-IsolatedJsonAtomic -Path $Preflight.manifest_path -Value $manifest -NoClobber
        [pscustomobject]@{status='started';manifest_path=$Preflight.manifest_path;manifest=$manifest}
    } catch {
        $startFailure = $_
        if($started.Count -gt 0){
            $rollbackMissingProcessFn = New-IsolatedMissingProcessGuard -Ports $Preflight.ports -ProcessExistsFn $ProcessExistsFn -ListenerLookupFn $ListenerLookupFn
            $rollbackResults = @(Stop-IsolatedBackends -Processes @($started) -IdentityLookup $IdentityLookup -ProcessHandleLookup $ProcessHandleLookup -StopProcessFn $StopProcessFn -MissingProcessFn $rollbackMissingProcessFn -AllowMissing)
            $rollbackFailures = @($rollbackResults | Where-Object { $_.status -in @('not_owned','stop_failed') })
            if ($null -ne $LifecycleLogger) {
                $rollbackStatus = if ($rollbackFailures.Count -eq 0) { 'complete' } else { 'incomplete' }
                $rollbackData = New-IsolatedStackLifecycleData -StructRunId $LifecycleLogger.RunId -ChangeId $ChangeId `
                    -StackRunId $RunId -Action rollback -Phase closed -Status $rollbackStatus
                $LifecycleLogger | Write-StructLifecycle -Msg 'isolated branch stack startup rollback completed' -Data $rollbackData | Out-Null
            }
            if ($rollbackFailures.Count -gt 0) {
                try {
                    $recovery = New-IsolatedStackManifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $Preflight -HeadSha $head -Processes @($started) -StateLayout $stateLayout -Reservation $Reservation
                    $recovery.backend_ready.governance = $false
                    $recovery.backend_ready.coordinator = $false
                    $recovery | Add-Member -Force -NotePropertyName reservation_held -NotePropertyValue $true
                    $recovery | Add-Member -Force -NotePropertyName start_failure -NotePropertyValue ([ordered]@{ message=$startFailure.Exception.Message; occurred_at=[DateTime]::UtcNow.ToString('o') })
                    $recovery | Add-Member -Force -NotePropertyName stop_state -NotePropertyValue ([ordered]@{ attempted_at=[DateTime]::UtcNow.ToString('o'); entries=$rollbackResults })
                    foreach ($result in $rollbackResults) {
                        $process = @($recovery.processes | Where-Object { $_.role -eq $result.role -and $_.pid -eq $result.pid }) | Select-Object -First 1
                        if ($process -and $result.status -in @('stopped','already_stopped')) {
                            $process | Add-Member -Force -NotePropertyName stop_status -NotePropertyValue 'stopped'
                        }
                    }
                    Write-IsolatedJsonAtomic -Path $Preflight.manifest_path -Value $recovery -NoClobber
                    & $ReservationRecoveryHoldFn $Reservation
                } catch {
                    $recoveryPersistenceError = [InvalidOperationException]::new("Start failed, rollback was incomplete, and the recovery handoff could not be completed; reservations remain held for ownership-gated recovery. Cause: $($startFailure.Exception.Message). Persistence error: $($_.Exception.Message)")
                    $recoveryPersistenceError.Data['KeepIsolatedReservation'] = $true
                    throw $recoveryPersistenceError
                }
                $recoveryError = [InvalidOperationException]::new("Start failed and rollback was incomplete; recovery manifest retained at $($Preflight.manifest_path). Cause: $($startFailure.Exception.Message)")
                $recoveryError.Data['KeepIsolatedReservation'] = $true
                throw $recoveryError
            }
        }
        throw
    }
}

function Invoke-IsolatedBranchStack {
    param(
        [ValidateSet('start','status','stop')][string]$Action,
        [string]$ChangeId,[string]$RunId,[string]$OffsetInput,
        [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
        [scriptblock]$PreflightFn={param($root,$change,$run,$offset) Assert-IsolatedStackStartPreflight -RepoRoot $root -ChangeId $change -RunId $run -OffsetInput $offset},
        [scriptblock]$RuntimeResolver={param($root) Resolve-IsolatedRuntime -RepoRoot $root},
        [scriptblock]$StartBackendFn={param($spec) Start-IsolatedBackend @spec},
        [scriptblock]$HealthFn={param($url) Wait-IsolatedHealth -Url $url},
        [scriptblock]$IdentityLookup={param($e) Get-IsolatedProcessIdentity -ProcessId ([int]$e.pid) -Entrypoint ([string]$e.entrypoint)},
        [scriptblock]$StopProcessFn={param($processId,$processHandle,$safeProcessHandle) if ($null -eq $processHandle -or $null -eq $safeProcessHandle) { throw "Pinned process handle is required for $processId." }; if ([bool]$safeProcessHandle.IsInvalid -or [bool]$safeProcessHandle.IsClosed) { throw "Pinned process handle for $processId is no longer valid." }; $processHandle.Kill($true); if (-not $processHandle.WaitForExit(5000) -or -not [bool]$processHandle.HasExited) { throw "Process $processId did not exit after the kill request." }},
        [scriptblock]$ProcessHandleLookup={param($processId) Get-Process -Id $processId -ErrorAction Stop},
        [scriptblock]$ProcessExistsFn={param($processId) $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)},
        [scriptblock]$StopListenerLookupFn={param($port) Get-IsolatedPortListener -Port $port},
        [scriptblock]$ListenerProcessOwnershipFn={param($expected,$listenerProcessId,$port) Test-IsolatedListenerProcessOwnership -Expected $expected -ListenerProcessId $listenerProcessId -Port $port},
        [scriptblock]$HeadShaFn={param($root) (& git -C $root rev-parse HEAD).Trim()},
        [scriptblock]$WorktreeStatusFn={param($root) & git -C $root status --porcelain --untracked-files=all},
        [scriptblock]$ReservationAcquireFn={param($root,$change,$run,$offset) Acquire-IsolatedStackReservations -RepoRoot $root -ChangeId $change -RunId $run -Offset $offset},
        [scriptblock]$ReservationReleaseFn={param($reservation) Release-IsolatedStackReservations -Reservation $reservation},
        [scriptblock]$ReservationRecoveryHoldFn={param($reservation) Set-IsolatedStackReservationRecoveryHeld -Reservation $reservation},
        [int]$TerminationTimeoutMilliseconds=5000,
        $LifecycleLogger=$null
    )
    Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
    Assert-SafeStackSegment -Name 'RunId' -Value $RunId
    $manifestPath=Resolve-IsolatedStackManifestPath -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId

    if($Action -in @('status','stop')){
        $manifest=Read-IsolatedStackManifest -Path $manifestPath
        $effectiveOffset = if ([string]::IsNullOrWhiteSpace($OffsetInput)) { [string]$manifest.offset } else { $OffsetInput }
        Assert-IsolatedStackManifestIdentity -Manifest $manifest -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -OffsetInput $effectiveOffset
        if($Action -eq 'status'){
            return Get-IsolatedStackStatus -Manifest $manifest -ManifestPath $manifestPath -IdentityLookup $IdentityLookup -HealthFn $HealthFn `
                -ListenerLookupFn $StopListenerLookupFn -ListenerProcessOwnershipFn $ListenerProcessOwnershipFn
        }
        $stopResult = Stop-IsolatedStackRun -Manifest $manifest -ManifestPath $manifestPath -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn `
            -ProcessExistsFn $ProcessExistsFn -ListenerLookupFn $StopListenerLookupFn -ListenerProcessOwnershipFn $ListenerProcessOwnershipFn `
            -ProcessHandleLookup $ProcessHandleLookup `
            -TerminationTimeoutMilliseconds $TerminationTimeoutMilliseconds
        if ($manifest.PSObject.Properties['reservation_held'] -and [bool]$manifest.reservation_held) {
            $heldReservation = Resolve-IsolatedStackReservation -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Offset ([int]$manifest.offset)
            $manifestReservationId = $manifest.PSObject.Properties['reservation_id']
            if ($null -eq $manifestReservationId -or [string]::IsNullOrWhiteSpace([string]$manifestReservationId.Value)) {
                throw 'Recovery manifest is missing the reservation_id required for identity-checked release.'
            }
            $heldReservation | Add-Member -Force -NotePropertyName reservation_id -NotePropertyValue ([string]$manifestReservationId.Value)
            & $ReservationReleaseFn $heldReservation
            $manifest.reservation_held = $false
            Write-IsolatedJsonAtomic -Path $manifestPath -Value $manifest
        }
        return $stopResult
    }

    $effectiveOffset = if ([string]::IsNullOrWhiteSpace($OffsetInput)) { '0' } else { $OffsetInput }
    Assert-IsolatedCleanWorktree -RepoRoot $RepoRoot -StatusFn $WorktreeStatusFn
    $null = Resolve-IsolatedStackPorts -OffsetInput $effectiveOffset
    $reservation = & $ReservationAcquireFn $RepoRoot $ChangeId $RunId ([int]$effectiveOffset)
    $releaseReservation = $true
    try {
        $preflight=& $PreflightFn $RepoRoot $ChangeId $RunId $effectiveOffset
        $runtime=& $RuntimeResolver $RepoRoot
        Start-IsolatedStackRun -RepoRoot $RepoRoot -ChangeId $ChangeId -RunId $RunId -Preflight $preflight -Runtime $runtime -Reservation $reservation `
          -StartBackendFn $StartBackendFn -HealthFn $HealthFn -IdentityLookup $IdentityLookup -StopProcessFn $StopProcessFn -HeadShaFn $HeadShaFn `
          -ProcessExistsFn $ProcessExistsFn -ListenerLookupFn $StopListenerLookupFn -ProcessHandleLookup $ProcessHandleLookup `
          -ReservationRecoveryHoldFn $ReservationRecoveryHoldFn -LifecycleLogger $LifecycleLogger
    } catch {
        if ($_.Exception.Data['KeepIsolatedReservation'] -eq $true) { $releaseReservation = $false }
        throw
    } finally {
        if ($releaseReservation) { & $ReservationReleaseFn $reservation }
    }
}

function Invoke-IsolatedBranchStackCli {
    param(
        [ValidateSet('start','status','stop')][string]$Action,
        [string]$ChangeId,
        [string]$RunId,
        [string]$OffsetInput,
        [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    )
    $resolvedRepoRoot = Resolve-Path -LiteralPath $RepoRoot -ErrorAction Stop
    if ([string]$resolvedRepoRoot.Provider.Name -cne 'FileSystem' -or -not (Test-Path -LiteralPath $resolvedRepoRoot.Path -PathType Container)) {
        throw "RepoRoot must resolve to one filesystem directory: $RepoRoot"
    }
    $RepoRoot = [IO.Path]::GetFullPath([string]$resolvedRepoRoot.Path)
    $logRoot = Join-Path $RepoRoot 'artifacts\e2e\_launcher\structured-logs'
    $structRunId = New-StructLogRunId
    $logger = New-StructLogger -Service 'scripts' -Component 'isolated-branch-stack' -RunId $structRunId `
        -InitialTraceId "script_$structRunId" -LogRoot $logRoot -SkipEnvSnapshot
    $inputsValidated = $false
    try {
        Assert-SafeStackSegment -Name 'ChangeId' -Value $ChangeId
        Assert-SafeStackSegment -Name 'RunId' -Value $RunId
        $inputsValidated = $true
        $startData = New-IsolatedStackLifecycleData -StructRunId $structRunId -ChangeId $ChangeId `
            -StackRunId $RunId -Action $Action -Phase start
        $logger | Write-StructLifecycle -Msg 'isolated branch stack action started' -Data $startData | Out-Null
        $result = Invoke-IsolatedBranchStack -Action $Action -ChangeId $ChangeId -RunId $RunId -OffsetInput $OffsetInput -RepoRoot $RepoRoot -LifecycleLogger $logger
        $completionData = New-IsolatedStackLifecycleData -StructRunId $structRunId -ChangeId $ChangeId `
            -StackRunId $RunId -Action $Action -Phase closed -Status ([string]$result.status)
        $logger | Write-StructLifecycle -Msg 'isolated branch stack action completed' -Data $completionData | Out-Null
        return $result
    } catch {
        $safeChangeId = if ($inputsValidated) { $ChangeId } else { 'invalid' }
        $safeStackRunId = if ($inputsValidated) { $RunId } else { 'invalid' }
        $safeReason = if ($inputsValidated) { $_.Exception.Message } else { 'input validation failed' }
        $failureData = New-IsolatedStackLifecycleData -StructRunId $structRunId -ChangeId $safeChangeId `
            -StackRunId $safeStackRunId -Action $Action -Phase closed -Status failed
        $logger | Write-StructLifecycle -Msg 'isolated branch stack action failed' -Data $failureData -Level error | Out-Null
        $logger | Write-StructAnomaly -Msg 'isolated branch stack action failed' -Data @{
            anomaly_kind = 'unexpected_state'; phase = $Action; reason = $safeReason
            subject_kind = 'script_run'; subject_id = $structRunId; change_id = $safeChangeId; stack_run_id = $safeStackRunId; action = $Action
        } | Out-Null
        throw
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $cliParameters = @{ Action=$Action; ChangeId=$ChangeId; RunId=$RunId; OffsetInput=$Offset }
    if (-not [string]::IsNullOrWhiteSpace($CliRepoRoot)) { $cliParameters.RepoRoot = $CliRepoRoot }
    Invoke-IsolatedBranchStackCli @cliParameters
}
