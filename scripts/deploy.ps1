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
    [switch] $SkipGovernance,
    [switch] $SkipKitManager,
    [switch] $SkipDocker,
    [string] $PublicHost = '',
    [string] $ConversionBindHost = '',
    [string] $InventoryPath = '',
    [int]    $GovernancePort = 49102,
    [int]    $KitSignalPort = 49100,
    [int]    $KitMediaPort  = 47998,
    [int]    $KitReadyTimeoutSec = 480,
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

# Deploy-target behaviour comes from the public registry. Canonical Linux
# location/topology comes from an owner-controlled repo-external inventory.
. (Join-Path $PSScriptRoot 'lib\deploy-target-registry.ps1')
if (-not [string]::IsNullOrWhiteSpace($InventoryPath)) {
    [Environment]::SetEnvironmentVariable('AI_BIM_DEPLOY_TARGET_INVENTORY', $InventoryPath, 'Process')
}
$script:DeployTargetProfile = Get-DeployTargetForCurrentPlatform -RepoRoot $RepoRoot -InventoryPath $InventoryPath
$script:DefaultPublicHost = [string]$script:DeployTargetProfile.public_host
$script:FixedTestDeployRoot = [string]$script:DeployTargetProfile.deploy_root
$script:DefaultEdgeSiteId = [string]$script:DeployTargetProfile.edge_site_id
$script:DefaultEdgeRuntimeDataRoot = [string]$script:DeployTargetProfile.runtime_data_root

# Import lib modules
$libDir = Join-Path $PSScriptRoot 'lib'
# Platform adapter first: preflight and the deploy phases resolve platform-specific
# paths (venv interpreter, Kit launcher) through it.
. (Join-Path $libDir 'platform\platform-adapter.ps1')
. (Join-Path $libDir 'deploy-report.ps1')
. (Join-Path $libDir 'preflight-docker.ps1')
. (Join-Path $libDir 'preflight-host-native.ps1')
. (Join-Path $libDir 'preflight-env.ps1')
. (Join-Path $libDir 'preflight-ports.ps1')
. (Join-Path $libDir 'preflight-volume-alignment.ps1')
. (Join-Path $libDir 'host-native-launcher.ps1')
. (Join-Path $libDir 'kit-log-probe.ps1')
. (Join-Path $libDir 'design-assets.ps1')

if (-not (Test-Path -LiteralPath $RunDir)) {
    New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
}

# 提前宣告以下 script-scope 變數,Print-FinalSummary 才能用
$script:resolvedEnvFile = ''
$script:volume = $null
$script:coordinatorPublicUrl = ''
$script:viewerPublicUrl = ''
$script:conversionRuntimeSignaturePath = Join-Path $RunDir 'bim-streaming-conversion-service.params.json'
$script:governanceRuntimeSignaturePath = Join-Path $RunDir 'governance-service.params.json'
$script:kitRuntimeSignaturePath = Join-Path $RunDir 'bim-streaming-server.params.json'
$script:webPlaneRuntimeSignaturePath = Join-Path $RunDir 'web-plane.params.json'
$script:kitManagerRuntimeSignaturePath = Join-Path $RunDir 'kit-manager-api.params.json'

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
            # null/empty/whitespace guard:空 / 不存在 / 只含空白的 .pid 不能讓 Final Summary 自身 throw
            # (Get-Content 對空檔回 $null → .Trim() 是對 null 的方法呼叫 → strict-mode terminating
            #  error,會繞過整段失敗診斷)。注意:PowerShell 中純空白字串(如 '   ')為 truthy,
            # 若用 `if ($raw)` 會落到 .Trim() 印出空 PID;改用 [string]::IsNullOrWhiteSpace 讓純空白也落 '(empty)'。
            # 失敗路徑的可診斷性優先於完整 PID 顯示。
            $raw = Get-Content $pidFile.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
            $procId = if (-not [string]::IsNullOrWhiteSpace($raw)) { $raw.Trim() } else { '(empty)' }
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
    if ($normalized -eq 'localhost') { return $true }
    $address = $null
    if ([System.Net.IPAddress]::TryParse($normalized, [ref]$address)) {
        return [System.Net.IPAddress]::IsLoopback($address)
    }
    return $false
}

function Resolve-CoordinatorInternalApiBase {
    param(
        [Parameter(Mandatory = $true)][string] $EnvFile,
        [Parameter(Mandatory = $true)][int] $CoordinatorPort
    )
    $configured = Get-DeployEnvValue `
        -Name 'COORDINATOR_INTERNAL_API_BASE' `
        -EnvFile $EnvFile `
        -Default "http://127.0.0.1:$CoordinatorPort"
    $uri = $null
    if (-not [uri]::TryCreate($configured, [System.UriKind]::Absolute, [ref]$uri)) {
        throw 'COORDINATOR_INTERNAL_API_BASE must be an absolute loopback http(s) URL.'
    }
    if (
        -not ($uri.Scheme -eq 'http' -or $uri.Scheme -eq 'https') -or
        [string]::IsNullOrWhiteSpace($uri.Host) -or
        -not (Test-LoopbackHost -HostName $uri.Host) -or
        -not [string]::IsNullOrWhiteSpace($uri.UserInfo) -or
        -not [string]::IsNullOrWhiteSpace($uri.Query) -or
        -not [string]::IsNullOrWhiteSpace($uri.Fragment) -or
        -not ($uri.AbsolutePath -eq '' -or $uri.AbsolutePath -eq '/')
    ) {
        throw 'COORDINATOR_INTERNAL_API_BASE must be an origin-only loopback http(s) URL without credentials, path, query, or fragment.'
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
}

function Get-DeploySecretFingerprint {
    param([string] $Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return 'unconfigured' }
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("ai-bim/runtime-authority/v1`0$Value")
        $hash = $sha256.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant())
    } finally {
        $sha256.Dispose()
    }
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
        'COORDINATOR_PUBLIC_BASE_URL',
        'HOST_GOVERNANCE_API_BASE',
        'INTERNAL_API_AUTH_TOKEN'
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
        [Parameter(Mandatory = $true)][string] $AllowedStageHosts,
        [Parameter(Mandatory = $true)][string] $CoordinatorInternalApiBase,
        [Parameter(Mandatory = $true)][string] $RuntimeAuthorityTokenFingerprint,
        [Parameter(Mandatory = $true)][string] $Revision
    )
    return ([pscustomobject]@{
        publicHost           = $PublicHost
        signalPort           = $SignalPort
        streamPort           = $StreamPort
        spectatorSignalPorts = @($SpectatorSignalPorts)
        spectatorStreamPorts = @($SpectatorStreamPorts)
        allowedStageHosts    = $AllowedStageHosts
        coordinatorInternalApiBase = $CoordinatorInternalApiBase
        runtimeAuthorityTokenFingerprint = $RuntimeAuthorityTokenFingerprint
        revision             = $Revision
    } | ConvertTo-Json -Compress)
}

function New-ConversionRuntimeSignature {
    param(
        [Parameter(Mandatory = $true)][string] $BindHost,
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)][string] $HealthHost,
        [string] $PublicArtifactsUrl = '',
        [Parameter(Mandatory = $true)][string] $ArtifactsRoot,
        [Parameter(Mandatory = $true)][string] $Revision
    )
    return ([pscustomobject]@{
        bindHost           = $BindHost
        port               = $Port
        healthHost         = $HealthHost
        publicArtifactsUrl = $PublicArtifactsUrl
        artifactsRoot      = $ArtifactsRoot
        revision           = $Revision
    } | ConvertTo-Json -Compress)
}

function New-WebPlaneRuntimeSignature {
    param(
        [Parameter(Mandatory = $true)][string] $A4ConversionArtifactsHostRoot,
        [Parameter(Mandatory = $true)][string] $A4InternalContextTokenFingerprint
    )
    return ([pscustomobject]@{
        a4ConversionArtifactsHostRoot      = $A4ConversionArtifactsHostRoot
        a4InternalContextTokenFingerprint = $A4InternalContextTokenFingerprint
    } | ConvertTo-Json -Compress)
}

function New-GovernanceRuntimeSignature {
    param(
        [Parameter(Mandatory = $true)][string] $BindHost,
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)][string] $DbPath,
        [Parameter(Mandatory = $true)][string] $FileLibraryRoot,
        [Parameter(Mandatory = $true)][string] $A4InternalContextTokenFingerprint,
        [Parameter(Mandatory = $true)][string] $Revision
    )
    return ([pscustomobject]@{
        host            = $BindHost
        port            = $Port
        dbPath          = $DbPath
        fileLibraryRoot = $FileLibraryRoot
        a4InternalContextTokenFingerprint = $A4InternalContextTokenFingerprint
        revision        = $Revision
    } | ConvertTo-Json -Compress)
}

function New-KitManagerRuntimeSignature {
    param(
        [Parameter(Mandatory = $true)][string] $BindHost,
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $KitControlUrl,
        [Parameter(Mandatory = $true)][string] $Revision
    )
    return ([pscustomobject]@{
        host          = $BindHost
        port          = $Port
        kitControlUrl = $KitControlUrl
        revision      = $Revision
    } | ConvertTo-Json -Compress)
}

function Invoke-CadExtensionCacheHardener {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $PythonPath,
        [Parameter(Mandatory = $true)][string] $ScriptPath,
        [Parameter(Mandatory = $true)][string] $StreamingRepoRoot
    )

    $exitCode = -1
    $stdout = ''
    $stderr = ''
    $process = $null
    try {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $PythonPath
        $startInfo.UseShellExecute = $false
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        foreach ($argument in @($ScriptPath, '--repo-root', $StreamingRepoRoot)) {
            [void]$startInfo.ArgumentList.Add([string]$argument)
        }
        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) {
            throw 'CAD extension cache hardener process did not start.'
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
    }
    catch {
        $exitCode = -1
        $stdout = ''
        $stderr = ''
    }
    finally {
        if ($null -ne $process) { $process.Dispose() }
    }

    $status = $null
    $statusValid = $false
    $lines = @($stdout -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($exitCode -eq 0 -and [string]::IsNullOrWhiteSpace($stderr) -and $lines.Count -eq 1) {
        try {
            $status = $lines[0] | ConvertFrom-Json -ErrorAction Stop
            $statusValid = (
                $status.PSObject.Properties['schema_version'] -and
                $status.PSObject.Properties['status'] -and
                [string]$status.schema_version -ceq 'cad-extension-cache-hardening/v1' -and
                [string]$status.status -ceq 'passed'
            )
        }
        catch {
            $statusValid = $false
        }
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        StatusValid = $statusValid
        StatusJson = if ($statusValid) { $status | ConvertTo-Json -Compress } else { '' }
    }
}

function Resolve-DeployRevision {
    param([Parameter(Mandatory = $true)][string] $RepoRoot)

    $gitOutput = @(& git -C $RepoRoot rev-parse --verify HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or $gitOutput.Count -eq 0) {
        throw "deploy_revision_unavailable: git rev-parse HEAD failed for $RepoRoot"
    }
    $revision = ([string]$gitOutput[0]).Trim().ToLowerInvariant()
    if ($revision -notmatch '^[0-9a-f]{40,64}$') {
        throw "deploy_revision_invalid: expected a git object id, got '$revision'"
    }
    return $revision
}

function Test-KitRuntimeSignatureMatches {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Expected
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    # null guard:存在但空的 signature 檔 → Get-Content -Raw 回 $null;-ErrorAction SilentlyContinue
    # 擋不住對 $null 的 .Trim() 方法呼叫(PS5.1 / strict-mode 下 terminating)。空檔視為「不相符」,
    # 讓 idempotent re-run 走重新寫 signature 路徑而非 crash。
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
    $actual = if ($null -ne $raw) { $raw.Trim() } else { '' }
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

function Normalize-DeployManagedPath {
    param([Parameter(Mandatory = $true)][string] $Path)
    return ([System.IO.Path]::GetFullPath($Path)).TrimEnd([char[]]@('\', '/'))
}

function Test-IsFixedTestDeployProfile {
    param([Parameter(Mandatory = $true)][string] $Path)
    return ((Normalize-DeployManagedPath -Path $Path) -ieq (Normalize-DeployManagedPath -Path $script:FixedTestDeployRoot))
}

function Resolve-DeployEdgeRuntimeContract {
    param()

    $edgeSiteId = [Environment]::GetEnvironmentVariable('EDGE_SITE_ID', 'Process')
    if ([string]::IsNullOrWhiteSpace($edgeSiteId)) {
        $edgeSiteId = $script:DefaultEdgeSiteId
    }

    $edgeRuntimeDataRoot = [Environment]::GetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', 'Process')
    if ([string]::IsNullOrWhiteSpace($edgeRuntimeDataRoot)) {
        $edgeRuntimeDataRoot = $script:DefaultEdgeRuntimeDataRoot
    }
    $edgeRuntimeDataRoot = Normalize-DeployManagedPath -Path $edgeRuntimeDataRoot

    $runtimeStorageRoot = Join-Path $edgeRuntimeDataRoot 'storage'
    $artifactsRoot = Join-Path $edgeRuntimeDataRoot 'artifacts'
    $ledgerRoot = Join-Path $edgeRuntimeDataRoot 'ledgers'

    return [pscustomobject]@{
        EDGE_SITE_ID                        = $edgeSiteId
        EDGE_RUNTIME_DATA_ROOT              = $edgeRuntimeDataRoot
        RUNTIME_STORAGE_ROOT                = $runtimeStorageRoot
        STORAGE_HOST_ROOT                   = $runtimeStorageRoot
        STREAMING_CONVERSION_ARTIFACTS_ROOT = $artifactsRoot
        CONVERSION_LEDGER_STORE_PATH        = Join-Path $ledgerRoot 'conversion-ledger.json'
        ARTIFACT_HEALTH_LEDGER_STORE_PATH   = Join-Path $ledgerRoot 'artifact-health-ledger.json'
    }
}

function Ensure-DeployEdgeRuntimeContractDirectories {
    param([Parameter(Mandatory = $true)] $Contract)

    $created = 0
    foreach ($dirPath in @($Contract.RUNTIME_STORAGE_ROOT, $Contract.STREAMING_CONVERSION_ARTIFACTS_ROOT, (Split-Path -Parent $Contract.CONVERSION_LEDGER_STORE_PATH))) {
        if (-not (Test-Path -LiteralPath $dirPath -PathType Container)) {
            New-Item -ItemType Directory -Path $dirPath -Force | Out-Null
            $created++
        }
    }
    return $created
}

function Set-DeployEdgeRuntimeContractEnv {
    param([Parameter(Mandatory = $true)] $Contract)

    foreach ($name in @(
        'EDGE_SITE_ID',
        'EDGE_RUNTIME_DATA_ROOT',
        'RUNTIME_STORAGE_ROOT',
        'STORAGE_HOST_ROOT',
        'STREAMING_CONVERSION_ARTIFACTS_ROOT',
        'CONVERSION_LEDGER_STORE_PATH',
        'ARTIFACT_HEALTH_LEDGER_STORE_PATH'
    )) {
        [Environment]::SetEnvironmentVariable($name, [string]$Contract.$name, 'Process')
    }
}

function Resolve-DeployVolumeState {
    param(
        [Parameter(Mandatory = $true)] $Volume,
        $EdgeRuntimeContract = $null
    )

    if ($null -eq $EdgeRuntimeContract) {
        return $Volume
    }

    return [pscustomobject]@{
        runtimeStorageRoot = $EdgeRuntimeContract.RUNTIME_STORAGE_ROOT
        leaf               = 'storage'
        status             = 'ALIGNED'
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
$edgeRuntimeContract = $null
if ((-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('EDGE_RUNTIME_DATA_ROOT', 'Process'))) -or (Test-IsFixedTestDeployProfile -Path $RepoRoot)) {
    $edgeRuntimeContract = Resolve-DeployEdgeRuntimeContract
    Set-DeployEdgeRuntimeContractEnv -Contract $edgeRuntimeContract
}
$configuredConversionArtifactsRoot = if ($null -ne $edgeRuntimeContract) {
    [string]$edgeRuntimeContract.STREAMING_CONVERSION_ARTIFACTS_ROOT
} else {
    Get-DeployEnvValue `
        -Name 'STREAMING_CONVERSION_ARTIFACTS_ROOT' `
        -EnvFile $resolvedEnvFile `
        -Default (Join-Path $RepoRoot 'bim-streaming-server\_cache\host-native-conversion\artifacts')
}
if (-not [System.IO.Path]::IsPathRooted($configuredConversionArtifactsRoot)) {
    $configuredConversionArtifactsRoot = Join-Path $RepoRoot $configuredConversionArtifactsRoot
}
$resolvedConversionArtifactsRoot = Normalize-DeployManagedPath -Path $configuredConversionArtifactsRoot
[Environment]::SetEnvironmentVariable('STREAMING_CONVERSION_ARTIFACTS_ROOT', $resolvedConversionArtifactsRoot, 'Process')
[Environment]::SetEnvironmentVariable('A4_CONVERSION_ARTIFACTS_HOST_ROOT', $resolvedConversionArtifactsRoot, 'Process')
$resolvedPublicHostRaw = if (-not [string]::IsNullOrWhiteSpace($PublicHost)) {
    $PublicHost
} else {
    Get-DeployEnvValue -Name 'PUBLIC_HOST' -EnvFile $resolvedEnvFile -Default $script:DefaultPublicHost
}
$resolvedPublicHost = Resolve-HostNameOnly -Value $resolvedPublicHostRaw
$resolvedCoordinatorPort = Resolve-DeployIntValue -Name 'COORDINATOR_PORT' -EnvFile $resolvedEnvFile -Default 8004 -Min 1 -Max 65535
$runtimeAuthorityTokenExplicitlyConfigured = Test-DeployValueConfigured -Name 'INTERNAL_API_AUTH_TOKEN' -EnvFile $resolvedEnvFile
$resolvedInternalApiAuthToken = Get-DeployEnvValue -Name 'INTERNAL_API_AUTH_TOKEN' -EnvFile $resolvedEnvFile -Default 'dev-internal-token'
$resolvedA4InternalContextToken = (Get-DeployEnvValue -Name 'A4_INTERNAL_CONTEXT_TOKEN' -EnvFile $resolvedEnvFile -Default '').Trim()
if ($resolvedA4InternalContextToken.Length -gt 0 -and ($resolvedA4InternalContextToken.Length -lt 16 -or $resolvedA4InternalContextToken.Length -gt 4096)) {
    throw 'A4_INTERNAL_CONTEXT_TOKEN must be blank (A4 disabled) or between 16 and 4096 characters.'
}
$a4InternalContextTokenFingerprint = Get-DeploySecretFingerprint -Value $resolvedA4InternalContextToken
$resolvedCoordinatorInternalApiBase = Resolve-CoordinatorInternalApiBase -EnvFile $resolvedEnvFile -CoordinatorPort $resolvedCoordinatorPort
$runtimeAuthorityTokenFingerprint = Get-DeploySecretFingerprint -Value $resolvedInternalApiAuthToken
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
$resolvedDeployRevision = Resolve-DeployRevision -RepoRoot $RepoRoot
$resolvedHostNativeBindHost = Get-HostNativeBindHost -RepoRoot $RepoRoot
$resolvedHostNativeHealthHost = Resolve-HealthProbeHost -BindHost $resolvedHostNativeBindHost
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
$webPlaneRuntimeSignature = New-WebPlaneRuntimeSignature `
    -A4ConversionArtifactsHostRoot $resolvedConversionArtifactsRoot `
    -A4InternalContextTokenFingerprint $a4InternalContextTokenFingerprint
if (-not (Test-KitRuntimeSignatureMatches -Path $script:webPlaneRuntimeSignaturePath -Expected $webPlaneRuntimeSignature)) {
    $shouldRefreshWebPlane = $true
}
$resolvedConversionHealthHost = Resolve-HealthProbeHost -BindHost $resolvedConversionBindHost
$resolvedKitControlUrl = Resolve-HostNativeKitControlUrl `
    -KitControlUrl (Get-DeployEnvValue -Name 'KIT_CONTROL_URL' -EnvFile $resolvedEnvFile -Default '').Trim()
$resolvedAllowedStageHosts = Resolve-AllowedStageHosts -EnvFile $resolvedEnvFile -PublicHost $resolvedPublicHost -ConversionPort 49101
$kitRuntimeSignature = New-KitRuntimeSignature `
    -PublicHost $resolvedPublicHost `
    -SignalPort $resolvedKitSignalPort `
    -StreamPort $resolvedKitMediaPort `
    -SpectatorSignalPorts $resolvedSpectatorSignalPorts `
    -SpectatorStreamPorts $resolvedSpectatorMediaPorts `
    -AllowedStageHosts $resolvedAllowedStageHosts `
    -CoordinatorInternalApiBase $resolvedCoordinatorInternalApiBase `
    -RuntimeAuthorityTokenFingerprint $runtimeAuthorityTokenFingerprint `
    -Revision $resolvedDeployRevision
$runtimeAuthorityConfigurationChanged = -not (Test-KitRuntimeSignatureMatches -Path $script:kitRuntimeSignaturePath -Expected $kitRuntimeSignature)
if ($runtimeAuthorityConfigurationChanged) {
    # Keep the Docker coordinator and host-native Kit on the same token/base when
    # private authority configuration is added, rotated, or removed to fallback.
    $shouldRefreshWebPlane = $true
}
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
[Environment]::SetEnvironmentVariable('COORDINATOR_INTERNAL_API_BASE', $resolvedCoordinatorInternalApiBase, 'Process')
[Environment]::SetEnvironmentVariable('INTERNAL_API_AUTH_TOKEN', $resolvedInternalApiAuthToken, 'Process')
[Environment]::SetEnvironmentVariable('A4_INTERNAL_CONTEXT_TOKEN', $resolvedA4InternalContextToken, 'Process')
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
    -PublicArtifactsUrl $resolvedConversionPublicArtifactsUrl `
    -ArtifactsRoot $resolvedConversionArtifactsRoot `
    -Revision $resolvedDeployRevision

$volume = Resolve-DeployVolumeState -Volume (Test-VolumeAlignment -RepoRoot $RepoRoot -EnvFile $resolvedEnvFile) -EdgeRuntimeContract $edgeRuntimeContract
$script:volume = $volume
$resolvedGovernancePort = Resolve-DeployIntValue `
    -Name 'GOV_PORT' `
    -EnvFile $resolvedEnvFile `
    -Default 49102 `
    -ExplicitValue $GovernancePort `
    -HasExplicitValue:($PSBoundParameters.ContainsKey('GovernancePort')) `
    -Min 1 `
    -Max 65535
$resolvedGovernanceDbPath = Join-Path $RepoRoot 'storage\governance.db'
$resolvedGovernanceFileLibraryRoot = if ($volume -and $volume.runtimeStorageRoot) {
    $volume.runtimeStorageRoot
} else {
    Join-Path $RepoRoot 'storage'
}
$governanceRuntimeSignature = New-GovernanceRuntimeSignature `
    -BindHost $resolvedHostNativeBindHost `
    -Port $resolvedGovernancePort `
    -DbPath $resolvedGovernanceDbPath `
    -FileLibraryRoot $resolvedGovernanceFileLibraryRoot `
    -A4InternalContextTokenFingerprint $a4InternalContextTokenFingerprint `
    -Revision $resolvedDeployRevision
$kitManagerRuntimeSignature = New-KitManagerRuntimeSignature `
    -BindHost $resolvedHostNativeBindHost `
    -Port 8010 `
    -KitControlUrl $resolvedKitControlUrl `
    -Revision $resolvedDeployRevision
$resolvedGovernanceApiBaseForDocker = if ($SkipGovernance) { '' } else { "http://host.docker.internal:$resolvedGovernancePort" }
if (-not $SkipGovernance) {
    [Environment]::SetEnvironmentVariable('HOST_GOVERNANCE_API_BASE', $resolvedGovernanceApiBaseForDocker, 'Process')
    if ($PSBoundParameters.ContainsKey('GovernancePort') -or $resolvedGovernancePort -ne 49102) {
        $shouldRefreshWebPlane = $true
    }
}
$extraHostNativePorts = @($resolvedSpectatorSignalPorts)
if (-not $SkipGovernance) { $extraHostNativePorts += $resolvedGovernancePort }
if (-not $SkipKitManager) { $extraHostNativePorts += 8010 }
$ports = Test-PortAvailability -RepoRoot $RepoRoot -CoordinatorPort $resolvedCoordinatorPort -ViewerPort $resolvedViewerPort -KitSignalPort $resolvedKitSignalPort -KitMediaPort $resolvedKitMediaPort -ExtraHostNativePorts $extraHostNativePorts -ExtraHostNativeUdpPorts $resolvedSpectatorMediaPorts

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
        coordinatorInternalApiBase = $resolvedCoordinatorInternalApiBase
        runtimeAuthorityPrivateTokenConfigured = [bool]$runtimeAuthorityTokenExplicitlyConfigured
        runtimeAuthorityTokenSource = $(if ($runtimeAuthorityTokenExplicitlyConfigured) { 'private_configuration' } else { 'local_dev_fallback' })
        runtimeAuthorityConfigurationChanged = [bool]$runtimeAuthorityConfigurationChanged
        conversionBindHost  = $resolvedConversionBindHost
        conversionHealthHost = $resolvedConversionHealthHost
        hostNativeBindHost  = $resolvedHostNativeBindHost
        deployRevision      = $resolvedDeployRevision
        conversionPublicArtifactsUrl = $resolvedConversionPublicArtifactsUrl
        governanceSkipped    = [bool]$SkipGovernance
        governancePort       = $resolvedGovernancePort
        governanceApiBaseForDocker = $resolvedGovernanceApiBaseForDocker
        governanceDbPath     = $resolvedGovernanceDbPath
        governanceFileLibraryRoot = $resolvedGovernanceFileLibraryRoot
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
# Without lingering, systemd stops user@<uid>.service at last logout and takes the
# host-native services with it. This is a HARD fail rather than a warning because
# the alternative is the failure we actually shipped: a deploy that reports four
# healthy services, exits 0, and leaves nothing running once the operator's session
# closes. Nothing later in the deploy can detect that.
if (-not (Test-PlatformServiceLingerEnabled)) {
    $hardFails += 'user_lingering_disabled'
    Write-DeployTag -Tag 'fail' -Message "host-native services would not survive logout: lingering is disabled for this account. Fix once with: loginctl enable-linger $(& id -un 2>`$null)" -LogPath $LogPath | Out-Null
}
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
if ($null -ne $edgeRuntimeContract) {
    $fixActions += Ensure-DeployEdgeRuntimeContractDirectories -Contract $edgeRuntimeContract
}

function New-DeployVenv {
    # Creating a venv needs a SYSTEM interpreter, which is not the venv one and is
    # not always called `python`. `& python -m venv` under ErrorActionPreference
    # 'Continue' merely prints when the name does not resolve and leaves
    # $LASTEXITCODE stale, so creation silently no-ops and the next phase fails
    # with a confusing "venv python not recognized" (first real Linux deploy).
    # Resolve explicitly, then VERIFY the interpreter exists afterwards.
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $LogPath
    )
    $venvRoot = Join-Path $RepoRoot '.venv'
    $systemPython = Resolve-PlatformSystemPython
    if (-not $systemPython) {
        Write-DeployTag -Tag 'fail' -Message 'no usable system python found (tried python / python3)' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (venv create)'
        exit 2
    }
    # Remove any half-built venv first: `python -m venv` creates bin/python before
    # bootstrapping pip, so an earlier failure at ensurepip leaves a directory that
    # passes an existence check and then dies at pip install.
    if (Test-Path -LiteralPath $venvRoot) {
        Write-DeployTag -Tag 'fix' -Message 'removing existing .venv before recreate' -LogPath $LogPath | Out-Null
        Remove-Item -LiteralPath $venvRoot -Recurse -Force
    }
    Write-DeployTag -Tag 'fix' -Message "creating .venv via $systemPython -m venv" -LogPath $LogPath | Out-Null
    & $systemPython -m venv $venvRoot
    $venvPython = Resolve-PlatformVenvPython -VenvRoot $venvRoot
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython)) {
        Write-DeployTag -Tag 'fail' -Message "python -m venv did not produce $venvPython" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (venv create)'
        exit 2
    }
    # A venv without pip is unusable by the very next phase; verify, do not assume.
    $null = & $venvPython -m pip --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-DeployTag -Tag 'fail' -Message 'created .venv has no pip; install the python3-venv package for this interpreter (see scripts/dev/provision-linux-deploy-target.sh)' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (venv create)'
        exit 2
    }
    return $venvPython
}

$script:DeployRequirementsFiles = @(
    'requirements.txt',
    'bim-streaming-server\requirements.txt',
    'governance-service\requirements.txt',
    'services\kit-manager-api\requirements.txt')

function Get-DeployRequirementsFingerprint {
    # Content hash of every requirements file that exists. Phase 2 used to decide
    # whether to install by asking Test-HostNativeEnvironment whether a handful of
    # named packages imported - so once fastapi/uvicorn/ifcopenshell were present,
    # pip never ran again. Adding a requirements file (or editing one) then had no
    # effect on an existing deploy area: the first Linux target reached Phase 4a with
    # openpyxl still missing and died at import. A fingerprint over the files
    # themselves has no list to keep in sync.
    param([Parameter(Mandatory = $true)][string] $RepoRoot)

    $sb = [Text.StringBuilder]::new()
    foreach ($req in $script:DeployRequirementsFiles) {
        $reqPath = Join-Path $RepoRoot $req
        if (-not (Test-Path -LiteralPath $reqPath)) { continue }
        $null = $sb.AppendLine($req)
        $null = $sb.AppendLine((Get-Content -LiteralPath $reqPath -Raw))
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes($sb.ToString())
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-DeployRequirementsStampPath {
    param([Parameter(Mandatory = $true)][string] $RepoRoot)
    return (Join-Path (Join-Path $RepoRoot '.venv') '.deploy-requirements-stamp')
}

function Test-DeployRequirementsStale {
    param([Parameter(Mandatory = $true)][string] $RepoRoot)
    $stampPath = Get-DeployRequirementsStampPath -RepoRoot $RepoRoot
    if (-not (Test-Path -LiteralPath $stampPath)) { return $true }
    $recorded = (Get-Content -LiteralPath $stampPath -Raw -ErrorAction SilentlyContinue)
    if ($null -eq $recorded) { return $true }
    return ($recorded.Trim() -ne (Get-DeployRequirementsFingerprint -RepoRoot $RepoRoot))
}

function Install-DeployPythonRequirements {
    param(
        [Parameter(Mandatory = $true)][string] $VenvPython,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $LogPath
    )
    $installed = $false
    # Every host-native service started by Phase 4 runs out of THIS venv, so every
    # one of their requirements files belongs here. governance-service and
    # kit-manager-api were missing: the Windows deploy area had their deps installed
    # historically (governance-service/requirements.txt still calls itself
    # "documentation only, the host Python already has everything"), so the gap only
    # appeared on a fresh target - the service started and then died on
    # ModuleNotFoundError: openpyxl, surfacing as a Phase 4a health timeout.
    foreach ($req in $script:DeployRequirementsFiles) {
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
    # Record what was installed, so the next run can tell "already satisfied" from
    # "never attempted". Written only after every file installed cleanly.
    Set-Content -LiteralPath (Get-DeployRequirementsStampPath -RepoRoot $RepoRoot) `
        -Value (Get-DeployRequirementsFingerprint -RepoRoot $RepoRoot) -Encoding ascii
}

# fix: .venv
if ($hostNative.venv -eq 'MISSING') {
    $null = New-DeployVenv -RepoRoot $RepoRoot -LogPath $LogPath
    $fixActions++
}

$requirementsStale = Test-DeployRequirementsStale -RepoRoot $RepoRoot
if ($hostNative.venv -eq 'MISSING' -or $requirementsStale -or ($hostNative.venv -eq 'OK' -and $hostNative.pythonDependencies -ne 'OK')) {
    $venvPy = Resolve-PlatformVenvPython -VenvRoot (Join-Path $RepoRoot '.venv')
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
    Write-DeployTag -Tag 'fix' -Message "running bim-streaming-server Kit build ($($hostNative.kitBuildReason)) — may take several minutes" -LogPath $LogPath | Out-Null
    $kitBuildResult = Invoke-KitRepoBuild -WorkingDirectory (Join-Path $RepoRoot 'bim-streaming-server') -LogPath $kitBuildLog -RunDir $RunDir -BuildCommand $hostNative.kitBuildCommand
    if ($kitBuildResult.TimedOut) {
        Write-DeployTag -Tag 'fail' -Message "Kit repo.bat build timed out and was force-stopped (see scripts\.run\kit-repo-build.log)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (kit build timeout)'
        exit 2
    }
    if ($kitBuildResult.ExitCode -ne 0) {
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

# NVIDIA's Linux CAD extension package can mark hoops_main.py world-writable.
# Harden the exact pinned, unique, owner-cache candidate before conversion starts;
# the runtime adapter independently revalidates the same trust boundary.
if (-not $SkipConversion -and (Get-PlatformName) -eq 'linux') {
    $cadHardener = Join-Path $RepoRoot 'bim-streaming-server\scripts\harden-cad-extension-cache.py'
    if (-not (Test-Path -LiteralPath $cadHardener -PathType Leaf)) {
        Write-DeployTag -Tag 'fail' -Message 'CAD extension cache hardener is missing' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (CAD extension cache hardening)'
        exit 2
    }
    $configuredHoopsMain = Get-DeployEnvValue -Name 'STREAMING_CONVERSION_HOOPS_MAIN' -EnvFile $resolvedEnvFile -Default ''
    if (-not [string]::IsNullOrWhiteSpace($configuredHoopsMain)) {
        Write-DeployTag -Tag 'fail' -Message 'Explicit STREAMING_CONVERSION_HOOPS_MAIN is not supported by the pinned Linux deployment path' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (CAD extension cache hardening)'
        exit 2
    }
    $hardenerPython = Resolve-PlatformVenvPython -VenvRoot (Join-Path $RepoRoot '.venv')
    $hardenerPythonReady = Test-Path -LiteralPath $hardenerPython -PathType Leaf
    if ($hardenerPythonReady) {
        try {
            $executeMask = [System.IO.UnixFileMode]::UserExecute -bor [System.IO.UnixFileMode]::GroupExecute -bor [System.IO.UnixFileMode]::OtherExecute
            $hardenerPythonReady = (([System.IO.File]::GetUnixFileMode($hardenerPython) -band $executeMask) -ne 0)
        }
        catch {
            $hardenerPythonReady = $false
        }
    }
    if (-not $hardenerPythonReady) {
        Write-DeployTag -Tag 'fail' -Message 'CAD extension cache hardener interpreter is missing or not executable' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (CAD extension cache hardening)'
        exit 2
    }
    $hardenerResult = Invoke-CadExtensionCacheHardener `
        -PythonPath $hardenerPython `
        -ScriptPath $cadHardener `
        -StreamingRepoRoot (Join-Path $RepoRoot 'bim-streaming-server')
    if ($hardenerResult.StatusValid) {
        Add-Content -LiteralPath $LogPath -Value $hardenerResult.StatusJson
    }
    if ($hardenerResult.ExitCode -ne 0 -or -not $hardenerResult.StatusValid) {
        Write-DeployTag -Tag 'fail' -Message 'CAD extension cache permission hardening failed' -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (CAD extension cache hardening)'
        exit 2
    }
    Write-DeployTag -Tag 'ok' -Message 'CAD extension cache entrypoint permissions hardened' -LogPath $LogPath | Out-Null
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
            $volume = Resolve-DeployVolumeState -Volume (Test-VolumeAlignment -RepoRoot $RepoRoot -EnvFile $resolvedEnvFile) -EdgeRuntimeContract $edgeRuntimeContract
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
    $volume = Resolve-DeployVolumeState -Volume (Test-VolumeAlignment -RepoRoot $RepoRoot -EnvFile $resolvedEnvFile) -EdgeRuntimeContract $edgeRuntimeContract
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
$ownedComposePorts = @{}
if (-not $SkipDocker) {
    $composePrefix = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile)
    Push-Location $RepoRoot
    $coordinatorRunningId = ''
    $viewerRunningId = ''
    $coordinatorPortProof = @()
    $viewerPortProof = @()
    try {
        $coordinatorRunningId = ((docker @($composePrefix + @('ps','--status','running','-q','coordinator')) 2>$null | Out-String).Trim())
        $viewerRunningId = ((docker @($composePrefix + @('ps','--status','running','-q','viewer')) 2>$null | Out-String).Trim())
        if ($coordinatorRunningId -and $viewerRunningId) {
            $coordinatorPortProof = @(docker @($composePrefix + @('port','coordinator','8004')) 2>$null)
            $viewerPortProof = @(docker @($composePrefix + @('port','viewer','5173')) 2>$null)
        }
    } finally { Pop-Location }
    $coordinatorHostPortPattern = ':' + [regex]::Escape([string]$resolvedCoordinatorPort) + '\s*$'
    $viewerHostPortPattern = ':' + [regex]::Escape([string]$resolvedViewerPort) + '\s*$'
    $coordinatorPortMatches = @($coordinatorPortProof | Where-Object { [string]$_ -match $coordinatorHostPortPattern }).Count -gt 0
    $viewerPortMatches = @($viewerPortProof | Where-Object { [string]$_ -match $viewerHostPortPattern }).Count -gt 0
    $webPlaneRunning = [bool]($coordinatorRunningId -and $viewerRunningId -and $coordinatorPortMatches -and $viewerPortMatches)
    if ($webPlaneRunning) {
        $ownedComposePorts[$resolvedCoordinatorPort] = $coordinatorRunningId
        $ownedComposePorts[$resolvedViewerPort] = $viewerRunningId
    }
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

# The hybrid profile owns kit-manager-api as a host-native service. Remove only
# the same-project legacy Compose service so it cannot retain :8010 across an
# upgrade and mask the new host-native revision.
if (-not $SkipDocker) {
    $legacyKitManagerRmArgs = @('compose','-f','compose.runtime-manager.yml','-f','compose.host-kit.yml','--env-file',$resolvedEnvFile,'rm','-f','-s','kit-manager-api')
    Push-Location $RepoRoot
    $legacyKitManagerRmExit = -1
    try {
        docker @legacyKitManagerRmArgs *> (Join-Path $RunDir 'docker-compose-rm-kit-manager-api.log')
        $legacyKitManagerRmExit = $LASTEXITCODE
    } finally { Pop-Location }
    if ($legacyKitManagerRmExit -ne 0) {
        Write-DeployTag -Tag 'fail' -Message "failed to remove legacy Compose kit-manager-api (exit=$legacyKitManagerRmExit)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (legacy kit-manager cleanup)'
        exit 2
    }
    $fixActions++
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
            try {
                $designAssetStage = Sync-DeploymentDesignAssets -RepoRoot $RepoRoot
                Write-DeployTag -Tag 'ok' -Message "design assets $($designAssetStage.Mode) count=$($designAssetStage.Count)" -LogPath $LogPath | Out-Null
            } catch {
                Write-DeployTag -Tag 'fail' -Message "design assets staging failed: $($_.Exception.Message)" -LogPath $LogPath | Out-Null
                Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (design assets)'
                exit 2
            }
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
$extraHostNativePorts = @($resolvedSpectatorSignalPorts)
if (-not $SkipGovernance) { $extraHostNativePorts += $resolvedGovernancePort }
if (-not $SkipKitManager) { $extraHostNativePorts += 8010 }
$ports = Test-PortAvailability -RepoRoot $RepoRoot -CoordinatorPort $resolvedCoordinatorPort -ViewerPort $resolvedViewerPort -KitSignalPort $resolvedKitSignalPort -KitMediaPort $resolvedKitMediaPort -ExtraHostNativePorts $extraHostNativePorts -ExtraHostNativeUdpPorts $resolvedSpectatorMediaPorts

$strangerPortPids = @($ports.docker + $ports.hostNative |
    Where-Object {
        $_.status -eq 'OCCUPIED' `
        -and -not $_.ourPidFile `
        -and -not $ownedComposePorts.ContainsKey([int]$_.port)
    })

if ($strangerPortPids.Count -eq 0 -and $hostNative.venv -ne 'WRONG_VERSION') {
    Write-DeployTag -Tag 'ok' -Message 'no dangerous action needed' -LogPath $LogPath | Out-Null
}

foreach ($sp in $strangerPortPids) {
    $portLabel = if ($sp.protocol) { "$($sp.protocol)/$($sp.port)" } else { "port $($sp.port)" }
    if ([int]$sp.pid -le 0) {
        Write-DeployTag -Tag 'fail' -Message "port $portLabel is occupied but its owner PID is not visible; refusing an ownership-blind stop" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 3 -FailedPhase 'Phase 3 (listener owner unavailable)'
        exit 3
    }
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
        $null = New-DeployVenv -RepoRoot $RepoRoot -LogPath $LogPath
        $venvPy = Resolve-PlatformVenvPython -VenvRoot (Join-Path $RepoRoot '.venv')
        Install-DeployPythonRequirements -VenvPython $venvPy -RepoRoot $RepoRoot -LogPath $LogPath
        $hostNative = Test-HostNativeEnvironment -RepoRoot $RepoRoot
    } else {
        Write-DeployTag -Tag 'ask' -Message $prompt -LogPath $LogPath | Out-Null
        $response = Read-Host 'y/N'
        if ($response -match '^[Yy]') {
            Remove-Item -LiteralPath (Join-Path $RepoRoot '.venv') -Recurse -Force
            $null = New-DeployVenv -RepoRoot $RepoRoot -LogPath $LogPath
            $venvPy = Resolve-PlatformVenvPython -VenvRoot (Join-Path $RepoRoot '.venv')
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
# Phase 4: Start (依賴順序 4a → 4b → 4c → 4d)
# ============================================================
Write-DeployHeader -Title 'Phase 4: Start services'

# 4a: host-native governance-service
if ($SkipGovernance) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4a host-native governance (--SkipGovernance)' -LogPath $LogPath | Out-Null
} else {
    $governanceHealthUrl = "http://${resolvedHostNativeHealthHost}:$resolvedGovernancePort/health"
    $governanceAlreadyRunning = Test-AlreadyRunning -Name 'governance-service' -RunDir $RunDir
    if ($governanceAlreadyRunning -and -not (Test-KitRuntimeSignatureMatches -Path $script:governanceRuntimeSignaturePath -Expected $governanceRuntimeSignature)) {
        Write-DeployTag -Tag 'fix' -Message 'Phase 4a restarting host-native governance because runtime parameters changed' -LogPath $LogPath | Out-Null
        Stop-HostNativeService -Name 'governance-service' -RunDir $RunDir | Out-Null
        $governanceAlreadyRunning = $false
    }
    if ($governanceAlreadyRunning) {
        if (Wait-HostNativeHealth -Name 'governance-service' -Url $governanceHealthUrl -TimeoutSec 5) {
            Write-DeployTag -Tag 'skip' -Message "Phase 4a host-native governance already running ($governanceHealthUrl 200)" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'fix' -Message "Phase 4a restarting host-native governance because wrapper is alive but $governanceHealthUrl is unhealthy" -LogPath $LogPath | Out-Null
            Stop-HostNativeService -Name 'governance-service' -RunDir $RunDir | Out-Null
            $governanceAlreadyRunning = $false
        }
    }
    if (-not $governanceAlreadyRunning) {
        Write-DeployTag -Tag 'ok' -Message 'Phase 4a starting host-native governance-service' -LogPath $LogPath | Out-Null
        $startInfo = Start-HostNativeGovernance `
            -RepoRoot $RepoRoot `
            -Port $resolvedGovernancePort `
            -DbPath $resolvedGovernanceDbPath `
            -FileLibraryRoot $resolvedGovernanceFileLibraryRoot
        Write-DeployTag -Tag 'ok' -Message "governance PID=$($startInfo.Pid) log=$($startInfo.LogPath)" -LogPath $LogPath | Out-Null
        $ok = Wait-HostNativeHealth -Name 'governance-service' -Url $governanceHealthUrl -TimeoutSec 30
        if (-not $ok) {
            Write-DeployTag -Tag 'fail' -Message "stage=4a Phase 4a governance-service $governanceHealthUrl did not return 200 within 30s" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4a (governance)'
            exit 4
        }
        Set-KitRuntimeSignature -Path $script:governanceRuntimeSignaturePath -Value $governanceRuntimeSignature
        Write-DeployTag -Tag 'ok' -Message "Phase 4a governance-service ready ($governanceHealthUrl 200)" -LogPath $LogPath | Out-Null
    }
}

# 4b: host-native conversion-service
if ($SkipConversion) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4b host-native conversion (--SkipConversion)' -LogPath $LogPath | Out-Null
} else {
    $conversionHealthUrl = "http://${resolvedConversionHealthHost}:49101/health"
    $conversionPublicHealthUrl = "http://${resolvedPublicHost}:49101/health"
    $conversionPublicHealthRequired = -not (Test-LoopbackHost -HostName $resolvedPublicHost)
    $conversionAlreadyRunning = Test-AlreadyRunning -Name 'bim-streaming-conversion-service' -RunDir $RunDir
    if ($conversionAlreadyRunning -and -not (Test-KitRuntimeSignatureMatches -Path $script:conversionRuntimeSignaturePath -Expected $conversionRuntimeSignature)) {
        Write-DeployTag -Tag 'fix' -Message 'Phase 4b restarting host-native conversion because runtime parameters changed' -LogPath $LogPath | Out-Null
        Stop-HostNativeService -Name 'bim-streaming-conversion-service' -RunDir $RunDir | Out-Null
        $conversionAlreadyRunning = $false
    }
    if ($conversionAlreadyRunning) {
        if (Wait-HostNativeHealth -Name 'conversion-service' -Url $conversionHealthUrl -TimeoutSec 5) {
            if ($conversionPublicHealthRequired -and -not (Wait-HostNativeHealth -Name 'conversion-service-public' -Url $conversionPublicHealthUrl -TimeoutSec 5)) {
                Write-DeployTag -Tag 'fix' -Message "Phase 4b restarting host-native conversion because public health is unreachable at $conversionPublicHealthUrl" -LogPath $LogPath | Out-Null
                Stop-HostNativeService -Name 'bim-streaming-conversion-service' -RunDir $RunDir | Out-Null
                $conversionAlreadyRunning = $false
            } else {
                Write-DeployTag -Tag 'skip' -Message "Phase 4b host-native conversion already running ($conversionHealthUrl 200)" -LogPath $LogPath | Out-Null
            }
        } else {
            Write-DeployTag -Tag 'fix' -Message "Phase 4b restarting host-native conversion because wrapper is alive but $conversionHealthUrl is unhealthy" -LogPath $LogPath | Out-Null
            Stop-HostNativeService -Name 'bim-streaming-conversion-service' -RunDir $RunDir | Out-Null
            $conversionAlreadyRunning = $false
        }
    }
    if (-not $conversionAlreadyRunning) {
        Write-DeployTag -Tag 'ok' -Message 'Phase 4b starting host-native conversion-service' -LogPath $LogPath | Out-Null
        $startInfo = Start-HostNativeConversion `
            -RepoRoot $RepoRoot `
            -RuntimeStorageRoot $volume.runtimeStorageRoot `
            -BindHost $resolvedConversionBindHost `
            -PublicArtifactsUrl ([Environment]::GetEnvironmentVariable('STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL'))
        Write-DeployTag -Tag 'ok' -Message "conversion PID=$($startInfo.Pid) log=$($startInfo.LogPath)" -LogPath $LogPath | Out-Null
        $ok = Wait-HostNativeHealth -Name 'conversion-service' -Url $conversionHealthUrl -TimeoutSec 30
        if (-not $ok) {
            Write-DeployTag -Tag 'fail' -Message "stage=4b Phase 4b conversion-service $conversionHealthUrl did not return 200 within 30s" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4b (conversion)'
            exit 4
        }
        if ($conversionPublicHealthRequired) {
            $publicOk = Wait-HostNativeHealth -Name 'conversion-service-public' -Url $conversionPublicHealthUrl -TimeoutSec 30
            if (-not $publicOk) {
                Write-DeployTag -Tag 'fail' -Message "stage=4b Phase 4b conversion-service public URL $conversionPublicHealthUrl did not return 200 within 30s" -LogPath $LogPath | Out-Null
                Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4b (conversion public reachability)'
                exit 4
            }
        }
        Set-KitRuntimeSignature -Path $script:conversionRuntimeSignaturePath -Value $conversionRuntimeSignature
        Write-DeployTag -Tag 'ok' -Message "Phase 4b conversion-service ready ($conversionHealthUrl 200)" -LogPath $LogPath | Out-Null
    }
}

# 4c: host-native Kit
if ($SkipKit) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4c host-native Kit (--SkipKit)' -LogPath $LogPath | Out-Null
} else {
    $kitAlreadyRunning = Test-AlreadyRunning -Name 'bim-streaming-server' -RunDir $RunDir
    if ($kitAlreadyRunning -and -not (Test-KitRuntimeSignatureMatches -Path $script:kitRuntimeSignaturePath -Expected $kitRuntimeSignature)) {
        Write-DeployTag -Tag 'fix' -Message 'Phase 4c restarting host-native Kit because runtime parameters changed' -LogPath $LogPath | Out-Null
        Stop-HostNativeService -Name 'bim-streaming-server' -RunDir $RunDir | Out-Null
        $kitAlreadyRunning = $false
    }
    if ($kitAlreadyRunning) {
        Write-DeployTag -Tag 'skip' -Message 'Phase 4c host-native Kit already running with matching runtime parameters' -LogPath $LogPath | Out-Null
    } else {
        Write-DeployTag -Tag 'ok' -Message 'Phase 4c starting host-native Kit streaming' -LogPath $LogPath | Out-Null
        $startInfo = Start-HostNativeKit `
            -RepoRoot $RepoRoot `
            -SignalPort $resolvedKitSignalPort `
            -StreamPort $resolvedKitMediaPort `
            -PublicIp $resolvedPublicHost `
            -SpectatorSignalPorts $resolvedSpectatorSignalPorts `
            -SpectatorStreamPorts $resolvedSpectatorMediaPorts
        Write-DeployTag -Tag 'ok' -Message "Kit PID=$($startInfo.Pid) log=$($startInfo.LogPath)" -LogPath $LogPath | Out-Null
        $kitRes = Wait-KitReady -LogPath $startInfo.LogPath -SignalPort $resolvedKitSignalPort -TimeoutSec $KitReadyTimeoutSec
        if (-not $kitRes.ready) {
            Write-DeployTag -Tag 'fail' -Message "stage=4c Phase 4c Kit not ready in ${KitReadyTimeoutSec}s (listen=$($null -ne $kitRes.listenPort) keyword=$($kitRes.matchedKeyword))" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4c (Kit)'
            exit 4
        }
        Set-KitRuntimeSignature -Path $script:kitRuntimeSignaturePath -Value $kitRuntimeSignature
        Write-DeployTag -Tag 'ok' -Message "Phase 4c Kit ready (:$resolvedKitSignalPort LISTEN + '$($kitRes.matchedKeyword)')" -LogPath $LogPath | Out-Null
    }
}

# 4c-2: host-native kit-manager-api（R5 2026-07-10：coordinator 容器經 host.docker.internal:8010
# 依賴它做 /api/kit/* forward（RK1），故排在 4c（Kit）之後、4d（docker compose）之前；
# 先前 Mode A/C 未編排本服務，只有 Mode B compose 有。）
if ($SkipKitManager) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4c-2 host-native kit-manager-api (--SkipKitManager)' -LogPath $LogPath | Out-Null
} else {
    $kitManagerHealthUrl = "http://${resolvedHostNativeHealthHost}:8010/health"
    $kitManagerAlreadyRunning = Test-AlreadyRunning -Name 'kit-manager-api' -RunDir $RunDir
    if ($kitManagerAlreadyRunning -and -not (Test-KitRuntimeSignatureMatches -Path $script:kitManagerRuntimeSignaturePath -Expected $kitManagerRuntimeSignature)) {
        Write-DeployTag -Tag 'fix' -Message 'Phase 4c-2 restarting kit-manager-api because runtime parameters or deployed revision changed' -LogPath $LogPath | Out-Null
        Stop-HostNativeService -Name 'kit-manager-api' -RunDir $RunDir | Out-Null
        $kitManagerAlreadyRunning = $false
    }
    if ($kitManagerAlreadyRunning) {
        if (Wait-HostNativeHealth -Name 'kit-manager-api' -Url $kitManagerHealthUrl -TimeoutSec 5) {
            Write-DeployTag -Tag 'skip' -Message "Phase 4c-2 kit-manager-api already running ($kitManagerHealthUrl 200)" -LogPath $LogPath | Out-Null
        } else {
            Write-DeployTag -Tag 'fix' -Message "Phase 4c-2 restarting kit-manager-api because wrapper is alive but $kitManagerHealthUrl is unhealthy" -LogPath $LogPath | Out-Null
            Stop-HostNativeService -Name 'kit-manager-api' -RunDir $RunDir | Out-Null
            $kitManagerAlreadyRunning = $false
        }
    }
    if (-not $kitManagerAlreadyRunning) {
        Write-DeployTag -Tag 'ok' -Message 'Phase 4c-2 starting host-native kit-manager-api' -LogPath $LogPath | Out-Null
        $kmStartInfo = Start-HostNativeKitManager -RepoRoot $RepoRoot -Port 8010 -KitControlUrl $resolvedKitControlUrl
        Write-DeployTag -Tag 'ok' -Message "kit-manager-api PID=$($kmStartInfo.Pid) log=$($kmStartInfo.LogPath)" -LogPath $LogPath | Out-Null
        $ok = Wait-HostNativeHealth -Name 'kit-manager-api' -Url $kitManagerHealthUrl -TimeoutSec 30
        if (-not $ok) {
            Write-DeployTag -Tag 'fail' -Message "stage=4c-2 Phase 4c-2 kit-manager-api $kitManagerHealthUrl did not return 200 within 30s" -LogPath $LogPath | Out-Null
            Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4c-2 (kit-manager-api)'
            exit 4
        }
        Set-KitRuntimeSignature -Path $script:kitManagerRuntimeSignaturePath -Value $kitManagerRuntimeSignature
        Write-DeployTag -Tag 'ok' -Message "Phase 4c-2 kit-manager-api ready ($kitManagerHealthUrl 200)" -LogPath $LogPath | Out-Null
    }
}

# 4d: docker compose
if ($SkipDocker) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4d docker compose (--SkipDocker)' -LogPath $LogPath | Out-Null
} elseif ($webPlaneRunning -and -not $shouldRefreshWebPlane) {
    Write-DeployTag -Tag 'skip' -Message 'Phase 4d docker compose: coordinator + viewer already running' -LogPath $LogPath | Out-Null
} else {
    Write-DeployTag -Tag 'ok' -Message 'Phase 4d running scripts\start-web-plane-docker.ps1' -LogPath $LogPath | Out-Null
    if (-not $SkipGovernance) {
        [Environment]::SetEnvironmentVariable('HOST_GOVERNANCE_API_BASE', $resolvedGovernanceApiBaseForDocker, 'Process')
    }
    # 用 Start-Process 隔離子 script:start-web-plane-docker.ps1 內 $ErrorActionPreference='Stop',
    # 而 docker compose up 的進度訊息('Container ... Creating')會被 PowerShell 5.1 promote
    # 成 NativeCommandError。隔離成 new process 把它的 stderr 寫進 .err.log,不污染父流程。
    $upLog  = Join-Path $RunDir 'docker-compose-up.log'
    $upErr  = Join-Path $RunDir 'docker-compose-up.err.log'
    $childArgs = @(Get-HostNativePowerShellArgumentPrefix) + @(
        '-File',
        (Join-Path $PSScriptRoot 'start-web-plane-docker.ps1'),
        '-EnvFile', $resolvedEnvFile
    )
    if ($Build) {
        $childArgs += '-Build'
    }
    # powershell.exe and -WindowStyle are both Windows-only; off Windows this is
    # pwsh with no window style at all.
    $startArgs = @{
        FilePath               = (Get-HostNativePowerShellExe)
        ArgumentList           = $childArgs
        WorkingDirectory       = $RepoRoot
        RedirectStandardOutput = $upLog
        RedirectStandardError  = $upErr
        Wait                   = $true
        PassThru               = $true
    }
    if ((Get-PlatformName) -eq 'windows') { $startArgs.WindowStyle = 'Hidden' }
    # Fail closed when Start-Process produced nothing. It threw here on the Linux
    # target (nested ArgumentList), left $proc holding an EARLIER phase's process
    # object, and $proc.ExitCode read 0 off that corpse - so the deploy announced
    # "docker compose up complete" 42ms later with no containers, no log files, and
    # exit 0. Clearing it first means a failed start cannot borrow a stale success.
    $proc = $null
    $proc = Start-Process @startArgs
    if (-not $proc) {
        Write-DeployTag -Tag 'fail' -Message "stage=4d Phase 4d could not start $(Get-HostNativePowerShellExe) for start-web-plane-docker.ps1" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4d (docker)'
        exit 4
    }
    $dockerExit = $proc.ExitCode
    if ($dockerExit -ne 0) {
        Write-DeployTag -Tag 'fail' -Message "stage=4d Phase 4d docker compose up failed (exit=$dockerExit; see scripts\.run\docker-compose-up.log + .err.log)" -LogPath $LogPath | Out-Null
        Print-FinalSummary -ExitCode 4 -FailedPhase 'Phase 4d (docker)'
        exit 4
    }
    Set-KitRuntimeSignature -Path $script:webPlaneRuntimeSignaturePath -Value $webPlaneRuntimeSignature
    Write-DeployTag -Tag 'ok' -Message 'Phase 4d docker compose up complete' -LogPath $LogPath | Out-Null
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

function Probe-Text {
    param([string] $Name, [string] $Url, [string] $Pattern)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        $content = [string]$r.Content
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400 -and $content -match $Pattern) {
            Write-DeployTag -Tag 'ok' -Message "verify $Name matched pattern at $Url" -LogPath $LogPath | Out-Null
            return [pscustomobject]@{ Ok = $true; Content = $content }
        }
        Write-DeployTag -Tag 'warn' -Message "verify $Name pattern missing at $Url" -LogPath $LogPath | Out-Null
        return [pscustomobject]@{ Ok = $false; Content = $content }
    } catch {
        Write-DeployTag -Tag 'warn' -Message "verify $Name unreachable at $Url :: $($_.Exception.Message)" -LogPath $LogPath | Out-Null
        return [pscustomobject]@{ Ok = $false; Content = '' }
    }
}

function Probe-UiAsset {
    param([string] $Name, [string] $UiUrl, [string] $Html)
    $match = [regex]::Match($Html, '(?:src|href)="(?<asset>/ui/assets/[^"]+\.(?:js|css))"')
    if (-not $match.Success) {
        Write-DeployTag -Tag 'warn' -Message "verify $Name no /ui/assets bundle reference found" -LogPath $LogPath | Out-Null
        return $false
    }

    $ui = [uri]$UiUrl
    $assetUrl = "$($ui.Scheme)://$($ui.Authority)$($match.Groups['asset'].Value)"
    return Probe-Url -Name $Name -Url $assetUrl
}

if (-not $SkipDocker) {
    if (-not (Probe-Url -Name 'coordinator' -Url 'http://127.0.0.1:8004/health')) { $verifyFails += 'coordinator' }
    if (-not (Probe-Url -Name 'viewer'      -Url 'http://127.0.0.1:5173'))        { $verifyFails += 'viewer' }
    $coordinatorBaseUrl = if ($script:coordinatorPublicUrl) { $script:coordinatorPublicUrl.TrimEnd('/') } else { 'http://127.0.0.1:8004' }
    $coordinatorUiUrl = "$coordinatorBaseUrl/ui"
    $uiProbe = Probe-Text -Name 'coordinator-ui-edge-console-shell' -Url $coordinatorUiUrl -Pattern '/ui/assets/'
    if (-not $uiProbe.Ok) {
        $verifyFails += 'coordinator-ui-edge-console-shell'
    } elseif (-not (Probe-UiAsset -Name 'coordinator-ui-edge-console-asset' -UiUrl $coordinatorUiUrl -Html $uiProbe.Content)) {
        $verifyFails += 'coordinator-ui-edge-console-asset'
    }
    if (-not $SkipGovernance) {
        if (-not (Probe-Url -Name 'coordinator-governance-files-tree' -Url 'http://127.0.0.1:8004/api/governance/files/tree')) { $verifyFails += 'coordinator-governance-files-tree' }
    }
}
if (-not $SkipGovernance) {
    if (-not (Probe-Url -Name 'governance' -Url "http://${resolvedHostNativeHealthHost}:$resolvedGovernancePort/health")) { $verifyFails += 'governance' }
}
if (-not $SkipKitManager) {
    if (-not (Probe-Url -Name 'kit-manager-api' -Url "http://${resolvedHostNativeHealthHost}:8010/health")) { $verifyFails += 'kit-manager-api' }
}
if (-not $SkipConversion) {
    if (-not (Probe-Url -Name 'conversion'  -Url "http://${resolvedConversionHealthHost}:49101/health")) { $verifyFails += 'conversion' }
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
