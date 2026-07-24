[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:FixedTestDeploymentRoot = 'D:\Users\deploy\AI-bim-geo'
$script:FixedTestDeploymentDataRoot = 'D:\Users\deploy\AI-bim-geo-data'
$script:CoordinatorHealthUrl = 'http://127.0.0.1:8004/health'
$script:ConversionHealthUrl = 'http://127.0.0.1:49101/health'
$script:ComposeFiles = @('compose.runtime-manager.yml', 'compose.host-kit.yml')
$script:ComposeEnvFile = '.env.web-plane.host-kit'
$script:PlaywrightEvidenceTimeoutSeconds = 300
$script:PlaywrightRunnerGraceSeconds = 30
$script:VerifiedDockerContext = ''

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)][string] $Left,
        [Parameter(Mandatory = $true)][string] $Right
    )

    $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
    $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
    return [string]::Equals($leftFull, $rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathContained {
    param(
        [Parameter(Mandatory = $true)][string] $Candidate,
        [Parameter(Mandatory = $true)][string] $Root
    )

    $candidateFull = [System.IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    return [string]::Equals($candidateFull, $rootFull, [System.StringComparison]::OrdinalIgnoreCase) `
        -or $candidateFull.StartsWith("$rootFull\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-TextContainsPathBoundary {
    param(
        [Parameter(Mandatory = $true)][string] $Text,
        [Parameter(Mandatory = $true)][string] $Path
    )

    $escapedPath = [regex]::Escape($Path.TrimEnd('\'))
    return $Text -match ('(?i)(?:^|["''\s])' + $escapedPath + '(?:[\\/]|["''\s]|$)')
}

function Assert-NoReparsePointPath {
    param([Parameter(Mandatory = $true)][string] $Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetPathRoot($fullPath)
    if ([string]::IsNullOrWhiteSpace($root)) {
        throw "Cannot determine the filesystem root for path: $Path"
    }

    $relative = $fullPath.Substring($root.Length).Trim('\')
    if ([string]::IsNullOrWhiteSpace($relative)) { return }

    $current = $root
    foreach ($segment in @($relative -split '[\\/]') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) {
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) { return }
        $item = Get-Item -LiteralPath $current
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Reparse-point paths are not allowed for host-native evidence: $current"
        }
    }
}

function Assert-NoBroadWriteAcl {
    param([Parameter(Mandatory = $true)][string] $Path)

    $broadWriterSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
    $writeMask = [int64](
        [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    $rules = (Get-Acl -LiteralPath $Path).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
        if ($rule.IdentityReference.Value -notin $broadWriterSids) { continue }
        if (([int64]$rule.FileSystemRights -band $writeMask) -ne 0) {
            throw "Host-native evidence path grants a broad principal write access: $Path"
        }
    }
}

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string] $Path)

    Assert-NoReparsePointPath -Path (Split-Path -Path $Path -Parent)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
    Assert-NoReparsePointPath -Path $Path
    Assert-NoBroadWriteAcl -Path $Path
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required deployment metadata is missing: $Path"
    }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Read-PositiveInt {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string] $Name
    )

    $parsed = 0
    if (-not [int]::TryParse([string]$Value, [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt 65535) {
        throw "Deployment metadata contains an invalid $Name port."
    }
    return $parsed
}

function Test-HttpOk {
    param([Parameter(Mandatory = $true)][string] $Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Wait-ForHttpOk {
    param(
        [Parameter(Mandatory = $true)][string] $Url,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds
    )

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    do {
        if (Test-HttpOk -Url $Url) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    return $false
}

function Wait-ForHttpUnavailable {
    param(
        [Parameter(Mandatory = $true)][string] $Url,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds
    )

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    do {
        if (-not (Test-HttpOk -Url $Url)) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    return $false
}

function Get-DeploymentOwnedProcess {
    param(
        [Parameter(Mandatory = $true)][int] $ProcessId,
        [Parameter(Mandatory = $true)][string] $DeploymentRoot,
        [Parameter(Mandatory = $true)][int] $SignalPort
    )

    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
    if ($null -eq $process) {
        throw "Deployment Kit PID $ProcessId does not exist."
    }

    $commandLine = [string]$process.CommandLine
    $executablePath = [string]$process.ExecutablePath
    $commandLineOwned = Test-TextContainsPathBoundary -Text $commandLine -Path $DeploymentRoot
    $executableOwned = -not [string]::IsNullOrWhiteSpace($executablePath) `
        -and (Test-PathContained -Candidate $executablePath -Root $DeploymentRoot)
    $allowedLauncher = [string]$process.Name -in @('powershell.exe', 'pwsh.exe', 'kit.exe')
    $hasRuntimeMarker = $commandLine -match '(?i)bim-streaming-server'
    if (-not $allowedLauncher -or -not $hasRuntimeMarker -or -not ($commandLineOwned -or $executableOwned)) {
        throw "Deployment Kit PID $ProcessId is not proven to belong to the canonical test deployment."
    }

    $signalListenerProcessIds = @(Get-NetTCPConnection -LocalPort $SignalPort -State Listen -ErrorAction Stop `
        | ForEach-Object OwningProcess | Sort-Object -Unique)
    $signalListenerOwned = @($signalListenerProcessIds | Where-Object {
        Test-ProcessDescendsFrom -ProcessId $_ -AncestorProcessId $ProcessId
    }).Count -gt 0
    if (-not $signalListenerOwned) {
        throw "No Kit signaling listener on port $SignalPort descends from deployment PID $ProcessId."
    }

    return [pscustomobject]@{
        process_id = $ProcessId
        process_name = [string]$process.Name
        signaling_port = $SignalPort
        ownership = 'allowed_runtime_launcher_marker_path_boundary_and_descendant_signaling_listener'
    }
}

function Test-ProcessDescendsFrom {
    param(
        [Parameter(Mandatory = $true)][int] $ProcessId,
        [Parameter(Mandatory = $true)][int] $AncestorProcessId
    )

    $currentProcessId = $ProcessId
    for ($depth = 0; $depth -lt 16 -and $currentProcessId -gt 0; $depth += 1) {
        if ($currentProcessId -eq $AncestorProcessId) { return $true }
        $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$currentProcessId"
        if ($null -eq $currentProcess) { return $false }
        $currentProcessId = [int]$currentProcess.ParentProcessId
    }
    return $false
}

function Invoke-Docker {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)

    if ([string]::IsNullOrWhiteSpace($script:VerifiedDockerContext)) {
        throw 'Docker context has not been verified for host-native evidence.'
    }
    $output = & docker --context $script:VerifiedDockerContext @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker command failed in the verified local context.'
    }
    return $output.Trim()
}

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)

    return Invoke-Docker -Arguments $Arguments
}

function Get-DeploymentCoordinator {
    param(
        [Parameter(Mandatory = $true)][string[]] $ComposeBase,
        [Parameter(Mandatory = $true)][string] $DeploymentRoot
    )

    $containerOutput = Invoke-Compose -Arguments ($ComposeBase + @('ps', '-q', 'coordinator'))
    $containerIds = @($containerOutput -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($containerIds.Count -ne 1) {
        throw 'The canonical deployment must resolve exactly one coordinator container.'
    }
    $containerId = $containerIds[0].Trim()

    $workingDirectory = Invoke-Docker -Arguments @('inspect', '--format', '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}', $containerId)
    if (-not (Test-SamePath -Left $workingDirectory -Right $DeploymentRoot)) {
        throw 'The coordinator container ownership label does not match the canonical deployment root.'
    }

    $service = Invoke-Docker -Arguments @('inspect', '--format', '{{ index .Config.Labels "com.docker.compose.service" }}', $containerId)
    if ($service -ne 'coordinator') {
        throw 'The selected Docker container is not the deployment-owned coordinator service.'
    }

    $running = Invoke-Docker -Arguments @('inspect', '--format', '{{ .State.Running }}', $containerId)
    if ($running -ne 'true') {
        throw 'The deployment-owned coordinator container is not running before the controlled outage.'
    }
    $imageId = Invoke-Docker -Arguments @('inspect', '--format', '{{ .Image }}', $containerId)

    return [pscustomobject]@{
        container_id = $containerId
        service = $service
        compose_working_dir = $workingDirectory
        image_id = $imageId
        docker_context = $script:VerifiedDockerContext
    }
}

function Test-DeploymentCoordinatorRunning {
    param([Parameter(Mandatory = $true)][string] $ContainerId)

    return (Invoke-Docker -Arguments @('inspect', '--format', '{{ .State.Running }}', $ContainerId)) -eq 'true'
}

function Write-ControlMarker {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][hashtable] $Marker
    )

    Assert-NoReparsePointPath -Path (Split-Path -Path $Path -Parent)
    if (Test-Path -LiteralPath $Path) {
        throw "Control marker already exists and will not be overwritten: $Path"
    }

    $payload = "$(($Marker | ConvertTo-Json -Depth 4 -Compress))`n"
    $encoding = [System.Text.UTF8Encoding]::new($false)
    $bytes = $encoding.GetBytes($payload)
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
    }
    finally {
        $stream.Dispose()
    }
}

function Read-ControlMarker {
    param([Parameter(Mandatory = $true)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Wait-ForControlMarker {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $RunId,
        [Parameter(Mandatory = $true)][string] $ControlNonce,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds,
        [System.Diagnostics.Process] $ChildProcess
    )

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    do {
        $marker = Read-ControlMarker -Path $Path
        if (
            $null -ne $marker `
            -and $marker.schema_version -eq 'runtime-command-authority-control/v1' `
            -and $marker.run_id -eq $RunId `
            -and $marker.control_nonce -eq $ControlNonce `
            -and -not [string]::IsNullOrWhiteSpace([string]$marker.request_id)
        ) {
            return $marker
        }
        if ($null -ne $ChildProcess -and $ChildProcess.HasExited) {
            throw 'The host-native Playwright case exited before its required control marker was written.'
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    throw "Timed out waiting for control marker: $Path"
}

function Wait-ForProcessExit {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process] $Process,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds
    )

    $deadline = (Get-Date).ToUniversalTime().AddSeconds($TimeoutSeconds)
    do {
        if ($Process.HasExited) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    throw 'The host-native Playwright case did not exit within its bounded evidence window.'
}

function Stop-RunnerOwnedProcessTree {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process] $Process)

    if ($Process.HasExited) { return }

    # The Process instance was returned by this runner's Start-Process call. /T limits
    # cleanup to that owned command tree; it never targets a deployment runtime PID.
    $null = & taskkill.exe /PID ([string]$Process.Id) /T 2>&1
    $deadline = (Get-Date).ToUniversalTime().AddSeconds(15)
    do {
        if ($Process.HasExited) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date).ToUniversalTime() -lt $deadline)

    throw 'Runner-owned Playwright process did not stop after its control-window timeout.'
}

$deploymentRoot = [System.IO.Path]::GetFullPath((Get-Location).Path).TrimEnd('\')
if (-not (Test-SamePath -Left $deploymentRoot -Right $script:FixedTestDeploymentRoot)) {
    throw "Run this evidence command only from $script:FixedTestDeploymentRoot."
}

$dataRoot = [System.IO.Path]::GetFullPath($script:FixedTestDeploymentDataRoot).TrimEnd('\')
$artifactsRoot = Join-Path $dataRoot 'artifacts'
$viewerRoot = Join-Path $deploymentRoot 'web-viewer-sample'
$runMetadataRoot = Join-Path $deploymentRoot 'scripts\.run'
$fixtureSource = Join-Path $deploymentRoot 'bim-streaming-server\source\extensions\ezplus.bim_review_stream.messaging\data\testing.usd'
$envFilePath = Join-Path $deploymentRoot $script:ComposeEnvFile

Assert-NoReparsePointPath -Path $deploymentRoot
Assert-NoBroadWriteAcl -Path $deploymentRoot
if (-not (Test-Path -LiteralPath $dataRoot -PathType Container)) { throw 'Canonical deployment data root is missing.' }
if (-not (Test-Path -LiteralPath $artifactsRoot -PathType Container)) { throw 'Canonical deployment artifacts root is missing.' }
if (-not (Test-Path -LiteralPath $viewerRoot -PathType Container)) { throw 'Canonical deployment viewer source is missing.' }
if (-not (Test-Path -LiteralPath $fixtureSource -PathType Leaf)) { throw 'Tracked host-native USD fixture is missing.' }
if (-not (Test-Path -LiteralPath $envFilePath -PathType Leaf)) { throw 'Canonical deployment Compose environment file is missing.' }
Assert-NoReparsePointPath -Path $dataRoot
Assert-NoBroadWriteAcl -Path $dataRoot
Assert-NoReparsePointPath -Path $artifactsRoot
Assert-NoReparsePointPath -Path $viewerRoot
Assert-NoReparsePointPath -Path $fixtureSource

$headSha = (& git rev-parse HEAD).Trim()
$originMainSha = (& git rev-parse origin/main).Trim()
$dirty = (& git status --porcelain | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $headSha -notmatch '^[0-9a-f]{40}$' -or $originMainSha -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to establish canonical deployment Git provenance.'
}
if ($headSha -ne $originMainSha -or -not [string]::IsNullOrWhiteSpace($dirty)) {
    throw 'Canonical deployment must be clean and exactly equal to origin/main before evidence runs.'
}

$dockerContext = (& docker context show 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dockerContext)) {
    throw 'Unable to establish the Docker context for host-native evidence.'
}
$dockerEndpoint = (& docker context inspect $dockerContext --format '{{ (index .Endpoints "docker").Host }}' 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dockerEndpoint -notmatch '^npipe:') {
    throw 'Host-native evidence requires a verified local Windows Docker context.'
}
$script:VerifiedDockerContext = $dockerContext

$streamingParams = Read-JsonFile -Path (Join-Path $runMetadataRoot 'bim-streaming-server.params.json')
$conversionParams = Read-JsonFile -Path (Join-Path $runMetadataRoot 'bim-streaming-conversion-service.params.json')
$kitSignalPort = Read-PositiveInt -Value $streamingParams.signalPort -Name 'Kit signaling'
$kitMediaPort = Read-PositiveInt -Value $streamingParams.streamPort -Name 'Kit media'
$conversionPort = Read-PositiveInt -Value $conversionParams.port -Name 'conversion'
if ($conversionPort -ne 49101) { throw 'Canonical deployment conversion port is not 49101.' }
if (-not (Test-SamePath -Left ([string]$conversionParams.artifactsRoot) -Right $artifactsRoot)) {
    throw 'Conversion artifacts root is not the canonical test-deployment artifacts root.'
}
if ([string]$streamingParams.allowedStageHosts -notmatch [regex]::Escape("127.0.0.1:$conversionPort") `
    -or [string]$streamingParams.allowedStageHosts -notmatch [regex]::Escape("localhost:$conversionPort")) {
    throw 'Deployment stage-host allowlist does not contain both loopback fixture origins.'
}

$kitPidRaw = (Get-Content -LiteralPath (Join-Path $runMetadataRoot 'bim-streaming-server.pid') -Raw).Trim()
$kitPid = 0
if (-not [int]::TryParse($kitPidRaw, [ref]$kitPid)) { throw 'Deployment Kit PID metadata is invalid.' }
$kitProcess = Get-DeploymentOwnedProcess -ProcessId $kitPid -DeploymentRoot $deploymentRoot -SignalPort $kitSignalPort
$runtimeId = "host-native-kit-$kitPid"

if (-not (Wait-ForHttpOk -Url $script:CoordinatorHealthUrl -TimeoutSeconds 30)) { throw 'Coordinator health is not ready.' }
if (-not (Wait-ForHttpOk -Url $script:ConversionHealthUrl -TimeoutSeconds 30)) { throw 'Conversion health is not ready.' }

$runId = "runtime-authority-e2e-$([guid]::NewGuid().ToString('N'))"
if ($runId -notmatch '^[a-z0-9-]+$') { throw 'Generated host-native evidence run ID is invalid.' }
$controlNonce = [guid]::NewGuid().ToString('N')
$fixtureDirectory = Join-Path $artifactsRoot $runId
$controlParent = Join-Path $dataRoot 'control'
$controlDirectory = Join-Path (Join-Path $controlParent 'runtime-command-authority') $runId
$evidenceParent = Join-Path $artifactsRoot 'runtime-command-authority-evidence'
$evidenceDirectory = Join-Path $evidenceParent $runId
Ensure-Directory -Path $fixtureDirectory
Ensure-Directory -Path $controlParent
Ensure-Directory -Path (Join-Path $controlParent 'runtime-command-authority')
Ensure-Directory -Path $controlDirectory
Ensure-Directory -Path $evidenceParent
Ensure-Directory -Path $evidenceDirectory

$fixtureStagePath = Join-Path $fixtureDirectory 'model.usdc'
Copy-Item -LiteralPath $fixtureSource -Destination $fixtureStagePath
$stageUrlA = "http://127.0.0.1:$conversionPort/artifacts/$runId/model.usdc"
$stageUrlB = "http://localhost:$conversionPort/artifacts/$runId/model.usdc"
$playwrightOutput = Join-Path $evidenceDirectory 'playwright-output'
Ensure-Directory -Path $playwrightOutput

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$viewerPort = $listener.LocalEndpoint.Port
$listener.Stop()

$environmentNames = @(
    'E2E_HOST_NATIVE_RUNTIME_AUTHORITY',
    'E2E_COORDINATOR_BASE_URL',
    'E2E_KIT_SIGNAL_PORT',
    'E2E_KIT_MEDIA_PORT',
    'E2E_STAGE_URL_A',
    'E2E_STAGE_URL_B',
    'E2E_KIT_RUNTIME_ID',
    'E2E_KIT_PID',
    'E2E_RUNTIME_PROCESS_LOGS',
    'E2E_RUNTIME_AUTHORITY_CONTROL_DIR',
    'E2E_RUNTIME_AUTHORITY_RUN_ID',
    'E2E_RUNTIME_AUTHORITY_CONTROL_NONCE',
    'E2E_ORIGIN_MAIN_SHA',
    'E2E_VIEWER_PORT',
    'E2E_DISABLE_WEBSERVER'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$composeBase = @('compose')
foreach ($composeFile in $script:ComposeFiles) {
    $composeBase += @('-f', $composeFile)
}
$composeBase += @('--env-file', $script:ComposeEnvFile)

$coordinatorRecoveryRequired = $false
$coordinatorRecovered = $false
$coordinator = $null
$e2eProcess = $null
$originalFailure = $null
$recoveryFailure = $null
$childCleanupFailure = $null

try {
    Push-Location -LiteralPath $viewerRoot
    try {
        & npm ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed for the canonical deployment viewer.' }
        $dirtyAfterInstall = (& git status --porcelain | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($dirtyAfterInstall)) {
            throw 'Viewer dependency installation changed the canonical deployment checkout.'
        }
    }
    finally {
        Pop-Location
    }

    [Environment]::SetEnvironmentVariable('E2E_HOST_NATIVE_RUNTIME_AUTHORITY', '1', 'Process')
    [Environment]::SetEnvironmentVariable('E2E_COORDINATOR_BASE_URL', 'http://127.0.0.1:8004', 'Process')
    [Environment]::SetEnvironmentVariable('E2E_KIT_SIGNAL_PORT', [string]$kitSignalPort, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_KIT_MEDIA_PORT', [string]$kitMediaPort, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_STAGE_URL_A', $stageUrlA, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_STAGE_URL_B', $stageUrlB, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_KIT_RUNTIME_ID', $runtimeId, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_KIT_PID', [string]$kitPid, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_RUNTIME_PROCESS_LOGS', '', 'Process')
    [Environment]::SetEnvironmentVariable('E2E_RUNTIME_AUTHORITY_CONTROL_DIR', $controlDirectory, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_RUNTIME_AUTHORITY_RUN_ID', $runId, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_RUNTIME_AUTHORITY_CONTROL_NONCE', $controlNonce, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_ORIGIN_MAIN_SHA', $originMainSha, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_VIEWER_PORT', [string]$viewerPort, 'Process')
    [Environment]::SetEnvironmentVariable('E2E_DISABLE_WEBSERVER', $null, 'Process')

    $playwright = Join-Path $viewerRoot 'node_modules\.bin\playwright.cmd'
    if (-not (Test-Path -LiteralPath $playwright -PathType Leaf)) {
        throw 'The locked local Playwright binary is missing after dependency installation.'
    }
    $e2eArguments = @(
        'test', 'e2e/runtime-command-authority-host-native.spec.ts',
        '--config=playwright.config.ts', '--output', $playwrightOutput
    )
    $e2eProcess = Start-Process `
        -FilePath $playwright `
        -ArgumentList $e2eArguments `
        -WorkingDirectory $viewerRoot `
        -PassThru `
        -WindowStyle Hidden

    $outageReady = Wait-ForControlMarker `
        -Path (Join-Path $controlDirectory 'outage-ready.json') `
        -RunId $runId `
        -ControlNonce $controlNonce `
        -TimeoutSeconds ($script:PlaywrightEvidenceTimeoutSeconds + $script:PlaywrightRunnerGraceSeconds) `
        -ChildProcess $e2eProcess

    $coordinator = Get-DeploymentCoordinator -ComposeBase $composeBase -DeploymentRoot $deploymentRoot
    $coordinatorRecoveryRequired = $true
    Invoke-Docker -Arguments @('stop', $coordinator.container_id) | Out-Null
    if (-not (Wait-ForHttpUnavailable -Url $script:CoordinatorHealthUrl -TimeoutSeconds 30)) {
        throw 'Coordinator did not become unavailable after the deployment-owned stop action.'
    }
    Write-ControlMarker -Path (Join-Path $controlDirectory 'outage-go.json') -Marker @{
        schema_version = 'runtime-command-authority-control/v1'
        run_id = $runId
        request_id = [string]$outageReady.request_id
        control_nonce = $controlNonce
        coordinator_stopped = $true
    }

    Wait-ForProcessExit -Process $e2eProcess -TimeoutSeconds ($script:PlaywrightEvidenceTimeoutSeconds + $script:PlaywrightRunnerGraceSeconds)
    if ($e2eProcess.ExitCode -ne 0) {
        throw 'The host-native Playwright case failed; inspect the token-safe result, screenshot, and Playwright output directory.'
    }
    $outageComplete = Wait-ForControlMarker `
        -Path (Join-Path $controlDirectory 'outage-complete.json') `
        -RunId $runId `
        -ControlNonce $controlNonce `
        -TimeoutSeconds 15 `
        -ChildProcess $e2eProcess
    if ($outageComplete.request_id -ne $outageReady.request_id) {
        throw 'Outage completion marker does not match the E2E outage request.'
    }

    $resultFiles = @(Get-ChildItem -LiteralPath $playwrightOutput -Recurse -Filter 'runtime-command-authority-host-native.json' -File)
    $screenshotFiles = @(Get-ChildItem -LiteralPath $playwrightOutput -Recurse -Filter 'runtime-command-authority-host-native.png' -File)
    if ($resultFiles.Count -ne 1 -or $screenshotFiles.Count -ne 1) {
        throw 'The host-native E2E did not emit exactly one JSON result and one screenshot.'
    }
    $testEvidence = Get-Content -LiteralPath $resultFiles[0].FullName -Raw | ConvertFrom-Json
    if ($testEvidence.post_merge_corrective -ne $true -or $testEvidence.origin_main_sha -ne $originMainSha) {
        throw 'The E2E result is missing the required post-merge provenance fields.'
    }
    Copy-Item -LiteralPath $resultFiles[0].FullName -Destination (Join-Path $evidenceDirectory 'runtime-command-authority-host-native.json')
    Copy-Item -LiteralPath $screenshotFiles[0].FullName -Destination (Join-Path $evidenceDirectory 'runtime-command-authority-host-native.png')
}
catch {
    $originalFailure = $_
}
finally {
    if ($null -ne $e2eProcess -and -not $e2eProcess.HasExited) {
        try {
            Stop-RunnerOwnedProcessTree -Process $e2eProcess
        }
        catch {
            $childCleanupFailure = $_
        }
    }

    if ($coordinatorRecoveryRequired -and $null -ne $coordinator) {
        try {
            if (-not (Test-DeploymentCoordinatorRunning -ContainerId $coordinator.container_id)) {
                Invoke-Docker -Arguments @('start', $coordinator.container_id) | Out-Null
            }
            $recoveredCoordinator = Get-DeploymentCoordinator -ComposeBase $composeBase -DeploymentRoot $deploymentRoot
            if ($recoveredCoordinator.container_id -ne $coordinator.container_id) {
                throw 'Coordinator recovery did not restore the exact container proven before the controlled outage.'
            }
            $coordinatorRecovered = Wait-ForHttpOk -Url $script:CoordinatorHealthUrl -TimeoutSeconds 60
            if (-not $coordinatorRecovered) {
                throw 'Coordinator did not recover its health endpoint after the controlled outage.'
            }
        }
        catch {
            $recoveryFailure = $_
        }
    }

    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
}

if ($null -ne $originalFailure) {
    $supplementalFailures = @()
    if ($null -ne $recoveryFailure) {
        $supplementalFailures += "Coordinator recovery also failed: $($recoveryFailure.Exception.Message)"
    }
    if ($null -ne $childCleanupFailure) {
        $supplementalFailures += "Runner-owned Playwright cleanup also failed: $($childCleanupFailure.Exception.Message)"
    }
    if ($supplementalFailures.Count -gt 0) {
        throw "$($originalFailure.Exception.Message) $($supplementalFailures -join ' ')"
    }
    throw $originalFailure
}
if ($null -ne $recoveryFailure) { throw $recoveryFailure }
if ($null -ne $childCleanupFailure) { throw $childCleanupFailure }

$evidence = [ordered]@{
    schema_version = 'runtime-command-authority-host-native-runner/v1'
    post_merge_corrective = $true
    tested_origin_main_sha = $originMainSha
    deployment = [ordered]@{
        root = $deploymentRoot
        data_root = $dataRoot
        coordinator = $coordinator
        coordinator_recovered = $coordinatorRecovered
    }
    runtime = $kitProcess
    fixture = [ordered]@{
        source = 'bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/data/testing.usd'
        stage_url_a = $stageUrlA
        stage_url_b = $stageUrlB
    }
    playwright = [ordered]@{
        viewer_port = $viewerPort
        output_directory = $playwrightOutput
    }
    e2e = $testEvidence
}
$evidence | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'runner-evidence.json') -Encoding utf8
Write-Host "Host-native runtime authority evidence passed: $evidenceDirectory"
