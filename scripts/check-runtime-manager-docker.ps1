[CmdletBinding()]
param(
    [switch] $WithGpu
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Http {
    param([string] $Name, [string] $Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
            Write-Host "[ok] $Name $Url" -ForegroundColor Green
            return $true
        }
        Write-Host "[fail] $Name HTTP $($r.StatusCode)" -ForegroundColor Red
        return $false
    } catch {
        Write-Host "[blocked] $Name $Url :: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

function Get-ComposeArgs {
    param([switch] $Gpu)
    $composeArgs = @("compose", "-f", "compose.runtime-manager.yml", "--env-file", ".env.runtime-manager.docker")
    if ($Gpu) {
        $composeArgs += @("--profile", "gpu")
    }
    return $composeArgs
}

function Get-ComposeImageId {
    param([string] $Service, [switch] $Gpu)
    $imageArgs = (Get-ComposeArgs -Gpu:$Gpu) + @("images", "-q", $Service)
    $images = docker @imageArgs 2>$null
    if (-not $images) {
        return $null
    }
    return $images | Select-Object -First 1
}

function Test-WebViewerEngineContract {
    $image = Get-ComposeImageId -Service "viewer"
    if (-not $image) {
        Write-Host "[fail] web_viewer_engine_contract_failed image_missing" -ForegroundColor Red
        return
    }

    $nodeVersion = (docker run --rm --entrypoint node $image -v 2>&1 | Select-Object -First 1).Trim()
    $npmVersion = (docker run --rm --entrypoint npm $image -v 2>&1 | Select-Object -First 1).Trim()
    $engineStrict = (docker run --rm --entrypoint npm $image config get engine-strict 2>&1 | Select-Object -First 1).Trim()

    if ($nodeVersion -match "^v18\." -and $npmVersion -match "^10\." -and $engineStrict -eq "true") {
        Write-Host "[ok] web_viewer_engine_contract_passed node=$nodeVersion npm=$npmVersion engine-strict=$engineStrict" -ForegroundColor Green
        return
    }

    Write-Host "[fail] web_viewer_engine_contract_failed node=$nodeVersion npm=$npmVersion engine-strict=$engineStrict" -ForegroundColor Red
}

function Test-KitManagerState {
    try {
        $state = Invoke-RestMethod -Uri "http://127.0.0.1:8010/api/kit/instances/current" -TimeoutSec 5
        if ($state.status -eq "open") {
            Write-Host "[ok] kit_opened control=$($state.control_status)" -ForegroundColor Green
        } elseif ($state.status -eq "closed") {
            Write-Host "[ok] kit_closed control=$($state.control_status)" -ForegroundColor Green
        } elseif ($state.status -eq "blocked" -and "$($state.control_status)".StartsWith("blocked")) {
            Write-Host "[blocked] kit_control_blocked control=$($state.control_status)" -ForegroundColor Yellow
        } elseif ($state.status -eq "recorded_only") {
            Write-Host "[warn] recorded_only control=$($state.control_status)" -ForegroundColor Yellow
        } else {
            Write-Host "[info] kit_state status=$($state.status) control=$($state.control_status)" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "[blocked] kit_control_blocked api_unreachable :: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Test-GpuImageAndRuntime {
    $image = Get-ComposeImageId -Service "streaming-server" -Gpu
    if (-not $image) {
        Write-Host "[fail] failed_linux_kit_build image_missing" -ForegroundColor Red
        return
    }

    docker run --rm --entrypoint bash $image -lc "test -x /workspace/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[fail] failed_linux_kit_build launcher_missing" -ForegroundColor Red
        return
    }

    docker run --rm --entrypoint bash $image -lc "test -x /workspace/bim-streaming-server/_build/linux-x86_64/release/kit/kit" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[fail] failed_linux_kit_build kit_binary_missing" -ForegroundColor Red
        return
    }

    Write-Host "[ok] linux_kit_build_passed launcher_and_kit_binary_exist" -ForegroundColor Green

    $logArgs = (Get-ComposeArgs -Gpu) + @("logs", "--tail", "120", "streaming-server")
    $logs = docker @logArgs 2>&1
    if ($logs -match "failed_linux_kit_build") {
        Write-Host "[fail] failed_linux_kit_build runtime_image_missing_launcher" -ForegroundColor Red
    } elseif ($logs -match "No such file or directory") {
        Write-Host "[fail] failed_linux_kit_build runtime_launcher_dependency_missing" -ForegroundColor Red
    } elseif ($logs -match "blocked_gpu_runtime_unavailable") {
        Write-Host "[blocked] gpu_runtime_blocked blocked_gpu_runtime_unavailable" -ForegroundColor Yellow
    } elseif ($logs -match "launching Linux Kit streaming app") {
        $runningArgs = (Get-ComposeArgs -Gpu) + @("ps", "--status", "running", "-q", "streaming-server")
        $running = docker @runningArgs 2>$null
        if ($running) {
            Write-Host "[ok] gpu_runtime_passed launcher_started" -ForegroundColor Green
        } else {
            Write-Host "[blocked] gpu_runtime_blocked launcher_exited" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[info] gpu_runtime_blocked not_observed" -ForegroundColor Yellow
    }
}

$coreOk = $true
# B-scheme T2：bim-control(:8001) / worker(:8005) 已自 repo 刪除（外部平台由 tests/fakes 模擬）
$coreOk = (Test-Http "coordinator" "http://127.0.0.1:8004/health") -and $coreOk
$coreOk = (Test-Http "viewer" "http://127.0.0.1:5173") -and $coreOk
$coreOk = (Test-Http "kit-manager-api" "http://127.0.0.1:8010/health") -and $coreOk
$coreOk = (Test-Http "kit-manager-web" "http://127.0.0.1:5174") -and $coreOk

if ($coreOk) {
    Write-Host "[ok] core_endpoints_ok" -ForegroundColor Green
} else {
    Write-Host "[fail] core_endpoints_failed" -ForegroundColor Red
}

Test-WebViewerEngineContract
Test-KitManagerState

if ($WithGpu) {
    Test-GpuImageAndRuntime
}
