# Verify the runtime image launches the produced Linux Kit launcher (honest evidence).
#
# Closes the predecessor archive deferred item
#   "Validate runtime image launches produced Linux Kit launcher"
# and satisfies OpenSpec change `local-coordinator-ifc-ready-intake-boundary` T0
# (capability: runtime-image-linux-kit-launcher-readiness).
#
# Honesty rule (spec): if NVIDIA runtime / GPU / driver / Kit license/auth
# prerequisites are unavailable inside the container, the result MUST be
# recorded as `deferred` (never `passed`); a missing launcher/kit binary is
# `failed`. host-local Kit MUST NOT be used as a substitute pass.
#
# Usage:
#   pwsh -File scripts/verify-runtime-kit-launcher.ps1
#   pwsh -File scripts/verify-runtime-kit-launcher.ps1 -Image ai-bim-streaming-server-gpu-test:latest -ObserveSeconds 210

[CmdletBinding()]
param(
    [string] $Image = 'ai-bim-runtime-manager-streaming-server:latest',
    [string] $Dockerfile = 'infra/docker/bim-streaming-server-gpu.Dockerfile',
    [ValidateRange(1, 86400)]
    [int] $ObserveSeconds = 210,
    [ValidateRange(1, 65535)]
    [int] $SignalingPort = 49100,
    [string] $EvidencePath = '',
    [string] $RepoRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\smoke-evidence.ps1')

$RepoRoot = if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
} else {
    (Resolve-Path -LiteralPath $RepoRoot).Path
}
$EvidenceDir = if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    Join-Path $RepoRoot 'docs\verification\evidence\2026-05-18-t0-kit-launcher'
} else {
    Split-Path -Parent ([IO.Path]::GetFullPath($EvidencePath))
}
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    $EvidencePath = Join-Path $EvidenceDir 'kit-launcher-readiness.json'
}

$LinuxLauncher = '/workspace/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh'
$KitBinary = '/workspace/bim-streaming-server/_build/linux-x86_64/release/kit/kit'
$container = "t0-kit-launcher-$(Get-Date -Format yyyyMMddHHmmss)-$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"

function Remove-ProbeContainer {
    try {
        & docker rm -f $container 2>$null | Out-Null
    } catch {
        Write-Verbose "Failed to remove runtime Kit probe container '${container}': $PSItem"
    }
}

function Test-LocalTcpListener {
    param(
        [Parameter(Mandatory)]
        [ValidateRange(1, 65535)]
        [int] $Port,
        [ValidateRange(1, 30000)]
        [int] $TimeoutMilliseconds = 1000
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $connect.Wait($TimeoutMilliseconds)) { return $false }
        return [bool]$client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-PublishedContainerTcpListener {
    param(
        [Parameter(Mandatory)]
        [ValidateRange(1, 65535)]
        [int] $Port
    )

    # A Docker Desktop/userland proxy can own the published host port before
    # the process in the container is ready. Require both the published host
    # endpoint and the same loopback port inside this exact probe container.
    if (-not (Test-LocalTcpListener -Port $Port)) { return $false }
    try {
        & docker exec $container bash -c "exec 3<>/dev/tcp/127.0.0.1/$Port" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

trap {
    Remove-ProbeContainer
    throw
}

$Record = New-SmokeEvidenceRecord -Command $MyInvocation.MyCommand.Path -Cwd (Get-Location).Path -Context @{
    image            = $Image
    dockerfile       = $Dockerfile
    observe_seconds  = $ObserveSeconds
    signaling_port   = $SignalingPort
    change_id        = 'local-coordinator-ifc-ready-intake-boundary'
    task             = 'T0 runtime-image-linux-kit-launcher-readiness'
}

function Save-And-Summary {
    Save-SmokeEvidence -Record $Record -Path $EvidencePath | Out-Null
    Write-SmokeTierSummary -Record $Record
    Write-Host "[t0] evidence: $EvidencePath"
}

# ---- 0. docker available? ----
$dockerVersion = ''
try { $dockerVersion = (& docker version --format '{{.Server.Version}}' 2>$null) } catch { $dockerVersion = '' }
if ([string]::IsNullOrWhiteSpace($dockerVersion)) {
    Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status 'deferred' -Owner 'bim-streaming-server' `
        -Blocker 'Docker engine not available; cannot validate runtime image Kit launcher' `
        -NextCommand 'Install/start Docker, then rerun scripts/verify-runtime-kit-launcher.ps1' `
        -Ids @{ image = $Image } | Out-Null
    Save-And-Summary
    exit 0
}

# ---- 1. resolve image digest (image must already be built from the Dockerfile) ----
$imageId = ''
try { $imageId = (& docker image inspect $Image --format '{{.Id}}' 2>$null) } catch { $imageId = '' }
if ([string]::IsNullOrWhiteSpace($imageId)) {
    Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status 'deferred' -Owner 'bim-streaming-server' `
        -Blocker "Runtime image '$Image' not built; cannot validate produced Linux Kit launcher" `
        -NextCommand "docker compose -f compose.runtime-manager.yml --profile gpu build streaming-server; then rerun this script" `
        -Ids @{ image = $Image } | Out-Null
    Save-And-Summary
    exit 0
}
$imageCreated = (& docker image inspect $Image --format '{{.Created}}' 2>$null)
Write-Host "[t0] image=$Image id=$imageId created=$imageCreated"

# ---- 2. run the runtime image entrypoint with GPU, bounded observation ----
# kit-gpu-entrypoint.sh: exit 64 = launcher/kit missing (failed),
#   exit 75 = nvidia/driver unavailable (deferred), else exec Linux Kit launcher.
$logFile = Join-Path $EvidenceDir 'kit-launcher-startup.log'
if (-not (Test-Path -LiteralPath $EvidenceDir)) { New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null }

Remove-ProbeContainer
$runArgs = @(
    'run', '--name', $container, '--gpus', 'all',
    '-e', 'KIT_INSTANCE_ID=t0_kit_launcher',
    '-e', "KIT_SIGNALING_PORT=$SignalingPort",
    '-p', "$SignalingPort`:$SignalingPort/tcp",
    '-d', $Image
)
$startedId = ''
try {
    $startedId = (& docker @runArgs 2>&1 | Select-Object -Last 1)
} catch {
    $startedId = ''
}
if ([string]::IsNullOrWhiteSpace($startedId) -or "$startedId" -match 'docker:|Error') {
    Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status 'deferred' -Owner 'bim-streaming-server' `
        -Blocker "docker run with --gpus all failed: $startedId" `
        -NextCommand 'Verify NVIDIA Container Toolkit (nvidia runtime) is installed, then rerun this script' `
        -Ids @{ image = $Image; image_id = $imageId } | Out-Null
    Remove-ProbeContainer
    Save-And-Summary
    exit 0
}

# ---- 3. observe startup ----
$deadline = (Get-Date).AddSeconds($ObserveSeconds)
$status = 'not_observed'
$blocker = ''
$exitCode = $null
$reachedLaunch = $false
$portListening = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 6
    $state = (& docker inspect $container --format '{{.State.Status}}|{{.State.ExitCode}}' 2>$null)
    $logs = (& docker logs $container 2>&1) -join "`n"
    if ($logs -match '\[runtime\] launching Linux Kit streaming app') { $reachedLaunch = $true }
    if (Test-PublishedContainerTcpListener -Port $SignalingPort) { $portListening = $true }

    $parts = "$state" -split '\|'
    $st = if ($parts.Count -ge 1) { $parts[0] } else { '' }
    $ec = if ($parts.Count -ge 2) { $parts[1] } else { '' }

    if ($st -eq 'exited') {
        $exitCode = [int]$ec
        if ($exitCode -eq 64) {
            $status = 'failed'
            $blocker = 'failed_linux_kit_build: Linux Kit launcher/executable missing from runtime image'
        } elseif ($exitCode -eq 75) {
            $status = 'deferred'
            $line = ($logs -split "`n" | Where-Object { $_ -match 'blocked_gpu_runtime_unavailable' } | Select-Object -Last 1)
            $blocker = if ($line) { "$line".Trim() } else { 'blocked_gpu_runtime_unavailable: GPU/driver/NVIDIA runtime prerequisites unavailable inside container' }
        } elseif ($reachedLaunch) {
            if ("$logs" -match '(?i)licen|entitlement|omniverse.*auth|RTX.*not|vulkan.*fail|no.*display|GLFW|libGLX') {
                $status = 'deferred'
                $blocker = "Linux Kit launcher started but Kit runtime could not initialize (likely Kit license/auth or GPU display prerequisite); exit=$exitCode"
            } else {
                $status = 'failed'
                $blocker = "Linux Kit launcher started but Kit process exited unexpectedly (exit=$exitCode)"
            }
        } else {
            $status = 'failed'
            $blocker = "Container exited (exit=$exitCode) before reaching Linux Kit launcher"
        }
        break
    }

    if ($reachedLaunch -and $portListening) {
        # A launch marker alone is not readiness. The requested host port must
        # accept a real TCP connection while the container is still running.
        $status = 'passed'
        $blocker = ''
        break
    }
}

# ---- 4. capture final logs + classify if still running at window end ----
$finalLogs = (& docker logs $container 2>&1) -join "`n"
[System.IO.File]::WriteAllText($logFile, $finalLogs, [System.Text.UTF8Encoding]::new($false))
if ($status -eq 'not_observed') {
    if (Test-PublishedContainerTcpListener -Port $SignalingPort) { $portListening = $true }
    if ($reachedLaunch -and $portListening) {
        $status = 'passed'
    } elseif ($reachedLaunch) {
        $status = 'deferred'
        $blocker = "Linux Kit launcher started, but requested signaling port 127.0.0.1:$SignalingPort did not accept TCP connections within $ObserveSeconds s; inspect $logFile"
    } elseif ($portListening) {
        $status = 'deferred'
        $blocker = "Requested signaling port 127.0.0.1:$SignalingPort accepted TCP connections, but the container did not emit the Linux Kit launcher marker within $ObserveSeconds s; inspect $logFile"
    } else {
        $status = 'deferred'
        $blocker = "Runtime image entrypoint did not reach a ready Linux Kit launcher within $ObserveSeconds s (no launch marker and no TCP listener on 127.0.0.1:$SignalingPort); inspect $logFile"
    }
}

# ---- 5. teardown (always) ----
Remove-ProbeContainer

# ---- 6. emit evidence ----
$sampleUsdcNote = 'no sample USDC required for launcher-launch validation; full USDC streaming smoke is the T8 readiness tier (STORAGE_ROOT=/workspace/storage mounts ./storage)'
$tierStatus = if ($status -eq 'not_observed') { 'deferred' } else { $status }
$nextCmd = switch ($tierStatus) {
    'passed'   { 'Re-run scripts/verify-runtime-kit-launcher.ps1 to reproduce; full USDC streaming is covered by T8 smoke' }
    'deferred' { 'Resolve GPU/driver/Kit license prerequisite then rerun scripts/verify-runtime-kit-launcher.ps1' }
    default    { 'Rebuild runtime image (docker compose -f compose.runtime-manager.yml --profile gpu build streaming-server) then rerun' }
}
Add-SmokeTier -Record $Record -Tier 'runtime_image_kit_launcher' -Status $tierStatus -Owner 'bim-streaming-server' `
    -Blocker $blocker -NextCommand $nextCmd `
    -Ids @{
        image           = $Image
        image_id        = $imageId
        image_created   = $imageCreated
        launcher_path   = $LinuxLauncher
        kit_binary_path = $KitBinary
    } `
    -EvidencePaths @($logFile) `
    -Detail @{
        exit_code         = $exitCode
        reached_launch    = [bool]$reachedLaunch
        signaling_listen  = [bool]$portListening
        observe_seconds   = $ObserveSeconds
        sample_usdc_path  = $sampleUsdcNote
        classification    = 'passed=launcher marker + requested signaling TCP listener; deferred=GPU/driver/Kit license/listener unavailable; failed=launcher/kit missing or Kit crash'
    } | Out-Null

Save-And-Summary
if ($tierStatus -eq 'failed') { exit 1 }
exit 0
