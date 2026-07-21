# scripts/lib/StructLog.psm1
#
# PowerShell adapter for the cross-service structured log baseline.
#
# Source of truth: docs/contracts/structured-log-schema.md.
# Allow-list / secret patterns: tests/contracts/structured-log/env-allowlist.json.
#
# Public entry point: New-StructLogger -Service <svc> -Component <comp>
# Helpers:
#   $logger | Write-StructDebug / Write-StructInfo / Write-StructWarn
#   $logger | Write-StructError -ErrorRecord $err
#   $logger | Write-StructFatal -ErrorRecord $err
#   $logger | Write-StructNetwork -Data @{direction='outbound'; ...}
#   $logger | Write-StructAudit -Data @{action='deploy-report'; ...}
#   $logger | Write-StructLifecycle -Data @{phase='start'; ...}
#   $logger | Write-StructAnomaly -Data @{anomaly_kind='retry'; ...}
#   $logger | Write-StructEnvSnapshot
#
# The logger is fail-soft: sink failures write a [structLog sink failed]
# message to stderr and never throw to callers.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Constants -------------------------------------------------------------

$script:DefaultBufferLimit = 100
$script:RunIdPattern = '^run_\d{8}_\d{6}_[0-9a-f]{6}$'
$script:SecretPatternFallback = 'TOKEN|SECRET|KEY|PASSWORD|AUTH|CREDENTIAL'
$script:ValidLevels = @('debug', 'info', 'warn', 'error', 'fatal')

# Allow-list cache (loaded lazily from env-allowlist.json).
$script:AllowListCache = $null

function Get-StructLogAllowList {
    [CmdletBinding()]
    param(
        [string] $Path
    )
    if (-not $Path) {
        # Default: <repo-root>/tests/contracts/structured-log/env-allowlist.json
        $here = Split-Path -Parent $PSCommandPath
        $Path = Join-Path $here '..\..\tests\contracts\structured-log\env-allowlist.json'
        $Path = [System.IO.Path]::GetFullPath($Path)
    }
    if ($script:AllowListCache -and $script:AllowListCache.SourcePath -eq $Path) {
        return $script:AllowListCache
    }
    $allowList = @{
        Keys = @{}
        SecretPattern = $script:SecretPatternFallback
        SourcePath = $Path
    }
    if (Test-Path $Path) {
        try {
            $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($key in @($raw.allow_list)) {
                $allowList.Keys[$key] = $true
            }
            if ($raw.secret_patterns) {
                $allowList.SecretPattern = ($raw.secret_patterns -join '|')
            }
        } catch {
            # Fallback to defaults; never break logger over allow-list IO.
        }
    }
    $script:AllowListCache = $allowList
    return $allowList
}

function Reset-StructLogAllowList {
    [CmdletBinding()]
    param()
    $script:AllowListCache = $null
}

# --- Utility helpers (exported for tests) ----------------------------------

function New-StructLogRunId {
    [CmdletBinding()]
    param(
        [datetime] $Now = (Get-Date).ToUniversalTime(),
        [string] $RandomHex
    )
    if (-not $RandomHex) {
        $bytes = New-Object byte[] 3
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $RandomHex = ($bytes | ForEach-Object { '{0:x2}' -f $_ }) -join ''
    }
    return ('run_{0:yyyyMMdd}_{0:HHmmss}_{1}' -f $Now, $RandomHex)
}

function Get-StructLogIsoTimestamp {
    [CmdletBinding()]
    param(
        [datetime] $Now = (Get-Date).ToUniversalTime()
    )
    return $Now.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

function Get-StructLogTypeTag {
    param($Value)
    if ($null -eq $Value) { return 'null' }
    switch ($Value.GetType().Name) {
        'Boolean'   { return 'boolean' }
        'Int32'     { return 'number' }
        'Int64'     { return 'number' }
        'Double'    { return 'number' }
        'Decimal'   { return 'number' }
        'String'    { return 'string' }
        'Object[]'  { return 'array' }
        'Hashtable' { return 'object' }
        default     { return 'string' }
    }
}

function Get-RedactedEnvVar {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Key,
        $Value,
        [string] $Source = 'system',
        $AllowList
    )
    if (-not $AllowList) { $AllowList = Get-StructLogAllowList }
    $stringValue = if ($null -eq $Value) { '' } else { [string] $Value }
    $type = Get-StructLogTypeTag $Value
    if ($AllowList.Keys.ContainsKey($Key)) {
        return [ordered]@{
            key = $Key
            source = $Source
            value_or_redacted = $stringValue
            type = $type
        }
    }
    if ($Key -match $AllowList.SecretPattern) {
        return [ordered]@{
            key = $Key
            source = $Source
            value_or_redacted = "[REDACTED:type=$type, len=$($stringValue.Length)]"
            type = $type
        }
    }
    return [ordered]@{
        key = $Key
        source = $Source
        value_or_redacted = "[TYPE:type=$type, len=$($stringValue.Length)]"
        type = $type
    }
}

function Test-StructLogIsSecretFieldName {
    param([string] $Name, [string] $Pattern)
    # Reserved schema vocabulary; never treated as secret even though the literal
    # text matches the secret regex (e.g. the schema field name `key`).
    $reserved = @('key', 'auth', 'name', 'type', 'source', 'value_or_redacted', 'status',
                  'reason', 'msg', 'data', 'event_type', 'level', 'service', 'component',
                  'run_id', 'trace_id', 'parent_trace_id', 'subject_kind', 'subject_id',
                  'phase', 'actor', 'action', 'target', 'direction', 'protocol', 'peer',
                  'duration_ms', 'path', 'anomaly_kind', 'vars', 'error', 'stack_tail')
    if ($reserved -contains $Name.ToLowerInvariant()) { return $false }
    return ($Name -match $Pattern)
}

function ConvertTo-StructLogRedactedData {
    [CmdletBinding()]
    param(
        $Data,
        $AllowList,
        [hashtable] $Seen
    )
    if (-not $AllowList) { $AllowList = Get-StructLogAllowList }
    if (-not $Seen) { $Seen = @{} }
    if ($null -eq $Data) { return $null }
    if ($Data -is [string] -or $Data -is [int] -or $Data -is [long] -or $Data -is [bool] -or $Data -is [double] -or $Data -is [decimal]) {
        return $Data
    }
    # Dict-likes come BEFORE the IEnumerable check because OrderedDictionary
    # also enumerates and would otherwise be mistaken for an array.
    if ($Data -is [System.Collections.IDictionary]) {
        $id = [System.Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($Data)
        if ($Seen.ContainsKey($id)) { return '[Circular]' }
        $Seen[$id] = $true
        $out = [ordered]@{}
        foreach ($k in @($Data.Keys)) {
            $value = $Data[$k]
            if (Test-StructLogIsSecretFieldName -Name ([string] $k) -Pattern $AllowList.SecretPattern) {
                $out[$k] = '[REDACTED]'
            } else {
                $out[$k] = ConvertTo-StructLogRedactedData -Data $value -AllowList $AllowList -Seen $Seen
            }
        }
        return $out
    }
    if ($Data -is [psobject] -and $Data.PSObject -and $Data.PSObject.Properties.Count -gt 0 -and -not ($Data -is [System.Collections.IEnumerable])) {
        $id = [System.Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($Data)
        if ($Seen.ContainsKey($id)) { return '[Circular]' }
        $Seen[$id] = $true
        $out = [ordered]@{}
        foreach ($prop in $Data.PSObject.Properties) {
            if (Test-StructLogIsSecretFieldName -Name $prop.Name -Pattern $AllowList.SecretPattern) {
                $out[$prop.Name] = '[REDACTED]'
            } else {
                $out[$prop.Name] = ConvertTo-StructLogRedactedData -Data $prop.Value -AllowList $AllowList -Seen $Seen
            }
        }
        return $out
    }
    if ($Data -is [System.Collections.IEnumerable]) {
        $list = @()
        foreach ($item in $Data) {
            $list += (ConvertTo-StructLogRedactedData -Data $item -AllowList $AllowList -Seen $Seen)
        }
        return ,$list
    }
    return ([string] $Data)
}

function ConvertTo-StructLogJson {
    [CmdletBinding()]
    param($Record)
    # ConvertTo-Json -Compress -Depth 8 — one record per line.
    return ($Record | ConvertTo-Json -Compress -Depth 8)
}

# --- Logger factory --------------------------------------------------------

function Get-StructLogDefaultLogRoot {
    if ($env:LOG_ROOT) { return $env:LOG_ROOT }
    return (Join-Path -Path (Get-Location).Path -ChildPath 'logs')
}

function New-StructLogger {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('coordinator', 'streaming-server', 'viewer', 'scripts')]
        [string] $Service,

        [Parameter(Mandatory = $true)]
        [string] $Component,

        [string] $LogRoot,
        [string] $RunId,
        [string] $InitialTraceId,
        [datetime] $Now,
        [int] $BufferLimit = $script:DefaultBufferLimit,
        [string] $AllowListPath,
        [switch] $SkipEnvSnapshot,
        # When set, NEVER attempt to write to a file sink (tests use this to
        # avoid touching disk while still exercising the in-memory logic).
        [switch] $InMemoryOnly,
        # Records emitted by the logger are pushed here if provided (tests).
        $RecordSink
    )
    if (-not $Now) { $Now = (Get-Date).ToUniversalTime() }
    if (-not $RunId) { $RunId = New-StructLogRunId -Now $Now }
    if ($RunId -notmatch $script:RunIdPattern) {
        throw "Invalid run id: $RunId — must match $($script:RunIdPattern)"
    }
    if (-not $LogRoot) { $LogRoot = Get-StructLogDefaultLogRoot }
    if (-not $InitialTraceId) {
        $envTrace = $env:BIM_TRACE_ID
        $InitialTraceId = if ($envTrace) { $envTrace } else { "script_$RunId" }
    }
    $allow = Get-StructLogAllowList -Path $AllowListPath

    $state = [pscustomobject]@{
        Service = $Service
        Component = $Component
        RunId = $RunId
        LogRoot = $LogRoot
        TraceId = $InitialTraceId
        CurrentDate = (Get-StructLogIsoTimestamp -Now $Now).Substring(0, 10)
        CurrentFile = ''
        RecordsWritten = 0
        RecordsDropped = 0
        LastFailure = $null
        SeqByTrace = @{}
        Buffer = New-Object 'System.Collections.Generic.Queue[psobject]'
        BufferLimit = $BufferLimit
        AllowList = $allow
        NowProvider = { (Get-Date).ToUniversalTime() }.GetNewClosure()
        Closed = $false
        InMemoryOnly = [bool] $InMemoryOnly
        RecordSink = $RecordSink
    }
    $state.CurrentFile = _Get-StructLogFilePath -State $state -DateDir $state.CurrentDate
    if (-not $state.InMemoryOnly) {
        _Ensure-StructLogDir -Path (Split-Path -Parent $state.CurrentFile) | Out-Null
    }

    # Attach a frozen clock when caller provided $Now explicitly.
    if ($PSBoundParameters.ContainsKey('Now')) {
        $frozen = $Now
        $state.NowProvider = { $frozen }.GetNewClosure()
    }

    # PowerShell logger objects: PSCustomObject augmented with NoteProperty Sentinels
    # so the consumer can chain via pipeline ($logger | Write-StructInfo ...).
    Add-Member -InputObject $state -MemberType ScriptMethod -Name 'GetSeq' -Value {
        param([string] $TraceId)
        $next = ($this.SeqByTrace[$TraceId] | ForEach-Object { $_ }) + 1
        if (-not $next) { $next = 1 }
        $this.SeqByTrace[$TraceId] = $next
        return $next
    }

    if (-not $SkipEnvSnapshot) {
        $vars = @()
        $envTable = [Environment]::GetEnvironmentVariables()
        foreach ($key in ($envTable.Keys | Sort-Object)) {
            $vars += (Get-RedactedEnvVar -Key $key -Value $envTable[$key] -Source 'system' -AllowList $allow)
        }
        Write-StructEnvSnapshot -Logger $state -Vars $vars
    }
    return $state
}

# --- Path helpers (private; prefix _ to discourage direct use) ------------

function _Get-StructLogFilePath {
    param($State, [string] $DateDir)
    return (Join-Path $State.LogRoot (Join-Path $State.Service (Join-Path $DateDir "$($State.Service)-$($State.RunId).jsonl")))
}

function _Ensure-StructLogDir {
    param([string] $Path)
    try {
        if (-not (Test-Path -LiteralPath $Path)) {
            New-Item -ItemType Directory -Force -Path $Path | Out-Null
        }
        return $true
    } catch {
        return $false
    }
}

function _Push-StructLogBuffer {
    param($State, $Record)
    $State.Buffer.Enqueue($Record)
    while ($State.Buffer.Count -gt $State.BufferLimit) { [void] $State.Buffer.Dequeue() }
}

function _Build-StructLogRecord {
    param(
        $State,
        [string] $Level,
        [string] $EventType,
        [string] $Component,
        [string] $Msg,
        $Data,
        [hashtable] $Extras = @{}
    )
    if (-not ($script:ValidLevels -contains $Level)) {
        throw "Invalid level: $Level"
    }
    $now = & $State.NowProvider
    $ts = Get-StructLogIsoTimestamp -Now $now
    $traceId = if ($Extras.ContainsKey('TraceId')) { $Extras['TraceId'] } else { $State.TraceId }
    if (-not $traceId) { $traceId = "script_$($State.RunId)" }
    $seq = $State.GetSeq($traceId)
    $dataForRedaction = if ($null -eq $Data) { @{} } else { $Data }
    $safeData = ConvertTo-StructLogRedactedData -Data $dataForRedaction -AllowList $State.AllowList
    if ($null -eq $safeData) { $safeData = [ordered]@{} }
    $record = [ordered]@{
        ts = $ts
        level = $Level
        event_type = $EventType
        service = $State.Service
        component = $Component
        run_id = $State.RunId
        trace_id = $traceId
        msg = $Msg
        data = $safeData
        seq = $seq
    }
    if ($Extras.ContainsKey('Caller')) { $record['caller'] = $Extras['Caller'] }
    if ($Extras.ContainsKey('ErrorObj')) { $record['error'] = $Extras['ErrorObj'] }
    if ($Extras.ContainsKey('ParentTraceId')) { $record['parent_trace_id'] = $Extras['ParentTraceId'] }
    return $record
}

function _Write-StructLogRecord {
    param($State, $Record)
    if ($State.Closed) { return }
    $dateDir = $Record.ts.Substring(0, 10)
    if ($dateDir -ne $State.CurrentDate) {
        $State.CurrentDate = $dateDir
        $State.CurrentFile = _Get-StructLogFilePath -State $State -DateDir $dateDir
        if (-not $State.InMemoryOnly) {
            _Ensure-StructLogDir -Path (Split-Path -Parent $State.CurrentFile) | Out-Null
        }
    }
    $line = ConvertTo-StructLogJson -Record $Record
    if ($State.RecordSink) {
        & $State.RecordSink $Record
    }
    # stdout is opt-in for PowerShell — we use Write-Host so it stays out of
    # the pipeline (Write-Output would contaminate downstream piping).
    try { [Console]::Out.WriteLine($line) } catch { }
    if ($State.InMemoryOnly) {
        $State.RecordsWritten += 1
        return
    }
    try {
        if (-not (_Ensure-StructLogDir -Path (Split-Path -Parent $State.CurrentFile))) {
            throw "mkdir failed"
        }
        Add-Content -LiteralPath $State.CurrentFile -Value $line -Encoding UTF8
        $State.RecordsWritten += 1
    } catch {
        $reason = $_.Exception.Message
        try {
            $recoveryDir = Join-Path $State.LogRoot (Join-Path $State.Service '_recovery')
            if (_Ensure-StructLogDir -Path $recoveryDir) {
                $recoveryFile = Join-Path $recoveryDir "$($State.CurrentDate)-$($State.RunId).jsonl"
                Add-Content -LiteralPath $recoveryFile -Value $line -Encoding UTF8
                $State.RecordsWritten += 1
                $State.LastFailure = [pscustomobject]@{ ts = (Get-StructLogIsoTimestamp -Now (& $State.NowProvider)); reason = "$reason (recovered)" }
                return
            }
        } catch { }
        $State.RecordsDropped += 1
        $State.LastFailure = [pscustomobject]@{ ts = (Get-StructLogIsoTimestamp -Now (& $State.NowProvider)); reason = $reason }
        _Push-StructLogBuffer -State $State -Record $Record
        try { [Console]::Error.WriteLine("[structLog sink failed: $reason] $line") } catch { }
    }
}

# --- Public Write- helpers -------------------------------------------------

function _Write-StructLogGeneric {
    param($Logger, [string] $Level, [string] $EventType, [string] $Component, [string] $Msg, $Data, [hashtable] $Extras = @{})
    $rec = _Build-StructLogRecord -State $Logger -Level $Level -EventType $EventType -Component $Component -Msg $Msg -Data $Data -Extras $Extras
    _Write-StructLogRecord -State $Logger -Record $rec
}

function Write-StructDebug {
    [CmdletBinding()]
    param([Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger, [string] $Component, [string] $Msg, $Data)
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        _Write-StructLogGeneric -Logger $Logger -Level 'debug' -EventType 'general' -Component $comp -Msg $Msg -Data $Data
    }
}
function Write-StructInfo {
    [CmdletBinding()]
    param([Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger, [string] $Component, [string] $Msg, $Data)
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        _Write-StructLogGeneric -Logger $Logger -Level 'info' -EventType 'general' -Component $comp -Msg $Msg -Data $Data
    }
}
function Write-StructWarn {
    [CmdletBinding()]
    param([Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger, [string] $Component, [string] $Msg, $Data)
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        _Write-StructLogGeneric -Logger $Logger -Level 'warn' -EventType 'general' -Component $comp -Msg $Msg -Data $Data
    }
}

function _ClassifyError {
    param($ErrorRecord)
    if ($null -eq $ErrorRecord) { return [ordered]@{ name = 'NoError'; message = ''; stack_tail = @() } }
    if ($ErrorRecord -is [System.Management.Automation.ErrorRecord]) {
        $stack = @()
        if ($ErrorRecord.ScriptStackTrace) {
            $stack = $ErrorRecord.ScriptStackTrace -split "`r?`n" | Select-Object -First 8 | ForEach-Object { $_.Trim() }
        }
        $name = if ($ErrorRecord.Exception) { $ErrorRecord.Exception.GetType().Name } else { 'Exception' }
        $msg = if ($ErrorRecord.Exception) { $ErrorRecord.Exception.Message } else { [string] $ErrorRecord }
        return [ordered]@{ name = $name; message = $msg; stack_tail = $stack }
    }
    if ($ErrorRecord -is [System.Exception]) {
        $stack = @()
        if ($ErrorRecord.StackTrace) {
            $stack = $ErrorRecord.StackTrace -split "`r?`n" | Select-Object -First 8 | ForEach-Object { $_.Trim() }
        }
        return [ordered]@{ name = $ErrorRecord.GetType().Name; message = $ErrorRecord.Message; stack_tail = $stack }
    }
    return [ordered]@{ name = 'NonErrorThrown'; message = [string] $ErrorRecord; stack_tail = @() }
}

function Write-StructError {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger,
        [string] $Component,
        [string] $Msg,
        $ErrorRecord,
        $Data
    )
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        $classified = _ClassifyError $ErrorRecord
        $merged = if ($Data) { $Data } else { @{} }
        if ($merged -is [hashtable]) { $merged['error'] = $classified }
        else { $merged = @{ error = $classified } }
        _Write-StructLogGeneric -Logger $Logger -Level 'error' -EventType 'logic_error' `
            -Component $comp -Msg $Msg -Data $merged -Extras @{
                ErrorObj = $classified
                Caller = if ($classified.stack_tail.Count -gt 0) { $classified.stack_tail[0] } else { $null }
            }
    }
}

function Write-StructFatal {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger,
        [string] $Component,
        [string] $Msg,
        $ErrorRecord,
        $Data
    )
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        $classified = _ClassifyError $ErrorRecord
        $merged = if ($Data) { $Data } else { @{} }
        if ($merged -is [hashtable]) { $merged['error'] = $classified }
        else { $merged = @{ error = $classified } }
        _Write-StructLogGeneric -Logger $Logger -Level 'fatal' -EventType 'logic_error' `
            -Component $comp -Msg $Msg -Data $merged -Extras @{
                ErrorObj = $classified
                Caller = if ($classified.stack_tail.Count -gt 0) { $classified.stack_tail[0] } else { $null }
            }
    }
}

function Write-StructNetwork {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger,
        [string] $Component,
        [string] $Msg,
        [hashtable] $Data,
        [ValidateSet('debug', 'info', 'warn', 'error', 'fatal')] [string] $Level = 'info'
    )
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        _Write-StructLogGeneric -Logger $Logger -Level $Level -EventType 'network' `
            -Component $comp -Msg $Msg -Data $Data
    }
}

function Write-StructAudit {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger,
        [string] $Component,
        [string] $Msg,
        [hashtable] $Data,
        [ValidateSet('debug', 'info', 'warn', 'error', 'fatal')] [string] $Level = 'info'
    )
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        _Write-StructLogGeneric -Logger $Logger -Level $Level -EventType 'audit' `
            -Component $comp -Msg $Msg -Data $Data
    }
}

function Write-StructLifecycle {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger,
        [string] $Component,
        [string] $Msg,
        [hashtable] $Data,
        [ValidateSet('debug', 'info', 'warn', 'error', 'fatal')] [string] $Level = 'info'
    )
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        _Write-StructLogGeneric -Logger $Logger -Level $Level -EventType 'lifecycle' `
            -Component $comp -Msg $Msg -Data $Data
    }
}

function Write-StructAnomaly {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger,
        [string] $Component,
        [string] $Msg,
        [hashtable] $Data,
        [ValidateSet('debug', 'info', 'warn', 'error', 'fatal')] [string] $Level = 'warn'
    )
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        _Write-StructLogGeneric -Logger $Logger -Level $Level -EventType 'operation_anomaly' `
            -Component $comp -Msg $Msg -Data $Data
    }
}

function Write-StructEnvSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true, Mandatory = $true)] $Logger,
        $Vars,
        [string] $Component
    )
    process {
        $comp = if ($Component) { $Component } else { $Logger.Component }
        if (-not $Vars) {
            $Vars = @()
            $allow = $Logger.AllowList
            $envTable = [Environment]::GetEnvironmentVariables()
            foreach ($key in ($envTable.Keys | Sort-Object)) {
                $Vars += (Get-RedactedEnvVar -Key $key -Value $envTable[$key] -Source 'system' -AllowList $allow)
            }
        }
        _Write-StructLogGeneric -Logger $Logger -Level 'info' -EventType 'env_snapshot' `
            -Component $comp -Msg 'env snapshot' -Data @{ vars = $Vars }
    }
}

function Set-StructLogTraceId {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Logger,
        [Parameter(Mandatory = $true)] [string] $TraceId
    )
    $Logger.TraceId = $TraceId
}

Export-ModuleMember -Function `
    New-StructLogger, Set-StructLogTraceId, `
    Write-StructDebug, Write-StructInfo, Write-StructWarn, `
    Write-StructError, Write-StructFatal, `
    Write-StructNetwork, Write-StructAudit, Write-StructLifecycle, Write-StructAnomaly, `
    Write-StructEnvSnapshot, `
    New-StructLogRunId, Get-StructLogIsoTimestamp, Get-RedactedEnvVar, `
    ConvertTo-StructLogRedactedData, ConvertTo-StructLogJson, `
    Get-StructLogAllowList, Reset-StructLogAllowList
