[CmdletBinding()]
param(
    [string] $RepoRoot = '',
    [string] $ResultPath = '',
    [string] $TargetCommit = 'HEAD',
    [int] $MaxAgeHours = 24,
    [switch] $AllowUntrackedArtifacts,
    [switch] $SkipGitBinding
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
} else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    $ResultPath = Join-Path $RepoRoot 'artifacts\e2e\functional-runtime\functional-runtime-result.json'
}

function Assert-FunctionalResult {
    param([Parameter(Mandatory = $true)][bool] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "[functional-runtime-gate] $Message" }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $LiteralPath).Hash.ToLowerInvariant()
}

function Resolve-FunctionalArtifact {
    param([Parameter(Mandatory = $true)][string] $RelativePath)
    Assert-FunctionalResult ($RelativePath -match '^artifacts/e2e/functional-runtime/') "artifact must stay under artifacts/e2e/functional-runtime/: $RelativePath"
    $absolute = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $RelativePath))
    $artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot 'artifacts/e2e/functional-runtime'))
    $artifactPrefix = $artifactRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    Assert-FunctionalResult ($absolute.StartsWith($artifactPrefix, [System.StringComparison]::OrdinalIgnoreCase)) "artifact escaped functional/runtime evidence root: $RelativePath"
    return $absolute
}

function Assert-BoundedRegularArtifact {
    param(
        [Parameter(Mandatory = $true)][string] $LiteralPath,
        [Parameter(Mandatory = $true)][long] $MaxBytes,
        [Parameter(Mandatory = $true)][string] $Label
    )
    Assert-FunctionalResult (Test-Path -LiteralPath $LiteralPath -PathType Leaf) "$Label file is missing."
    $item = Get-Item -Force -LiteralPath $LiteralPath
    Assert-FunctionalResult (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "$Label cannot be a reparse point."
    Assert-FunctionalResult ($item.Length -gt 0 -and $item.Length -le $MaxBytes) "$Label exceeded its byte budget."
    return $item
}

function Get-PngUInt32 {
    param([Parameter(Mandatory = $true)][byte[]] $Bytes, [Parameter(Mandatory = $true)][int] $Offset)
    return [uint32]((([uint32]$Bytes[$Offset]) -shl 24) -bor
        (([uint32]$Bytes[$Offset + 1]) -shl 16) -bor
        (([uint32]$Bytes[$Offset + 2]) -shl 8) -bor
        ([uint32]$Bytes[$Offset + 3]))
}

function Assert-FunctionalScreenshot {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)
    $null = Assert-BoundedRegularArtifact -LiteralPath $LiteralPath -MaxBytes (16MB) -Label 'screenshot'
    [byte[]]$bytes = [System.IO.File]::ReadAllBytes($LiteralPath)
    [byte[]]$signature = @(137, 80, 78, 71, 13, 10, 26, 10)
    Assert-FunctionalResult ($bytes.Length -ge 45) 'screenshot is not a complete PNG.'
    for ($index = 0; $index -lt $signature.Length; $index++) {
        Assert-FunctionalResult ($bytes[$index] -eq $signature[$index]) 'screenshot PNG signature is invalid.'
    }

    $offset = 8
    $chunkCount = 0
    $seenIhdr = $false
    $seenIdat = $false
    $seenIend = $false
    [uint32]$width = 0
    [uint32]$height = 0
    while ($offset -lt $bytes.Length) {
        Assert-FunctionalResult (($bytes.Length - $offset) -ge 12) 'screenshot PNG chunk is truncated.'
        [uint32]$length = Get-PngUInt32 -Bytes $bytes -Offset $offset
        Assert-FunctionalResult ($length -le 16MB) 'screenshot PNG chunk exceeded its byte budget.'
        [long]$nextOffset = [long]$offset + 12L + [long]$length
        Assert-FunctionalResult ($nextOffset -le $bytes.Length) 'screenshot PNG chunk length is invalid.'
        $type = [System.Text.Encoding]::ASCII.GetString($bytes, $offset + 4, 4)
        Assert-FunctionalResult ($type -match '^[A-Za-z]{4}$') 'screenshot PNG chunk type is invalid.'
        $chunkCount++
        Assert-FunctionalResult ($chunkCount -le 4096) 'screenshot PNG has too many chunks.'

        if ($chunkCount -eq 1) {
            Assert-FunctionalResult ($type -eq 'IHDR' -and $length -eq 13) 'screenshot PNG must begin with IHDR.'
            $seenIhdr = $true
            $width = Get-PngUInt32 -Bytes $bytes -Offset ($offset + 8)
            $height = Get-PngUInt32 -Bytes $bytes -Offset ($offset + 12)
            Assert-FunctionalResult ($width -gt 0 -and $height -gt 0 -and $width -le 8192 -and $height -le 16384) 'screenshot PNG dimensions are invalid or unbounded.'
            Assert-FunctionalResult (([uint64]$width * [uint64]$height) -le 32000000) 'screenshot PNG pixel budget was exceeded.'
        } elseif ($type -eq 'IHDR') {
            Assert-FunctionalResult $false 'screenshot PNG contains duplicate IHDR.'
        }
        if ($type -eq 'IDAT') { $seenIdat = $true }
        if ($type -eq 'IEND') {
            Assert-FunctionalResult ($length -eq 0 -and $nextOffset -eq $bytes.Length) 'screenshot PNG IEND is invalid.'
            $seenIend = $true
        }
        $offset = [int]$nextOffset
    }
    Assert-FunctionalResult ($seenIhdr -and $seenIdat -and $seenIend) 'screenshot PNG is missing a required chunk.'

    try {
        Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop
        $stream = [System.IO.MemoryStream]::new($bytes, $false)
        try {
            $image = [System.Drawing.Image]::FromStream($stream, $false, $true)
            try {
                Assert-FunctionalResult ($image.Width -eq $width -and $image.Height -eq $height) 'screenshot decoded dimensions do not match IHDR.'
            } finally {
                $image.Dispose()
            }
        } finally {
            $stream.Dispose()
        }
    } catch {
        throw "[functional-runtime-gate] screenshot PNG cannot be decoded: $($_.Exception.Message)"
    }
}

function Get-ZipExternalAttributes {
    param([Parameter(Mandatory = $true)] $Entry)
    return [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes([int]$Entry.ExternalAttributes), 0)
}

function Read-TraceJsonLines {
    param(
        [Parameter(Mandatory = $true)] $Entry,
        [Parameter(Mandatory = $true)][string] $Label,
        [Parameter(Mandatory = $true)][scriptblock] $OnRecord
    )
    $stream = $Entry.Open()
    try {
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.UTF8Encoding]::new($false, $true), $true, 4096, $true)
        try {
            $lineCount = 0
            while (-not $reader.EndOfStream) {
                $line = $reader.ReadLine()
                $lineCount++
                Assert-FunctionalResult ($lineCount -le 100000 -and $line.Length -le 1MB) "$Label JSONL exceeded its line budget."
                Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace($line)) "$Label JSONL contains an empty line."
                try {
                    $record = $line | ConvertFrom-Json -Depth 100
                } catch {
                    throw "[functional-runtime-gate] $Label contains invalid JSONL."
                }
                & $OnRecord $record
            }
            Assert-FunctionalResult ($lineCount -gt 0) "$Label is empty."
        } finally {
            $reader.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Assert-FunctionalTrace {
    param(
        [Parameter(Mandatory = $true)][string] $LiteralPath,
        [Parameter(Mandatory = $true)][object[]] $ExpectedRequests
    )
    $null = Assert-BoundedRegularArtifact -LiteralPath $LiteralPath -MaxBytes (64MB) -Label 'trace'
    Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    try {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($LiteralPath)
    } catch {
        throw "[functional-runtime-gate] trace is not a valid ZIP archive."
    }
    try {
        $entries = @($archive.Entries)
        Assert-FunctionalResult ($entries.Count -ge 2 -and $entries.Count -le 2048) 'trace ZIP entry count is invalid or unbounded.'
        [long]$totalLength = 0
        $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $entries) {
            $name = [string]$entry.FullName
            Assert-FunctionalResult ($name.Length -gt 0 -and $name.Length -le 512 -and $name -notmatch '[\\\x00]' -and $name -notmatch '^(?:/|[A-Za-z]:)') 'trace ZIP entry path is invalid.'
            $segments = @($name.Split('/'))
            Assert-FunctionalResult ($segments.Count -gt 0 -and @($segments | Where-Object { $_ -in @('', '.', '..') }).Count -eq 0) 'trace ZIP entry escaped its archive root.'
            Assert-FunctionalResult ($names.Add($name)) 'trace ZIP contains a case-insensitive duplicate path.'
            $attributes = Get-ZipExternalAttributes -Entry $entry
            $unixType = ($attributes -shr 16) -band 0xF000
            Assert-FunctionalResult ($unixType -ne 0xA000 -and ($attributes -band 0x400) -eq 0) 'trace ZIP contains a link or reparse entry.'
            Assert-FunctionalResult ($entry.Length -ge 0 -and $entry.Length -le 16MB) 'trace ZIP entry exceeded its byte budget.'
            $totalLength += $entry.Length
            Assert-FunctionalResult ($totalLength -le 128MB) 'trace ZIP exceeded its aggregate byte budget.'
            if ($entry.Length -gt 0) {
                Assert-FunctionalResult ($entry.CompressedLength -gt 0 -and ([double]$entry.Length / [double]$entry.CompressedLength) -le 200) 'trace ZIP compression ratio is invalid or unbounded.'
            }
        }

        $traceEntries = @($entries | Where-Object { $_.FullName -match '^(?<prefix>(?:[0-9]+-)?)trace\.trace$' })
        Assert-FunctionalResult ($traceEntries.Count -gt 0 -and $traceEntries.Count -le 16) 'trace ZIP must contain bounded Playwright trace data.'
        $traceState = @{ has_context = $false; has_before = $false; has_after = $false }
        foreach ($entry in $traceEntries) {
            Read-TraceJsonLines -Entry $entry -Label $entry.FullName -OnRecord {
                param($record)
                if ([string]$record.type -eq 'context-options' -and [int]$record.version -gt 0 -and [string]$record.playwrightVersion -match '^\d+\.\d+\.\d+(?:[-+].*)?$') { $traceState.has_context = $true }
                if ([string]$record.type -eq 'before' -and -not [string]::IsNullOrWhiteSpace([string]$record.callId)) { $traceState.has_before = $true }
                if ([string]$record.type -eq 'after' -and -not [string]::IsNullOrWhiteSpace([string]$record.callId)) { $traceState.has_after = $true }
            }
        }
        Assert-FunctionalResult ($traceState.has_context -and $traceState.has_before -and $traceState.has_after) 'trace ZIP lacks required Playwright context/action records.'

        $observedRequests = [System.Collections.Generic.List[string]]::new()
        foreach ($traceEntry in $traceEntries) {
            $prefix = [regex]::Match($traceEntry.FullName, '^(?<prefix>(?:[0-9]+-)?)trace\.trace$').Groups['prefix'].Value
            $networkEntry = @($entries | Where-Object FullName -eq "${prefix}trace.network")
            Assert-FunctionalResult ($networkEntry.Count -eq 1) "trace ZIP is missing the network stream for $($traceEntry.FullName)."
            Read-TraceJsonLines -Entry $networkEntry[0] -Label $networkEntry[0].FullName -OnRecord {
                param($record)
                if ([string]$record.type -ne 'resource-snapshot') { return }
                $request = $record.snapshot.request
                $response = $record.snapshot.response
                $uri = $null
                if ([uri]::TryCreate([string]$request.url, [System.UriKind]::Absolute, [ref]$uri) -and
                    [string]$request.method -match '^(GET|POST|PUT|PATCH|DELETE)$' -and
                    [int]$response.status -ge 100 -and [int]$response.status -le 599) {
                    $observedRequests.Add("$([string]$request.method)|$($uri.AbsolutePath)|$([int]$response.status)")
                }
            }
        }
        Assert-FunctionalResult ($observedRequests.Count -gt 0) 'trace ZIP contains no bounded Playwright network observations.'
        foreach ($expected in $ExpectedRequests) {
            $key = "$([string]$expected.method)|$([string]$expected.path)|$([int]$expected.response_status)"
            $index = $observedRequests.IndexOf($key)
            Assert-FunctionalResult ($index -ge 0) "trace ZIP is missing declared backend observation: $key"
            $observedRequests.RemoveAt($index)
        }
    } finally {
        $archive.Dispose()
    }
}

Assert-FunctionalResult (Test-Path -LiteralPath $ResultPath -PathType Leaf) "functional/runtime result not found: $ResultPath"
$result = Get-Content -LiteralPath $ResultPath -Raw | ConvertFrom-Json

Assert-FunctionalResult ($result.schema_version -eq 1) 'schema_version must be 1.'
Assert-FunctionalResult ($result.kind -eq 'ai-bim-functional-runtime-result') 'kind is invalid.'
Assert-FunctionalResult ($result.status -eq 'passed') 'status must be passed.'
Assert-FunctionalResult ($result.skipped -is [bool] -and $result.skipped -eq $false) 'skipped evidence cannot pass the functional/runtime gate.'
Assert-FunctionalResult ($result.blocked -is [bool] -and $result.blocked -eq $false) 'blocked evidence cannot pass the functional/runtime gate.'
Assert-FunctionalResult ($result.workspace_clean -is [bool] -and $result.workspace_clean -eq $true) 'result must be produced from a clean subject commit.'
Assert-FunctionalResult ([string]$result.subject_commit -match '^[0-9a-f]{40}$') 'subject_commit must be a full lowercase 40-character commit SHA.'
Assert-FunctionalResult ([string]$result.route -match '^#[a-z0-9][a-z0-9-]*(?:\?.*)?$') 'route must be an exact hash route.'
$scopeProperty = $result.PSObject.Properties['scope']
Assert-FunctionalResult ($null -ne $scopeProperty -and [string]$scopeProperty.Value -match '^[a-z0-9]+(?:_[a-z0-9]+)*$') 'scope must name the exact exercised slice.'
$fullRouteCoverageProperty = $result.PSObject.Properties['full_route_coverage']
Assert-FunctionalResult ($null -ne $fullRouteCoverageProperty -and $fullRouteCoverageProperty.Value -is [bool]) 'full_route_coverage must be a boolean.'
$knownGapsProperty = $result.PSObject.Properties['known_gaps']
Assert-FunctionalResult ($null -ne $knownGapsProperty) 'known_gaps is required.'
$knownGaps = @($knownGapsProperty.Value)
if (-not [bool]$fullRouteCoverageProperty.Value) {
    Assert-FunctionalResult ($knownGaps.Count -gt 0) 'partial route evidence must list known_gaps.'
    foreach ($knownGap in $knownGaps) {
        Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$knownGap)) 'known_gaps cannot contain an empty entry.'
    }
}
Assert-FunctionalResult (@($result.main_buttons_tested).Count -gt 0) 'main_buttons_tested must name at least one tested action.'
Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$result.fixture)) 'fixture must identify the exercised input.'
Assert-FunctionalResult ([string]$result.e2e_command -match '(?i)playwright|gstack|browser') 'e2e_command must identify the browser verification command.'

$generatedAt = [datetimeoffset]::MinValue
Assert-FunctionalResult ([datetimeoffset]::TryParse([string]$result.generated_at_utc, [ref]$generatedAt)) 'generated_at_utc is invalid.'
$age = [datetimeoffset]::UtcNow - $generatedAt.ToUniversalTime()
Assert-FunctionalResult ($age.TotalMinutes -ge -5) 'generated_at_utc is unreasonably in the future.'
Assert-FunctionalResult ($age.TotalHours -le $MaxAgeHours) "functional/runtime result is older than $MaxAgeHours hours."

$requests = @($result.backend_api.requests)
Assert-FunctionalResult ($requests.Count -gt 0) 'backend_api.requests must contain at least one observed request.'
foreach ($request in $requests) {
    Assert-FunctionalResult ([string]$request.method -match '^(GET|POST|PUT|PATCH|DELETE)$') 'backend API request method is invalid.'
    Assert-FunctionalResult ([string]$request.path -match '^/api/') "backend API path must stay behind the coordinator proxy: $($request.path)"
    Assert-FunctionalResult ([int]$request.response_status -ge 100 -and [int]$request.response_status -le 599) 'backend API response status is invalid.'
}
Assert-FunctionalResult ([int]$result.backend_api.browser_direct_runtime_port_requests -eq 0) 'browser made a forbidden direct runtime-port request.'

$runtimeBoundary = $result.PSObject.Properties['runtime_boundary']
Assert-FunctionalResult ($null -ne $runtimeBoundary) 'runtime_boundary is required.'
Assert-FunctionalResult ([string]$runtimeBoundary.Value.coordinator -eq 'real') 'runtime_boundary.coordinator must be real; browser API mocks cannot pass.'
Assert-FunctionalResult ([string]$runtimeBoundary.Value.conversion_authority -in @('live', 'stub_external_conversion')) 'runtime_boundary.conversion_authority is invalid.'
Assert-FunctionalResult ([string]$runtimeBoundary.Value.live_gpu -in @('observed', 'not_observed')) 'runtime_boundary.live_gpu is invalid.'
if ([string]$runtimeBoundary.Value.conversion_authority -eq 'stub_external_conversion') {
    Assert-FunctionalResult ([string]$runtimeBoundary.Value.live_gpu -eq 'not_observed') 'stub external conversion evidence cannot claim live GPU observation.'
}

if ([string]$result.route -eq '#conv') {
    $requestPaths = @($requests | ForEach-Object { [string]$_.path })
    Assert-FunctionalResult ('/api/external/ifc-ready' -in $requestPaths) '#conv evidence must exercise the real coordinator queue route.'
    Assert-FunctionalResult ('/api/dev/conversions' -in $requestPaths) '#conv evidence must exercise the coordinator conversion-history proxy.'
    Assert-FunctionalResult (@($requestPaths | Where-Object { $_ -match '^/api/dev/conversions/[^/]+/result$' }).Count -gt 0) '#conv evidence must exercise the coordinator conversion-result proxy.'
}

$runtimeActions = @($result.runtime_actions)
Assert-FunctionalResult ($runtimeActions.Count -gt 0) 'runtime_actions must contain at least one observed action.'
foreach ($runtimeAction in $runtimeActions) {
    Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$runtimeAction.action)) 'runtime action name is missing.'
    Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$runtimeAction.runtime_id_type)) 'runtime ID type is missing.'
    Assert-FunctionalResult ([string]$runtimeAction.runtime_id -match '^[A-Za-z0-9][A-Za-z0-9_.:-]+$') 'runtime ID is missing or invalid.'
}

foreach ($stateName in @('loading', 'success', 'failure', 'retry')) {
    $stateProperty = $result.visible_states.PSObject.Properties[$stateName]
    Assert-FunctionalResult ($null -ne $stateProperty -and $stateProperty.Value.observed -is [bool] -and $stateProperty.Value.observed -eq $true) "visible state '$stateName' was not observed."
}

$artifacts = @($result.artifacts)
Assert-FunctionalResult ($artifacts.Count -eq 2) 'artifacts must contain exactly one screenshot and one trace.'
$roles = @($artifacts | ForEach-Object { [string]$_.role })
Assert-FunctionalResult (@($roles | Sort-Object -Unique).Count -eq 2 -and 'screenshot' -in $roles -and 'trace' -in $roles) 'screenshot and trace roles must be unique.'
foreach ($artifact in $artifacts) {
    $relativePath = [string]$artifact.path
    $absolutePath = Resolve-FunctionalArtifact -RelativePath $relativePath
    Assert-FunctionalResult (Test-Path -LiteralPath $absolutePath -PathType Leaf) "artifact file is missing: $relativePath"
    Assert-FunctionalResult ([string]$artifact.sha256 -match '^[0-9a-f]{64}$') "artifact SHA-256 is invalid: $relativePath"
    Assert-FunctionalResult ((Get-Sha256 -LiteralPath $absolutePath) -eq [string]$artifact.sha256) "artifact SHA-256 does not match: $relativePath"
    if (-not $AllowUntrackedArtifacts) {
        & git -C $RepoRoot -c "safe.directory=$RepoRoot" ls-files --error-unmatch -- $relativePath *> $null
        Assert-FunctionalResult ($LASTEXITCODE -eq 0) "artifact is not tracked: $relativePath"
    }
}
$screenshotArtifact = @($artifacts | Where-Object role -eq 'screenshot')[0]
$traceArtifact = @($artifacts | Where-Object role -eq 'trace')[0]
Assert-FunctionalResult ([string]$screenshotArtifact.path -eq 'artifacts/e2e/functional-runtime/conv-history.png') 'screenshot artifact path is not canonical.'
Assert-FunctionalResult ([string]$traceArtifact.path -eq 'artifacts/e2e/functional-runtime/conv-history-trace.zip') 'trace artifact path is not canonical.'
Assert-FunctionalScreenshot -LiteralPath (Resolve-FunctionalArtifact -RelativePath ([string]$screenshotArtifact.path))
Assert-FunctionalTrace -LiteralPath (Resolve-FunctionalArtifact -RelativePath ([string]$traceArtifact.path)) -ExpectedRequests $requests

if ($null -ne $result.kit_runtime) {
    Assert-FunctionalResult ($result.kit_runtime.first_frame_observed -is [bool] -and $result.kit_runtime.first_frame_observed -eq $true) 'Kit first-frame evidence is required.'
    Assert-FunctionalResult (-not [string]::IsNullOrWhiteSpace([string]$result.kit_runtime.stage_id)) 'Kit stage ID is required.'
    Assert-FunctionalResult ($result.kit_runtime.datachannel_ack_observed -is [bool] -and $result.kit_runtime.datachannel_ack_observed -eq $true) 'Kit DataChannel acknowledgement evidence is required.'
}

if (-not $SkipGitBinding) {
    $resolvedTarget = @(& git -C $RepoRoot -c "safe.directory=$RepoRoot" rev-parse --verify "${TargetCommit}^{commit}" 2>$null)
    Assert-FunctionalResult ($LASTEXITCODE -eq 0 -and $resolvedTarget.Count -eq 1) "target commit '$TargetCommit' does not exist."
    $TargetCommit = $resolvedTarget[0].Trim()
    Assert-FunctionalResult ([string]$result.subject_commit -eq $TargetCommit) "result subject_commit must equal target commit '$TargetCommit'."
    & git -C $RepoRoot -c "safe.directory=$RepoRoot" diff --quiet $TargetCommit --
    Assert-FunctionalResult ($LASTEXITCODE -eq 0) "tracked working tree differs from target commit '$TargetCommit'."
}

Write-Host "[functional-runtime-gate] passed — route=$($result.route), scope=$($scopeProperty.Value), full_route_coverage=$($fullRouteCoverageProperty.Value), runtime_actions=$($runtimeActions.Count), artifacts=$($artifacts.Count)"
