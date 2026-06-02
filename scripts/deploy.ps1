# scripts\deploy.ps1
# Mode C(hybrid)一鍵部屬入口。
# 對應 docs/superpowers/specs/2026-05-26-one-click-deploy-design.md。
#
# Mode A 入口:scripts\start-all.ps1(完全不動)
# Mode B 入口:scripts\start-runtime-manager-docker.ps1(完全不動)
# Mode C 入口:本檔
#
# 使用:
#   .\scripts\deploy.ps1                          # 全自動 hybrid 部屬(預設 LAN demo host:192.168.10.105)
#   .\scripts\deploy.ps1 -DryRun                  # 只看 fix plan,不動真實狀態
#   .\scripts\deploy.ps1 -Force                   # 互動 guard 全部視同 y
#   .\scripts\deploy.ps1 -Build                   # 強制 docker compose build
#   .\scripts\deploy.ps1 -PublicHost 127.0.0.1    # 覆蓋公開位址(例如只做本機 demo)
#   .\scripts\deploy.ps1 -SkipKit                 # 不啟 host-native Kit(viewer 沒畫面)

[CmdletBinding()]
param(
    [switch] $DryRun,
    [switch] $Force,
    [switch] $Build,
    [switch] $Pull,
    [string] $EnvFile = '',
    [switch] $SkipKit,
    [switch] $SkipConversion,
    [switch] $SkipDocker,
    [string] $PublicHost = '',
    [string] $ConversionBindHost = '',
    [int]    $KitSignalPort = 49100,
    [int]    $KitMediaPort  = 47998,
    [int]    $SpectatorCount = 5,
    [int]    $KitSpectatorSignalPortStart = 49110,
    [int]    $KitSpectatorMediaPortStart = 48008,
    [int]    $KitSpectatorPortStride = 10,
    [switch] $StrictPostVerify
)

Set-StrictMode -Version Latest
# spectator port sequence 上限常數(避免 magic number 散落在驗證/解析兩處)
$script:MaxSpectatorCount = 32
# Continue(非 Stop):docker / docker compose 進度寫 stderr,PowerShell 5.1 native
# command 對 stderr 在 Stop policy 下會被 promote 成 terminating error。我們改用
# $LASTEXITCODE 主動檢查,native cmd stderr 只當訊息看。
$ErrorActionPreference = 'Continue'
$script:DeployStart = Get-Date

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$RunDir   = Join-Path $RepoRoot 'scripts\.run'
$LogPath  = Join-Path $RunDir   'deploy.log'
$script:DefaultPublicHost = '192.168.10.105'

# Import lib modules
$libDir = Join-Path $PSScriptRoot 'lib'
. (Join-Path $libDir 'deploy-report.ps1')
. (Join-Path $libDir 'preflight-docker.ps1')
. (Join-Path $libDir 'preflight-host-native.ps1')
. (Join-Path $libDir 'preflight-env.ps1')
. (Join-Path $libDir 'preflight-ports.ps1')
. (Join-Path $libDir 'preflight-volume-alignment.ps1')
. (Join-Path $libDir 'host-native-launcher.ps1')
. (Join-Path $libDir 'kit-log-probe.ps1')

if (-not (Test-Path -LiteralPath $RunDir)) {
    New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
}

# 提前宣告以下 script-scope 變數,Print-FinalSummary 才能用
$script:resolvedEnvFile = ''
$script:volume = $null
$script:coordinatorPublicUrl = ''
$script:viewerPublicUrl = ''
$script:conversionRuntimeSignaturePath = Join-Path $RunDir 'bim-streaming-conversion-service.params.json'
$script:kitRuntimeSignaturePath = Join-Path $RunDir 'bim-streaming-server.params.json'

# ============================================================
# Helper: Print-FinalSummary(在 Phase 1 之前定義,讓任何階段都可呼叫)
# ============================================================
function Print-FinalSummary {
    param([int] $ExitCode, [string] $FailedPhase)
    $elapsed = (Get-Date) - $script:DeployStart
    Write-Host ''
    Write-Host '=== Deploy Summary ===' -ForegroundColor Cyan
    Write-Host "Mode:         hybrid (web-plane Docker + host-native Kit)"
    Write-Host ("Elapsed:      {0:N0}m {1:N0}s" -f $elapsed.TotalMinutes, $elapsed.Seconds)
    if ($script:resolvedEnvFile) { Write-Host "EnvFile:      $($script:resolvedEnvFile)" }
    if ($script:volume -and $script:volume.runtimeStorageRoot) {
        Write-Host "Storage root: $($script:volume.runtimeStorageRoot) ($($script:volume.status))"
    }
    if ($ExitCode -eq 0) {
        Write-Host ''
        Write-Host 'Next:' -ForegroundColor Green
        $coordinatorUrl = if ($script:coordinatorPublicUrl) { $script:coordinatorPublicUrl } else { 'http://127.0.0.1:8004' }
        $viewerUrl = if ($script:viewerPublicUrl) { $script:viewerPublicUrl } else { 'http://127.0.0.1:5173' }
        Write-Host "  > open $coordinatorUrl/ui            (coordinator UI / WebRTC entry)"
        Write-Host "  > viewer base: $viewerUrl"
        Write-Host '  > tail scripts\.run\bim-streaming-server.log -Wait'
        Write-Host '  > stop all:'
        Write-Host '      docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit down'
        Write-Host '      .\scripts\stop-all.ps1'
    } else {
        Write-Host ''
        Write-Host "Status: FAILED (exit $ExitCode, $FailedPhase)" -ForegroundColor Red
        Write-Host 'What might be running (NOT auto-rolled-back):'
        foreach ($pidFile in Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
            $procId = (Get-Content $pidFile.FullName | Select-Object -First 1).Trim()
            Write-Host "  > $($pidFile.BaseName) PID $procId"
        }
        Write-Host ''
        Write-Host 'To recover:'
        Write-Host '  > .\scripts\stop-all.ps1'
        Write-Host '  > docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit down'
        Write-Host '  > re-run: .\scripts\deploy.ps1 -Force'
    }
}

function Get-DeployEnvValue {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $EnvFile,
        [string] $Default = ''
    )
    if (-not [string]::IsNullOrWhiteSpace($EnvFile) -and (Test-Path -LiteralPath $EnvFile)) {
        $fileValue = Get-EnvExampleDefaultValue -Path $EnvFile -Key $Name
        if (-not [string]::IsNullOrWhiteSpace($fileValue)) { return $fileValue.Trim() }
    }
    $envValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue.Trim() }
    return $Default
}

function Test-DeployValueConfigured {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $EnvFile
    )
    $value = Get-DeployEnvValue -Name $Name -EnvFile $EnvFile -Default ''
    return (-not [string]::IsNullOrWhiteSpace($value))
}

function Resolve-DeployIntValue {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $EnvFile,
        [Parameter(Mandatory = $true)][int] $Default,
        [int] $ExplicitValue = 0,
        [switch] $HasExplicitValue,
        [int] $Min = 0,
        [int] $Max = 65535
    )
    $raw = if ($HasExplicitValue) { [string]$ExplicitValue } else { Get-DeployEnvValue -Name $Name -EnvFile $EnvFile -Default ([string]$Default) }
    $parsed = 0
    if (-not [int]::TryParse($raw, [ref]$parsed)) {
        throw "$Name must be an integer: $raw"
    }
    if ($parsed -lt $Min -or $parsed -gt $Max) {
        throw "$Name must be between $Min and ${Max}: $parsed"
    }
    return $parsed
}

function Resolve-HostNameOnly {
    param([Parameter(Mandatory = $true)][string] $Value)
    $trimmed = $Value.Trim()
    if ($trimmed -match '^https?://') {
        $hostValue = ([uri]$trimmed).Host
        if ($hostValue -match ':' -and -not $hostValue.StartsWith('[')) {
            return "[$hostValue]"
        }
        return $hostValue
    }
    if ($trimmed -match '[/\?#@]') {
        throw "PUBLIC_HOST must be a host or IP only; do not include a path, query, fragment, or credentials."
    }
    if ($trimmed -match ':' -and -not ($trimmed.StartsWith('[') -and $trimmed.EndsWith(']'))) {
        throw "PUBLIC_HOST must not include a port. Use COORDINATOR_PUBLIC_BASE_URL / VIEWER_PUBLIC_BASE_URL for custom ports or paths."
    }
    return $trimmed
}

function Test-LoopbackHost {
    param([Parameter(Mandatory = $true)][string] $HostName)
    $normalized = (Resolve-HostNameOnly -Value $HostName).Trim([char[]]'[]').ToLowerInvariant()
    return ($normalized -eq 'localhost' -or $normalized -eq '::1' -or $normalized.StartsWith('127.'))
}

function Resolve-DeployPublicBaseUrl {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $EnvFile,
        [Parameter(Mandatory = $true)][string] $HostName,
        [Parameter(Mandatory = $true)][int] $Port,
        [switch] $PreferDerived
    )
    $configured = ''
    if (-not [string]::IsNullOrWhiteSpace($EnvFile) -and (Test-Path -LiteralPath $EnvFile)) {
        $configured = Get-EnvExampleDefaultValue -Path $EnvFile -Key $Name
    }
    if ([string]::IsNullOrWhiteSpace($configured) -and -not $PreferDerived) {
        $configured = [Environment]::GetEnvironmentVariable($Name)
    }
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        $trimmed = $configured.Trim().TrimEnd('/')
        if (-not ($trimmed -match '^https?://')) {
            throw "$Name must be an absolute http(s) URL."
        }
        return $trimmed
    }
    return "http://${HostName}:$Port"
}

function Resolve-DeployOrigin {
    param([Parameter(Mandatory = $true)][string] $BaseUrl)
    $uri = [uri]$BaseUrl
    if (-not $uri.IsAbsoluteUri -or -not ($uri.Scheme -eq 'http' -or $uri.Scheme -eq 'https')) {
        throw "Base URL must be an absolute http(s) URL: $BaseUrl"
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
}

function Resolve-DeployCorsOrigins {
    param(
        [Parameter(Mandatory = $true)][string] $EnvFile,
        [Parameter(Mandatory = $true)][string] $ViewerPublicBaseUrl
    )
    $configured = Get-DeployEnvValue -Name 'CORS_ORIGINS' -EnvFile $EnvFile -Default ''
    $values = @(
        'http://127.0.0.1:5173',
        'http://localhost:5173'
    )
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        $values += @($configured -split ',')
    }
    $values += (Resolve-DeployOrigin -BaseUrl $ViewerPublicBaseUrl)

    $seen = @{}
    $result = @()
    foreach ($value in $values) {
        $normalized = $value.Trim().TrimEnd('/')
        if ([string]::IsNullOrWhiteSpace($normalized)) { continue }
        $key = $normalized.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $result += $normalized
    }
    return ($result -join ',')
}

function Resolve-HealthProbeHost {
    param([Parameter(Mandatory = $true)][string] $BindHost)
    $hostName = Resolve-HostNameOnly -Value $BindHost
    $normalized = $hostName.Trim([char[]]'[]').ToLowerInvariant()
    if ($normalized -eq '0.0.0.0' -or $normalized -eq '::' -or $normalized -eq '[::]') {
        return '127.0.0.1'
    }
    if (Test-LoopbackHost -HostName $hostName) {
        return '127.0.0.1'
    }
    return $hostName
}

function Format-DeployHostPort {
    param(
        [Parameter(Mandatory = $true)][string] $HostName,
        [Parameter(Mandatory = $true)][int] $Port
    )
    $hostOnly = (Resolve-HostNameOnly -Value $HostName).Trim([char[]]'[]').ToLowerInvariant()
    return ("{0}:{1}" -f $hostOnly, $Port)
}

function Resolve-AllowedStageHosts {
    param(
        [Parameter(Mandatory = $true)][string] $EnvFile,
        [Parameter(Mandatory = $true)][string] $PublicHost,
        [Parameter(Mandatory = $true)][int] $ConversionPort
    )
    $configured = Get-DeployEnvValue -Name 'BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS' -EnvFile $EnvFile -Default ''
    $values = if ([string]::IsNullOrWhiteSpace($configured)) {
        Write-Warning "BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS 未設定，使用內建預設 stage allowed-hosts (127.0.0.1:$ConversionPort, localhost:$ConversionPort)。"
        @(
            ("127.0.0.1:{0}" -f $ConversionPort),
            ("localhost:{0}" -f $ConversionPort)
        )
    } else {
        @($configured -split ',')
    }
    $values += (Format-DeployHostPort -HostName $PublicHost -Port $ConversionPort)

    $seen = @{}
    $result = @()
    foreach ($value in $values) {
        $normalized = $value.Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($normalized)) { continue }
        if ($seen.ContainsKey($normalized)) { continue }
        $seen[$normalized] = $true
        $result += $normalized
    }
    return ($result -join ',')
}

function New-PortSequence {
    param(
        [Parameter(Mandatory = $true)][int] $Count,
        [Parameter(Mandatory = $true)][int] $Start,
        [Parameter(Mandatory = $true)][int] $Stride,
        [Parameter(Mandatory = $true)][string] $Name
    )
    if ($Count -lt 0 -or $Count -gt $script:MaxSpectatorCount) { throw "$Name count must be between 0 and $($script:MaxSpectatorCount)." }
    if ($Stride -lt 1) { throw "$Name stride must be >= 1." }
    $ports = @()
    for ($i = 0; $i -lt $Count; $i++) {
        $port = $Start + ($i * $Stride)
        if ($port -lt 1 -or $port -gt 65535) { throw "$Name generated port outside 1-65535: $port" }
        if ($ports -contains $port) { throw "$Name generated duplicate port: $port" }
        $ports += [int]$port
    }
    return $ports
}

function Assert-NoSpectatorPortCollisions {
    param(
        [Parameter(Mandatory = $true)][int[]] $SpectatorSignalPorts,
        [Parameter(Mandatory = $true)][int[]] $SpectatorMediaPorts,
        [Parameter(Mandatory = $true)][int] $PrimarySignalPort,
        [Parameter(Mandatory = $true)][int] $PrimaryMediaPort
    )
    if ($SpectatorSignalPorts -contains $PrimarySignalPort) {
        throw "KIT_SPECTATOR_SIGNALING_PORT generated a port that conflicts with primary Kit signaling port: $PrimarySignalPort"
    }
    if ($SpectatorMediaPorts -contains $PrimaryMediaPort) {
        throw "KIT_SPECTATOR_MEDIA_PORT generated a port that conflicts with primary Kit media port: $PrimaryMediaPort"
    }
    foreach ($port in $SpectatorSignalPorts) {
        if ($SpectatorMediaPorts -contains $port) {
            throw "KIT_SPECTATOR_* generated overlapping signaling/media port: $port"
        }
    }
}

function Test-WebPlaneRefreshRequired {
    param(
        [switch] $Build,
        [switch] $PublicHostExplicit,
        [string] $ConversionBindHost,
        [string] $ResolvedPublicHost,
        [int] $SpectatorCount,
        [Parameter(Mandatory = $true)][string] $EnvFile
    )
    if ($Build -or $PublicHostExplicit) { return $true }
    if (-not [string]::IsNullOrWhiteSpace($ConversionBindHost)) { return $true }
    if (-not (Test-LoopbackHost -HostName $ResolvedPublicHost)) { return $true }
    if ($SpectatorCount -gt 0) { return $true }

    $topologyEnvNames = @(
        'VIEWER_BIND_HOST',
        'KIT_SIGNALING_HOST',
        'KIT_MEDIA_HOST',
        'WEB_VIEWER_COORDINATOR_API_BASE',
        'WEB_VIEWER_COORDINATOR_SOCKET_URL',
        'VIEWER_PUBLIC_BASE_URL',
        'COORDINATOR_PUBLIC_BASE_URL'
    )
    foreach ($name in $topologyEnvNames) {
        if (Test-DeployValueConfigured -Name $name -EnvFile $EnvFile) { return $true }
    }
    return $false
}

function New-KitRuntimeSignature {
    param(
        [Parameter(Mandatory = $true)][string] $PublicHost,
        [Parameter(Mandatory = $true)][int] $SignalPort,
        [Parameter(Mandatory = $true)][int] $StreamPort,
        [Parameter(Mandatory = $true)][int[]] $SpectatorSignalPorts,
        [Parameter(Mandatory = $true)][int[]] $SpectatorStreamPorts,
        [Parameter(Mandatory = $true)][string] $AllowedStageHosts
    )
    return ([pscustomobject]@{
        publicHost           = $PublicHost
        signalPort           = $SignalPort
        streamPort           = $StreamPort
        spectatorSignalPorts = @($SpectatorSignalPorts)
        spectatorStreamPorts = @($SpectatorStreamPorts)
        allowedStageHosts    = $AllowedStageHosts
    } | ConvertTo-Json -Compress)
}

function New-ConversionRuntimeSignature {
    param(
        [Parameter(Mandatory = $true)][string] $BindHost,
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)][string] $HealthHost,
        [string] $PublicArtifactsUrl = ''
    )
    return ([pscustomobject]@{
        bindHost           = $BindHost
        port               = $Port
        healthHost         = $HealthHost
        publicArtifactsUrl = $PublicArtifactsUrl
    } | ConvertTo-Json -Compress)
}

function Test-KitRuntimeSignatureMatches {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Expected
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $actual = (Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue).Trim()
    return ($actual -eq $Expected)
}

function Set-KitRuntimeSignature {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Value
    )
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $Value | Set-Content -LiteralPath $Path -Encoding ascii
}

function Set-DeployEnvIfNeeded {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Value,
        [switch] $Force,
        [Parameter(Mandatory = $true)][string] $EnvFile
    )
    if ($Force -or -not (Test-DeployValueConfigured -Name $Name -EnvFile $EnvFile)) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
    }
}

# ============================================================
# Phase 1: Preflight (read-only audit)
# ============================================================
Write-DeployHeader -Title 'Phase 1: Preflight (read-only)'

$docker     = Test-DockerEnvironment       -RepoRoot $RepoRoot
$hostNative = Test-HostNativeEnvironment   -RepoRoot $RepoRoot
$envFiles   = Test-EnvFiles                -RepoRoot $RepoRoot
$resolvedEnvFile = if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    # $docker.envFile 解析順序(見 preflight-docker.ps1 Test-DockerEnvironment):
    #   real .env.web-plane.host-kit 存在 → '.env.web-plane.host-kit'
    #   只有 .example 存在             → '.env.web-plane.host-kit.example'(dev/demo fallback,發 Warning)
    #   兩者皆無                       → $null(throw,不把不存在的 --env-file 往後傳)
    if ($docker.envFile -eq '.env.web-plane.host-kit.example') {
        Write-Warning '.env.web-plane.host-kit not found; falling back to .example — dev/demo only, set production values in a real .env'
        $docker.envFile
    } elseif ($docker.envFile) {
        $docker.envFile
    } else {
        throw "env_file_missing: .env.web-plane.host-kit / .env.web-plane.host-kit.example not found in repo root ($RepoRoot)"
    }
} else { $EnvFile }
$script:resolvedEnvFile = $resolvedEnvFile
$resolvedPublicHostRaw = if (-not [string]::IsNullOrWhiteSpace($PublicHost)) {
    $PublicHost
} else {
    Get-DeployEnvValue -Name 'PUBLIC_HOST' -EnvFile $resolvedEnvFile -Default $script:DefaultPublicHost
}
$resolvedPublicHost = Resolve-HostNameOnly -Value $resolvedPublicHostRaw
$resolvedCoordinatorPort = Resolve-DeployIntValue -Name 'COORDINATOR_PORT' -EnvFile $resolvedEnvFile -Default 8004 -Min 1 -Max 65535
$resolvedViewerPort = Resolve-DeployIntValue -Name 'VIEWER_PORT' -EnvFile $resolvedEnvFile -Default 5173 -Min 1 -Max 65535
$resolvedKitSignalPort = Resolve-DeployIntValue `
    -Name 'KIT_SIGNALING_PORT' `
    -EnvFile $resolvedEnvFile `
    -Default 49100 `
    -ExplicitValue $KitSignalPort `
    -HasExplicitValue:($PSBoundParameters.ContainsKey('KitSignalPort')) `
    -Min 1 `
    -Max 65535
$resolvedKitMediaPort = Resolve-DeployIntValue `
    -Name 'KIT_MEDIA_PORT' `
    -EnvFile $resolvedEnvFile `
    -Default 47998 `
    -ExplicitValue $KitMediaPort `
    -HasExplicitValue:($PSBoundParameters.ContainsKey('KitMediaPort')) `
    -Min 1 `
    -Max 65535
$resolvedSpectatorCount = Resolve-DeployIntValue `
    -Name 'KIT_SPECTATOR_COUNT' `
    -EnvFile $resolvedEnvFile `
    -Default 5 `
    -ExplicitValue $SpectatorCount `
    -HasExplicitValue:($PSBoundParameters.ContainsKey('SpectatorCount')) `
    -Min 0 `
    -Max $script:MaxSpectatorCount
$resolvedSpectatorSignalStart = Resolve-DeployIntValue `
    -Name 'KIT_SPECTATOR_SIGNALING_PORT_START' `
    -EnvFile $resolvedEnvFile `
    -Default 49110 `
    -ExplicitValue $KitSpectatorSignalPortStart `
    -HasExplicitValue:($PSBoundParameters.ContainsKey('KitSpectatorSignalPortStart')) `
    -Min 1 `
    -Max 65535
$resolvedSpectatorMediaStart = Resolve-DeployIntValue `
    -Name 'KIT_SPECTATOR_MEDIA_PORT_START' `
    -EnvFile $resolvedEnvFile `
    -Default 48008 `
    -ExplicitValue $KitSpectatorMediaPortStart `
    -HasExplicitValue:($PSBoundParameters.ContainsKey('KitSpectatorMediaPortStart')) `
    -Min 1 `
    -Max 65535
$resolvedSpectatorStride = Resolve-DeployIntValue `
    -Name 'KIT_SPECTATOR_PORT_STRIDE' `
    -EnvFile $resolvedEnvFile `
    -Default 10 `
    -ExplicitValue $KitSpectatorPortStride `
    -HasExplicitValue:($PSBoundParameters.ContainsKey('KitSpectatorPortStride')) `
    -Min 1 `
    -Max 1000
$resolvedSpectatorSignalPorts = @(New-PortSequence -Count $resolvedSpectatorCount -Start $resolvedSpectatorSignalStart -Stride $resolvedSpectatorStride -Name 'KIT_SPECTATOR_SIGNALING_PORT')
$resolvedSpectatorMediaPorts = @(New-PortSequence -Count $resolvedSpectatorCount -Start $resolvedSpectatorMediaStart -Stride $resolvedSpectatorStride -Name 'KIT_SPECTATOR_MEDIA_PORT')
Assert-NoSpectatorPortCollisions `
    -SpectatorSignalPorts $resolvedSpectatorSignalPorts `
    -SpectatorMediaPorts $resolvedSpectatorMediaPorts `
    -PrimarySignalPort $resolvedKitSignalPort `
    -PrimaryMediaPort $resolvedKitMediaPort
$isPublicHostExplicit = -not [string]::IsNullOrWhiteSpace($PublicHost)
$resolvedConversionBindHost = if (-not [string]::IsNullOrWhiteSpace($ConversionBindHost)) {
    $ConversionBindHost.Trim()
} elseif (Test-LoopbackHost -HostName $resolvedPublicHost) {
    '127.0.0.1'
} else {
    '0.0.0.0'
}
$shouldDerivePublicTopologyValues = $isPublicHostExplicit -or (-not (Test-LoopbackHost -HostName $resolvedPublicHost))
$shouldRefreshWebPlane = Test-WebPlaneRefreshRequired `
    -Build:$Build `
    -PublicHostExplicit:$isPublicHostExplicit `
    -ConversionBindHost $ConversionBindHost `
    -ResolvedPublicHost $resolvedPublicHost `
    -SpectatorCount $resolvedSpectatorCount `
    -EnvFile $resolvedEnvFile
$resolvedConversionHealthHost = Resolve-HealthProbeHost -BindHost $resolvedConversionBindHost
$resolvedAllowedStageHosts = Resolve-AllowedStageHosts -EnvFile $resolvedEnvFile -PublicHost $resolvedPublicHost -ConversionPort 49101
$kitRuntimeSignature = New-KitRuntimeSignature `
    -PublicHost $resolvedPublicHost `
    -SignalPort $resolvedKitSignalPort `
    -StreamPort $resolvedKitMediaPort `
    -SpectatorSignalPorts $resolvedSpectatorSignalPorts `
    -SpectatorStreamPorts $resolvedSpectatorMediaPorts `
    -AllowedStageHosts $resolvedAllowedStageHosts
$script:coordinatorPublicUrl = Resolve-DeployPublicBaseUrl -Name 'COORDINATOR_PUBLIC_BASE_URL' -EnvFile $resolvedEnvFile -HostName $resolvedPublicHost -Port $resolvedCoordinatorPort -PreferDerived:$shouldDerivePublicTopologyValues
$script:viewerPublicUrl = Resolve-DeployPublicBaseUrl -Name 'VIEWER_PUBLIC_BASE_URL' -EnvFile $resolvedEnvFile -HostName $resolvedPublicHost -Port $resolvedViewerPort -PreferDerived:$shouldDerivePublicTopologyValues
$resolvedCorsOrigins = Resolve-DeployCorsOrigins -EnvFile $resolvedEnvFile -ViewerPublicBaseUrl $script:viewerPublicUrl

[Environment]::SetEnvironmentVariable('PUBLIC_HOST', $resolvedPublicHost, 'Process')
[Environment]::SetEnvironmentVariable('KIT_SIGNALING_PORT', [string]$resolvedKitSignalPort, 'Process')
[Environment]::SetEnvironmentVariable('KIT_MEDIA_PORT', [string]$resolvedKitMediaPort, 'Process')
[Environment]::SetEnvironmentVariable('KIT_SPECTATOR_COUNT', [string]$resolvedSpectatorCount, 'Process')
[Environment]::SetEnvironmentVariable('KIT_SPECTATOR_SIGNALING_PORT_START', [string]$resolvedSpectatorSignalStart, 'Process')
[Environment]::SetEnvironmentVariable('KIT_SPECTATOR_MEDIA_PORT_START', [string]$resolvedSpectatorMediaStart, 'Process')
[Environment]::SetEnvironmentVariable('KIT_SPECTATOR_PORT_STRIDE', [string]$resolvedSpectatorStride, 'Process')
Set-DeployEnvIfNeeded -Name 'VIEWER_BIND_HOST' -Value ($(if (Test-LoopbackHost -HostName $resolvedPublicHost) { '127.0.0.1' } else { '0.0.0.0' })) -Force:$shouldDerivePublicTopologyValues -EnvFile $resolvedEnvFile
Set-DeployEnvIfNeeded -Name 'KIT_SIGNALING_HOST' -Value $resolvedPublicHost -Force:$shouldDerivePublicTopologyValues -EnvFile $resolvedEnvFile
Set-DeployEnvIfNeeded -Name 'KIT_MEDIA_HOST' -Value $resolvedPublicHost -Force:$shouldDerivePublicTopologyValues -EnvFile $resolvedEnvFile
Set-DeployEnvIfNeeded -Name 'WEB_VIEWER_COORDINATOR_API_BASE' -Value $script:coordinatorPublicUrl -Force:$shouldDerivePublicTopologyValues -EnvFile $resolvedEnvFile
Set-DeployEnvIfNeeded -Name 'WEB_VIEWER_COORDINATOR_SOCKET_URL' -Value $script:coordinatorPublicUrl -Force:$shouldDerivePublicTopologyValues -EnvFile $resolvedEnvFile
Set-DeployEnvIfNeeded -Name 'VIEWER_PUBLIC_BASE_URL' -Value $script:viewerPublicUrl -Force:$shouldDerivePublicTopologyValues -EnvFile $resolvedEnvFile
Set-DeployEnvIfNeeded -Name 'COORDINATOR_PUBLIC_BASE_URL' -Value $script:coordinatorPublicUrl -Force:$shouldDerivePublicTopologyValues -EnvFile $resolvedEnvFile
Set-DeployEnvIfNeeded -Name 'STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL' -Value "http://${resolvedPublicHost}:49101/artifacts" -Force:$shouldDerivePublicTopologyValues -EnvFile $resolvedEnvFile
[Environment]::SetEnvironmentVariable('CORS_ORIGINS', $resolvedCorsOrigins, 'Process')
[Environment]::SetEnvironmentVariable('BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS', $resolvedAllowedStageHosts, 'Process')
$resolvedConversionPublicArtifactsUrl = [Environment]::GetEnvironmentVariable('STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL')
$conversionRuntimeSignature = New-ConversionRuntimeSignature `
    -BindHost $resolvedConversionBindHost `
    -Port 49101 `
    -HealthHost $resolvedConversionHealthHost `
    -PublicArtifactsUrl $resolvedConversionPublicArtifactsUrl

$ports = Test-PortAvailability -RepoRoot $RepoRoot -KitSignalPort $resolvedKitSignalPort -KitMediaPort $resolvedKitMediaPort -ExtraHostNativePorts $resolvedSpectatorSignalPorts -ExtraHostNativeUdpPorts $resolvedSpectatorMediaPorts
$volume = Test-VolumeAlignment -RepoRoot $RepoRoot -EnvFile $resolvedEnvFile
$script:volume = $volume

# Audit summary 印出
function Report-Audit {
    if ($docker.cliVersion)   { Write-DeployTag -Tag 'ok'   -Message "docker cli=$($docker.cliVersion)" -LogPath $LogPath | Out-Null }
    else                      { Write-DeployTag -Tag 'fail' -Message 'docker CLI not found (install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/)' -LogPath $LogPath | Out-Null }
    if ($docker.composeV2)    { Write-DeployTag -Tag 'ok'   -Message 'docker compose v2' -LogPath $LogPath | Out-Null }
    else                      { Write-DeployTag -Tag 'fail' -Message 'docker compose v2 missing' -LogPath $LogPath | Out-Null }
    if ($docker.engineRunning){ Write-DeployTag -Tag 'ok'   -Message 'docker engine running' -LogPath $LogPath | Out-Null }
    else                      { Write-DeployTag -Tag 'fail' -Message 'docker engine not running (start Docker Desktop and wait until tray icon settles)' -LogPath $LogPath | Out-Null }
    if ($docker.envFile)      { Write-DeployTag -Tag 'ok'   -Message "envFile=$($docker.envFile)" -LogPath $LogPath | Out-Null }
    else                      { Write-DeployTag -Tag 'fail' -Message '.env.web-plane.host-kit / .example not found in repo root' -LogPath $LogPath | Out-Null }

    foreach ($key in @('venv','kitLauncher','nvidiaDriver')) {
        $st = $hostNative.$key
        if ($st -eq 'OK')      { Write-DeployTag -Tag 'ok'   -Message "host-native $key=$st" -LogPath $LogPath | Out-Null }
        elseif ($st -eq 'MISSING') {
            if ($key -eq 'venv')          { Write-DeployTag -Tag 'fix'  -Message "host-native venv MISSING (will create via python -m venv in Phase 2)" -LogPath $LogPath | Out-Null }
            elseif ($key -eq 'nvidiaDriver') { Write-DeployTag -Tag 'fail' -Message 'nvidia-smi missing (install NVIDIA driver)' -LogPath $LogPath | Out-Null }
        }
        elseif ($st -eq 'WRONG_VERSION'){ Write-DeployTag -Tag 'ask'  -Message "host-native venv WRONG_VERSION (Phase 3 will ask)" -LogPath $LogPath | Out-Null }
        elseif ($st -eq 'MISSING_PATH') { Write-DeployTag -Tag 'fail' -Message "host-native $key MISSING_PATH (expected: bim-streaming-server\scripts\start-streaming-server.ps1)" -LogPath $LogPath | Out-Null }
    }

    if ($hostNative.venv -eq 'OK') {
        if ($hostNative.pythonDependencies -eq 'OK') {
            Write-DeployTag -Tag 'ok' -Message "host-native pythonDependencies=OK (fastapi=$($hostNative.pythonDependencyFastApi), starlette=$($hostNative.pythonDependencyStarlette), uvicorn=$($hostNative.pythonDependencyUvicorn))" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'fix' -Message "host-native pythonDependencies=$($hostNative.pythonDependencies) ($($hostNative.pythonDependencyReason); Phase 2 will pip install -r bim-streaming-server\requirements.txt)" -LogPath $LogPath | Out-Null
        }
    }

    if ($hostNative.kitRuntime -eq 'OK') {
        Write-DeployTag -Tag 'ok' -Message 'host-native kitRuntime=OK' -LogPath $LogPath | Out-Null
    } elseif ($hostNative.kitRuntime -eq 'NEEDS_BUILD') {
        Write-DeployTag -Tag 'fix' -Message "host-native kitRuntime=NEEDS_BUILD ($($hostNative.kitBuildReason); Phase 2 will run: $($hostNative.kitBuildCommand))" -LogPath $LogPath | Out-Null
    } else {
        Write-DeployTag -Tag 'fail' -Message "host-native kitRuntime=$($hostNative.kitRuntime)" -LogPath $LogPath | Out-Null
    }

    foreach ($ef in $envFiles) {
        if (-not $ef.envExists) {
            Write-DeployTag -Tag 'fix' -Message "$($ef.file) missing (will Copy-Item from .example in Phase 2)" -LogPath $LogPath | Out-Null
        } elseif ($ef.missing.Count -gt 0) {
            Write-DeployTag -Tag 'fix' -Message "$($ef.file) missing keys: $($ef.missing -join ',') (will append default in Phase 2)" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'ok' -Message "$($ef.file) complete" -LogPath $LogPath | Out-Null
        }
    }

    foreach ($p in @($ports.docker) + @($ports.hostNative)) {
        $portLabel = if ($p.protocol) { "$($p.protocol)/$($p.port)" } else { "port $($p.port)" }
        if ($p.status -eq 'FREE') {
            Write-DeployTag -Tag 'ok' -Message "port $portLabel FREE" -LogPath $LogPath | Out-Null
        } elseif ($p.ourPidFile) {
            Write-DeployTag -Tag 'skip' -Message "port $portLabel occupied by our PID $($p.pid) ($($p.name)) — already running, will skip start" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'ask' -Message "port $portLabel occupied by stranger PID $($p.pid) ($($p.name)) — Phase 3 will ask" -LogPath $LogPath | Out-Null
        }
    }

    switch ($volume.status) {
        'ALIGNED'     { Write-DeployTag -Tag 'ok'   -Message "volume aligned root=$($volume.runtimeStorageRoot)" -LogPath $LogPath | Out-Null }
        'MISSING_KEY' { Write-DeployTag -Tag 'fix'  -Message "RUNTIME_STORAGE_ROOT missing in $resolvedEnvFile (will append <RepoRoot>\storage in Phase 2)" -LogPath $LogPath | Out-Null }
        'WRONG_LEAF'  { Write-DeployTag -Tag 'fail' -Message "RUNTIME_STORAGE_ROOT=$($volume.runtimeStorageRoot) leaf=$($volume.leaf) is not 'storage' (host-native conversion-service requires storage/ subdir; fix .env or rename)" -LogPath $LogPath | Out-Null }
    }
}
Report-Audit

# 把 audit 物件序列化進 deploy-audit.json(spec §8.3)
$auditObj = [pscustomobject]@{
    docker      = $docker
    hostNative  = $hostNative
    envFiles    = $envFiles
    ports       = $ports
    volume      = $volume
    envFileUsed = $resolvedEnvFile
    runtime     = [pscustomobject]@{
        publicHost          = $resolvedPublicHost
        coordinatorPublicUrl = $script:coordinatorPublicUrl
        viewerPublicUrl     = $script:viewerPublicUrl
        conversionBindHost  = $resolvedConversionBindHost
        conversionHealthHost = $resolvedConversionHealthHost
        conversionPublicArtifactsUrl = $resolvedConversionPublicArtifactsUrl
        corsOrigins         = $resolvedCorsOrigins
        allowedStageHosts   = $resolvedAllowedStageHosts
        kitSignalPort       = $resolvedKitSignalPort
        kitMediaPort        = $resolvedKitMediaPort
        spectatorCount      = $resolvedSpectatorCount
        spectatorSignalPorts = $resolvedSpectatorSignalPorts
        spectatorMediaPorts  = $resolvedSpectatorMediaPorts
    }
}
$auditObj | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $RunDir 'deploy-audit.json')

# 判斷 hard fail(unfixable)
$hardFails = @()
if (-not $docker.cliVersion)    { $hardFails += 'docker_cli_missing' }
if (-not $docker.composeV2)     { $hardFails += 'docker_compose_v2_missing' }
if (-not $docker.engineRunning) { $hardFails += 'docker_engine_not_running' }
if (-not $docker.envFile)       { $hardFails += 'env_file_missing_entirely' }
if ($hostNative.nvidiaDriver -eq 'MISSING')   { $hardFails += 'nvidia_smi_missing' }
if ($hostNative.kitLauncher -eq 'MISSING_PATH'){ $hardFails += 'kit_launcher_missing' }
if ($volume.status -eq 'WRONG_LEAF')          { $hardFails += 'runtime_storage_root_wrong_leaf' }
if ($DryRun) {
    Write-DeployHeader -Title 'Phase 2: Auto-fix (safe actions)'
    if ($hardFails.Count -gt 0) {
        Write-DeployTag -Tag 'skip' -Message "Phase 2 auto-fix DRY-RUN (hard fails reported: $($hardFails -join ',')); no actions executed" -LogPath $LogPath | Out-Null
    } else {
        Write-DeployTag -Tag 'skip' -Message 'Phase 2 auto-fix DRY-RUN (no actions executed)' -LogPath $LogPath | Out-Null
    }
    Print-FinalSummary -ExitCode 0 -FailedPhase ''
    exit 0
}
if ($hardFails.Count -gt 0) {
    Write-DeployTag -Tag 'fail' -Message "Phase 1 unfixable: $($hardFails -join ',')" -LogPath $LogPath | Out-Null
    Print-FinalSummary -ExitCode 1 -FailedPhase 'Phase 1 preflight'
    exit 1
}

# ============================================================
# Phase 2: Auto-fix
# ============================================================
Write-DeployHeader -Title 'Phase 2: Auto-fix (safe actions)'

$fixActions = 0

function Install-DeployPythonRequirements {
    param(
        [Parameter(Mandatory = $true)][string] $VenvPython,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $LogPath
    )
    $installed = $false
    foreach ($req in @('requirements.txt','bim-streaming-server\requirements.txt')) {
        $reqPath = Join-Path $RepoRoot $req
        if (Test-Path -LiteralPath $reqPath) {
            Write-DeployTag -Tag 'fix' -Message "pip install -r $req" -LogPath $LogPath | Out-Null
            & $VenvPython -m pip install -r $reqPath
            if ($LASTEXITCODE -ne 0) {
                Write-DeployTag -Tag 'fail' -Message "pip install -r $req failed" -LogPath $LogPath | Out-Null
                Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (pip install)'
                exit 2
            }
            $installed = $true
        }
    }
    if (-not $installed) {
        Write-DeployTag -Tag 'fail' -Message 'Python requirements missing (expected requirements.txt or bim-streaming-server\requirements.txt)' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (pip requirements missing)'
        exit 2
    }
}

# fix: .venv
if ($hostNative.venv -eq 'MISSING') {
    Write-DeployTag -Tag 'fix' -Message 'creating .venv via python -m venv' -LogPath $LogPath | Out-Null
    & python -m venv (Join-Path $RepoRoot '.venv')
    if ($LASTEXITCODE -ne 0) {
        Write-DeployTag -Tag 'fail' -Message 'python -m venv failed' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (venv create)'
        exit 2
    }
    $fixActions++
}

if ($hostNative.venv -eq 'MISSING' -or ($hostNative.venv -eq 'OK' -and $hostNative.pythonDependencies -ne 'OK')) {
    $venvPy = Join-Path $RepoRoot '.venv\Scripts\python.exe'
    Install-DeployPythonRequirements -VenvPython $venvPy -RepoRoot $RepoRoot -LogPath $LogPath
    $hostNative = Test-HostNativeEnvironment -RepoRoot $RepoRoot
    if ($hostNative.pythonDependencies -ne 'OK') {
        Write-DeployTag -Tag 'fail' -Message "Python dependencies still not OK after pip install: $($hostNative.pythonDependencies) $($hostNative.pythonDependencyReason)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (python dependencies)'
        exit 2
    }
    Write-DeployTag -Tag 'ok' -Message "Python deps ready (fastapi=$($hostNative.pythonDependencyFastApi), starlette=$($hostNative.pythonDependencyStarlette), uvicorn=$($hostNative.pythonDependencyUvicorn))" -LogPath $LogPath | Out-Null
    $fixActions++
}

# fix: Kit runtime build artifacts — missing _build launcher/kit.exe means start-streaming-server
# would otherwise fail later and deploy.ps1 would wait for Phase 4b timeout.
if (-not $SkipKit -and $hostNative.kitBuildRequired) {
    $kitBuildLog = Join-Path $RunDir 'kit-repo-build.log'
    Write-DeployTag -Tag 'fix' -Message "running bim-streaming-server repo.bat build ($($hostNative.kitBuildReason)) — may take several minutes" -LogPath $LogPath | Out-Null
    Push-Location (Join-Path $RepoRoot 'bim-streaming-server')
    $kitBuildExit = -1  # strict-mode fail-safe:確保失敗路徑仍走到 Final Summary
    try {
        & .\repo.bat build *> $kitBuildLog
        $kitBuildExit = $LASTEXITCODE
    } finally { Pop-Location }
    if ($kitBuildExit -ne 0) {
        Write-DeployTag -Tag 'fail' -Message "Kit repo.bat build failed (see scripts\.run\kit-repo-build.log)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (kit build)'
        exit 2
    }
    $hostNative = Test-HostNativeEnvironment -RepoRoot $RepoRoot
    if ($hostNative.kitRuntime -ne 'OK') {
        Write-DeployTag -Tag 'fail' -Message "Kit build completed but runtime artifacts are still missing: $($hostNative.kitBuildReason)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (kit build artifacts)'
        exit 2
    }
    Write-DeployTag -Tag 'ok' -Message 'Kit runtime build artifacts ready' -LogPath $LogPath | Out-Null
    $fixActions++
}

# fix: .env / .env.example missing-key merge
foreach ($ef in $envFiles) {
    $envPath     = Join-Path $RepoRoot $ef.file
    $examplePath = "$envPath.example"
    if ((-not $ef.envExists) -and $ef.exampleExists) {
        Write-DeployTag -Tag 'fix' -Message "Copy-Item $examplePath -> $envPath" -LogPath $LogPath | Out-Null
        Copy-Item -LiteralPath $examplePath -Destination $envPath -Force
        $fixActions++
        # 若剛 copy 的是 host-kit env,$resolvedEnvFile 要切到真檔(否則後續 volume
        # alignment / rm / build 仍指 .example)
        if ($ef.file -eq '.env.web-plane.host-kit') {
            $resolvedEnvFile = '.env.web-plane.host-kit'
            $script:resolvedEnvFile = $resolvedEnvFile
            $volume = Test-VolumeAlignment -RepoRoot $RepoRoot -EnvFile $resolvedEnvFile
            $script:volume = $volume
        }
    } elseif ($ef.missing.Count -gt 0) {
        Write-DeployTag -Tag 'fix' -Message "appending $($ef.missing.Count) missing keys to $($ef.file)" -LogPath $LogPath | Out-Null
        Add-Content -LiteralPath $envPath -Value ''
        Add-Content -LiteralPath $envPath -Value "# auto-appended by deploy.ps1 (missing-key merge from .env.example)"
        foreach ($k in $ef.missing) {
            # 從 .example 取預設值,支援 KEY=value 與 KEY: value 兩種格式
            $defaultValue = Get-EnvExampleDefaultValue -Path $examplePath -Key $k
            Add-Content -LiteralPath $envPath -Value "$k=$defaultValue"
        }
        $fixActions++
    }
}

# fix: volume — MISSING_KEY → append RUNTIME_STORAGE_ROOT=<RepoRoot>\storage
if ($volume.status -eq 'MISSING_KEY') {
    $envPath = Join-Path $RepoRoot $resolvedEnvFile
    $absStorage = Join-Path $RepoRoot 'storage'
    Write-DeployTag -Tag 'fix' -Message "appending RUNTIME_STORAGE_ROOT=$absStorage to $resolvedEnvFile" -LogPath $LogPath | Out-Null
    Add-Content -LiteralPath $envPath -Value ''
    Add-Content -LiteralPath $envPath -Value "# auto-appended by deploy.ps1 (volume alignment)"
    Add-Content -LiteralPath $envPath -Value "RUNTIME_STORAGE_ROOT=$absStorage"
    # 重新 audit
    $volume = Test-VolumeAlignment -RepoRoot $RepoRoot -EnvFile $resolvedEnvFile
    $script:volume = $volume
    if ($volume.status -ne 'ALIGNED') {
        Write-DeployTag -Tag 'fail' -Message 'volume alignment still not OK after fix' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (volume fix)'
        exit 2
    }
    $fixActions++
}

# fix: 清 stale PID file
foreach ($pidFile in Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($pidFile.Name)
    $removed = Remove-StalePidFile -Name $name -RunDir $RunDir
    if ($removed) {
        Write-DeployTag -Tag 'fix' -Message "removed stale PID file $($pidFile.Name)" -LogPath $LogPath | Out-Null
        $fixActions++
    }
}

# fix: 建本地目錄
foreach ($d in @('scripts\.run', 'logs\nvstreamer', 'storage\ifc-cache')) {
    $abs = Join-Path $RepoRoot $d
    if (-not (Test-Path -LiteralPath $abs)) {
        Write-DeployTag -Tag 'fix' -Message "mkdir $d" -LogPath $LogPath | Out-Null
        New-Item -ItemType Directory -Path $abs -Force | Out-Null
        $fixActions++
    }
}

# 先查 coordinator + viewer 是不是已經 running(idempotent 重跑要避免破壞正常 container)
$webPlaneRunning = $false
if (-not $SkipDocker) {
    $psProbe = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile,'ps','--status','running','-q','coordinator','viewer')
    Push-Location $RepoRoot
    $runningIds = @()  # strict-mode fail-safe:確保失敗路徑仍走到 Final Summary
    try {
        $runningIds = docker @psProbe 2>$null
    } finally { Pop-Location }
    # 兩個 service 都各回一個 container id → 兩行 = web-plane 全 running
    $runningCount = @(($runningIds | Out-String).Trim() -split "`n" | Where-Object { $_.Trim() }).Count
    $webPlaneRunning = $runningCount -ge 2
}

# fix: 容器衝突自動 rm(spec §7.1)— 但 idempotent re-run 時 skip
if (-not $SkipDocker) {
    if ($webPlaneRunning) {
        Write-DeployTag -Tag 'skip' -Message 'docker compose rm: coordinator + viewer already running' -LogPath $LogPath | Out-Null
    } else {
        $rmArgs = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile,'rm','-f','-s','coordinator','viewer')
        Write-DeployTag -Tag 'fix' -Message "docker $($rmArgs -join ' ') (clear any conflicting containers; named volumes preserved)" -LogPath $LogPath | Out-Null
        Push-Location $RepoRoot
        try { docker @rmArgs *> (Join-Path $RunDir 'docker-compose-rm.log') } finally { Pop-Location }
        $fixActions++
    }
}

# fix: 第一次 docker compose build(image 不存在時自動)
if (-not $SkipDocker) {
    # web-plane 已 running 表示 image 必然存在 → skip build(idempotent)
    if ($webPlaneRunning -and -not $Build) {
        Write-DeployTag -Tag 'skip' -Message 'docker compose build: coordinator + viewer already running (image exists)' -LogPath $LogPath | Out-Null
    } else {
        $imageProbe = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile,'images','-q','coordinator','viewer')
        Push-Location $RepoRoot
        try {
            $imageIds = docker @imageProbe 2>$null
        } finally { Pop-Location }
        $hasImages = -not [string]::IsNullOrWhiteSpace(($imageIds | Out-String))

        if ($Build -or -not $hasImages) {
            $why = if ($Build) { 'forced by -Build' } else { 'first time (no image found)' }
            Write-DeployTag -Tag 'fix' -Message "docker compose build coordinator viewer ($why) — may take 3-5 min" -LogPath $LogPath | Out-Null
            $buildArgs = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile,'build','coordinator','viewer')
            Push-Location $RepoRoot
            $buildExit = -1  # strict-mode fail-safe:確保失敗路徑仍走到 Final Summary
            try {
                docker @buildArgs *> (Join-Path $RunDir 'docker-compose-build.log')
                $buildExit = $LASTEXITCODE
            } finally { Pop-Location }
            if ($buildExit -ne 0) {
                Write-DeployTag -Tag 'fail' -Message "docker compose build failed (see scripts\.run\docker-compose-build.log)" -LogPath $LogPath | Out-Null
                Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (docker build)'
                exit 2
            }
            $fixActions++
        }
    }
}

# fix: docker compose pull(opt-in)
if ($Pull -and -not $SkipDocker) {
    Write-DeployTag -Tag 'fix' -Message 'docker compose pull (opt-in)' -LogPath $LogPath | Out-Null
    Push-Location $RepoRoot
    try { docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file $resolvedEnvFile pull } finally { Pop-Location }
    $fixActions++
}

Write-DeployTag -Tag 'ok' -Message "Phase 2 complete ($fixActions actions)" -LogPath $LogPath | Out-Null

# ============================================================
# Phase 3: Interactive guard(動到別人活著的 process 才問)
# ============================================================
Write-DeployHeader -Title 'Phase 3: Interactive guard (dangerous actions)'

# Phase 2 跑了 docker compose rm / build,docker container 與 wslrelay 等 port forwarder
# 狀態可能變動。Re-audit ports 避免用 Phase 1 的 stale 資料問互動。
$ports = Test-PortAvailability -RepoRoot $RepoRoot -KitSignalPort $resolvedKitSignalPort -KitMediaPort $resolvedKitMediaPort -ExtraHostNativePorts $resolvedSpectatorSignalPorts -ExtraHostNativeUdpPorts $resolvedSpectatorMediaPorts

# Docker Desktop 在 Windows 用以下 process 做 container port forward,不是「陌生 PID」:
$dockerForwarderNames = @('wslrelay.exe','com.docker.backend.exe','docker.exe','vpnkit.exe','vpnkit-bridge.exe')

$strangerPortPids = @($ports.docker + $ports.hostNative |
    Where-Object {
        $_.status -eq 'OCCUPIED' `
        -and -not $_.ourPidFile `
        -and ($_.name -notin $dockerForwarderNames)
    })

if ($strangerPortPids.Count -eq 0 -and $hostNative.venv -ne 'WRONG_VERSION') {
    Write-DeployTag -Tag 'ok' -Message 'no dangerous action needed' -LogPath $LogPath | Out-Null
}

foreach ($sp in $strangerPortPids) {
    $portLabel = if ($sp.protocol) { "$($sp.protocol)/$($sp.port)" } else { "port $($sp.port)" }
    $prompt = "port $portLabel occupied by PID $($sp.pid) ($($sp.name)). Stop-Process? (y/N)"
    if ($Force) {
        Write-DeployTag -Tag 'fix' -Message "$prompt -> y (--Force)" -LogPath $LogPath | Out-Null
        Stop-Process -Id $sp.pid -Force -ErrorAction SilentlyContinue
    } else {
        Write-DeployTag -Tag 'ask' -Message $prompt -LogPath $LogPath | Out-Null
        $response = Read-Host 'y/N'
        if ($response -match '^[Yy]') {
            Stop-Process -Id $sp.pid -Force -ErrorAction SilentlyContinue
            Write-DeployTag -Tag 'fix' -Message "killed PID $($sp.pid)" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'fail' -Message "user declined to kill PID $($sp.pid)" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 3 -FailedPhase 'Phase 3 (user declined)'
            exit 3
        }
    }
}

if ($hostNative.venv -eq 'WRONG_VERSION') {
    $prompt = '.venv has wrong Python version (<3.11). Recreate? (will delete .venv) (y/N)'
    if ($Force) {
        Write-DeployTag -Tag 'fix' -Message "$prompt -> y (--Force)" -LogPath $LogPath | Out-Null
        Remove-Item -LiteralPath (Join-Path $RepoRoot '.venv') -Recurse -Force
        & python -m venv (Join-Path $RepoRoot '.venv')
        if ($LASTEXITCODE -ne 0) {
            Write-DeployTag -Tag 'fail' -Message 'python -m venv failed' -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 3 -FailedPhase 'Phase 3 (venv recreate)'
            exit 3
        }
        $venvPy = Join-Path $RepoRoot '.venv\Scripts\python.exe'
        Install-DeployPythonRequirements -VenvPython $venvPy -RepoRoot $RepoRoot -LogPath $LogPath
        $hostNative = Test-HostNativeEnvironment -RepoRoot $RepoRoot
    } else {
        Write-DeployTag -Tag 'ask' -Message $prompt -LogPath $LogPath | Out-Null
        $response = Read-Host 'y/N'
        if ($response -match '^[Yy]') {
            Remove-Item -LiteralPath (Join-Path $RepoRoot '.venv') -Recurse -Force
            & python -m venv (Join-Path $RepoRoot '.venv')
            if ($LASTEXITCODE -ne 0) {
                Write-DeployTag -Tag 'fail' -Message 'python -m venv failed' -LogPath $LogPath | Out-Null
                Print-FinalSummary -ExitCode 3 -FailedPhase 'Phase 3 (venv recreate)'
                exit 3
            }
            $venvPy = Join-Path $RepoRoot '.venv\Scripts\python.exe'
            Install-DeployPythonRequirements -VenvPython $venvPy -RepoRoot $RepoRoot -LogPath $LogPath
            $hostNative = Test-HostNativeEnvironment -RepoRoot $RepoRoot
        } else {
            Write-DeployTag -Tag 'fail' -Message 'user declined .venv recreate' -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 3 -FailedPhase 'Phase 3 (user declined)'
            exit 3
        }
    }
    if ($hostNative.venv -ne 'OK' -or $hostNative.pythonDependencies -ne 'OK') {
        Write-DeployTag -Tag 'fail' -Message "Python environment still not OK after .venv recreate: venv=$($hostNative.venv) deps=$($hostNative.pythonDependencies) $($hostNative.pythonDependencyReason)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 3 -FailedPhase 'Phase 3 (python environment)'
        exit 3
    }
}

# ============================================================
# Phase 4: Start (依賴順序 4a → 4b → 4c)
# ============================================================
Write-DeployHeader -Title 'Phase 4: Start services'

# 4a: host-native conversion-service
if ($SkipConversion) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4a host-native conversion (--SkipConversion)' -LogPath $LogPath | Out-Null
} else {
    $conversionHealthUrl = "http://${resolvedConversionHealthHost}:49101/health"
    $conversionPublicHealthUrl = "http://${resolvedPublicHost}:49101/health"
    $conversionPublicHealthRequired = -not (Test-LoopbackHost -HostName $resolvedPublicHost)
    $conversionAlreadyRunning = Test-AlreadyRunning -Name 'bim-streaming-conversion-service' -RunDir $RunDir
    if ($conversionAlreadyRunning -and -not (Test-KitRuntimeSignatureMatches -Path $script:conversionRuntimeSignaturePath -Expected $conversionRuntimeSignature)) {
        Write-DeployTag -Tag 'fix' -Message 'Phase 4a restarting host-native conversion because runtime parameters changed' -LogPath $LogPath | Out-Null
        Stop-HostNativeService -Name 'bim-streaming-conversion-service' -RunDir $RunDir | Out-Null
        $conversionAlreadyRunning = $false
    }
    if ($conversionAlreadyRunning) {
        if (Wait-HostNativeHealth -Name 'conversion-service' -Url $conversionHealthUrl -TimeoutSec 5) {
            if ($conversionPublicHealthRequired -and -not (Wait-HostNativeHealth -Name 'conversion-service-public' -Url $conversionPublicHealthUrl -TimeoutSec 5)) {
                Write-DeployTag -Tag 'fix' -Message "Phase 4a restarting host-native conversion because public health is unreachable at $conversionPublicHealthUrl" -LogPath $LogPath | Out-Null
                Stop-HostNativeService -Name 'bim-streaming-conversion-service' -RunDir $RunDir | Out-Null
                $conversionAlreadyRunning = $false
            } else {
                Write-DeployTag -Tag 'skip' -Message "Phase 4a host-native conversion already running ($conversionHealthUrl 200)" -LogPath $LogPath | Out-Null
            }
        } else {
            Write-DeployTag -Tag 'fix' -Message "Phase 4a restarting host-native conversion because wrapper is alive but $conversionHealthUrl is unhealthy" -LogPath $LogPath | Out-Null
            Stop-HostNativeService -Name 'bim-streaming-conversion-service' -RunDir $RunDir | Out-Null
            $conversionAlreadyRunning = $false
        }
    }
    if (-not $conversionAlreadyRunning) {
        Write-DeployTag -Tag 'ok' -Message 'Phase 4a starting host-native conversion-service' -LogPath $LogPath | Out-Null
        $startInfo = Start-HostNativeConversion `
            -RepoRoot $RepoRoot `
            -RuntimeStorageRoot $volume.runtimeStorageRoot `
            -BindHost $resolvedConversionBindHost `
            -PublicArtifactsUrl ([Environment]::GetEnvironmentVariable('STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL'))
        Write-DeployTag -Tag 'ok' -Message "conversion PID=$($startInfo.Pid) log=$($startInfo.LogPath)" -LogPath $LogPath | Out-Null
        $ok = Wait-HostNativeHealth -Name 'conversion-service' -Url $conversionHealthUrl -TimeoutSec 30
        if (-not $ok) {
            Write-DeployTag -Tag 'fail' -Message "stage=4a Phase 4a conversion-service $conversionHealthUrl did not return 200 within 30s" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4a (conversion)'
            exit 4
        }
        if ($conversionPublicHealthRequired) {
            $publicOk = Wait-HostNativeHealth -Name 'conversion-service-public' -Url $conversionPublicHealthUrl -TimeoutSec 30
            if (-not $publicOk) {
                Write-DeployTag -Tag 'fail' -Message "stage=4a Phase 4a conversion-service public URL $conversionPublicHealthUrl did not return 200 within 30s" -LogPath $LogPath | Out-Null
                Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4a (conversion public reachability)'
                exit 4
            }
        }
        Set-KitRuntimeSignature -Path $script:conversionRuntimeSignaturePath -Value $conversionRuntimeSignature
        Write-DeployTag -Tag 'ok' -Message "Phase 4a conversion-service ready ($conversionHealthUrl 200)" -LogPath $LogPath | Out-Null
    }
}

# 4b: host-native Kit
if ($SkipKit) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4b host-native Kit (--SkipKit)' -LogPath $LogPath | Out-Null
} else {
    $kitAlreadyRunning = Test-AlreadyRunning -Name 'bim-streaming-server' -RunDir $RunDir
    if ($kitAlreadyRunning -and -not (Test-KitRuntimeSignatureMatches -Path $script:kitRuntimeSignaturePath -Expected $kitRuntimeSignature)) {
        Write-DeployTag -Tag 'fix' -Message 'Phase 4b restarting host-native Kit because runtime parameters changed' -LogPath $LogPath | Out-Null
        Stop-HostNativeService -Name 'bim-streaming-server' -RunDir $RunDir | Out-Null
        $kitAlreadyRunning = $false
    }
    if ($kitAlreadyRunning) {
        Write-DeployTag -Tag 'skip' -Message 'Phase 4b host-native Kit already running with matching runtime parameters' -LogPath $LogPath | Out-Null
    } else {
        Write-DeployTag -Tag 'ok' -Message 'Phase 4b starting host-native Kit streaming' -LogPath $LogPath | Out-Null
        $startInfo = Start-HostNativeKit `
            -RepoRoot $RepoRoot `
            -SignalPort $resolvedKitSignalPort `
            -StreamPort $resolvedKitMediaPort `
            -PublicIp $resolvedPublicHost `
            -SpectatorSignalPorts $resolvedSpectatorSignalPorts `
            -SpectatorStreamPorts $resolvedSpectatorMediaPorts
        Write-DeployTag -Tag 'ok' -Message "Kit PID=$($startInfo.Pid) log=$($startInfo.LogPath)" -LogPath $LogPath | Out-Null
        $kitRes = Wait-KitReady -LogPath $startInfo.LogPath -SignalPort $resolvedKitSignalPort -TimeoutSec 90
        if (-not $kitRes.ready) {
            Write-DeployTag -Tag 'fail' -Message "stage=4b Phase 4b Kit not ready in 90s (listen=$($null -ne $kitRes.listenPort) keyword=$($kitRes.matchedKeyword))" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4b (Kit)'
            exit 4
        }
        Set-KitRuntimeSignature -Path $script:kitRuntimeSignaturePath -Value $kitRuntimeSignature
        Write-DeployTag -Tag 'ok' -Message "Phase 4b Kit ready (:$resolvedKitSignalPort LISTEN + '$($kitRes.matchedKeyword)')" -LogPath $LogPath | Out-Null
    }
}

# 4c: docker compose
if ($SkipDocker) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4c docker compose (--SkipDocker)' -LogPath $LogPath | Out-Null
} elseif ($webPlaneRunning -and -not $shouldRefreshWebPlane) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4c docker compose: coordinator + viewer already running' -LogPath $LogPath | Out-Null
} else {
    Write-DeployTag -Tag 'ok' -Message 'Phase 4c running scripts\start-web-plane-docker.ps1' -LogPath $LogPath | Out-Null
    # 用 Start-Process 隔離子 script:start-web-plane-docker.ps1 內 $ErrorActionPreference='Stop',
    # 而 docker compose up 的進度訊息('Container ... Creating')會被 PowerShell 5.1 promote
    # 成 NativeCommandError。隔離成 new process 把它的 stderr 寫進 .err.log,不污染父流程。
    $upLog  = Join-Path $RunDir 'docker-compose-up.log'
    $upErr  = Join-Path $RunDir 'docker-compose-up.err.log'
    $childArgs = @(
        '-NoProfile','-ExecutionPolicy','Bypass','-File',
        (Join-Path $PSScriptRoot 'start-web-plane-docker.ps1'),
        '-EnvFile', $resolvedEnvFile
    )
    if ($Build) {
        $childArgs += '-Build'
    }
    $proc = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList $childArgs `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $upLog `
        -RedirectStandardError $upErr `
        -Wait -PassThru -WindowStyle Hidden
    $dockerExit = $proc.ExitCode
    if ($dockerExit -ne 0) {
        Write-DeployTag -Tag 'fail' -Message "stage=4c Phase 4c docker compose up failed (exit=$dockerExit; see scripts\.run\docker-compose-up.log + .err.log)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4c (docker)'
        exit 4
    }
    Write-DeployTag -Tag 'ok' -Message 'Phase 4c docker compose up complete' -LogPath $LogPath | Out-Null
}

# ============================================================
# Phase 5: Post-start verify (best-effort)
# ============================================================
Write-DeployHeader -Title 'Phase 5: Post-start verify (best-effort)'

$verifyFails = @()

function Probe-Url {
    param([string] $Name, [string] $Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
            Write-DeployTag -Tag 'ok' -Message "verify $Name http=$($r.StatusCode) at $Url" -LogPath $LogPath | Out-Null
            return $true
        }
        Write-DeployTag -Tag 'warn' -Message "verify $Name http=$($r.StatusCode) at $Url" -LogPath $LogPath | Out-Null
        return $false
    } catch {
        Write-DeployTag -Tag 'warn' -Message "verify $Name unreachable at $Url :: $($_.Exception.Message)" -LogPath $LogPath | Out-Null
        return $false
    }
}

if (-not $SkipDocker) {
    if (-not (Probe-Url -Name 'coordinator' -Url 'http://127.0.0.1:8004/health')) { $verifyFails += 'coordinator' }
    if (-not (Probe-Url -Name 'viewer'      -Url 'http://127.0.0.1:5173'))        { $verifyFails += 'viewer' }
}
if (-not $SkipConversion) {
    if (-not (Probe-Url -Name 'conversion'  -Url 'http://127.0.0.1:49101/health')) { $verifyFails += 'conversion' }
    if (-not (Test-LoopbackHost -HostName $resolvedPublicHost)) {
        if (-not (Probe-Url -Name 'conversion-public' -Url "http://${resolvedPublicHost}:49101/health")) { $verifyFails += 'conversion-public' }
    }
}

if ($StrictPostVerify -and $verifyFails.Count -gt 0) {
    Write-DeployTag -Tag 'fail' -Message "Phase 5 strict verify failed: $($verifyFails -join ',')" -LogPath $LogPath | Out-Null
    Print-FinalSummary -ExitCode 5 -FailedPhase 'Phase 5 (strict verify)'
    exit 5
}

# ============================================================
# Final Summary(Print-FinalSummary 已在 Phase 1 之前定義)
# ============================================================
Print-FinalSummary -ExitCode 0 -FailedPhase ''
exit 0
