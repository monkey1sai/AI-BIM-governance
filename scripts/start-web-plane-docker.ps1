[CmdletBinding()]
param(
    [switch] $Build,
    [string] $EnvFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Resolve-AbsoluteStorageRoot:把 RUNTIME_STORAGE_ROOT 正規化為 host 絕對路徑(正斜線),
# 供下方注入 process env(避免相對 ./storage 讓 host-native streaming-server 轉檔
# invalid_ifc_input;根因註解見該函式)。
. (Join-Path $PSScriptRoot 'lib\preflight-volume-alignment.ps1')

function Resolve-HybridEnvFile {
    param([string] $Requested)
    if (-not [string]::IsNullOrWhiteSpace($Requested)) {
        if (-not (Test-Path -LiteralPath $Requested)) {
            throw "env_file_missing: $Requested"
        }
        return $Requested
    }
    if (Test-Path -LiteralPath ".env.web-plane.host-kit") {
        return ".env.web-plane.host-kit"
    }
    return ".env.web-plane.host-kit.example"
}

function Normalize-EnvValue {
    param([string] $Raw)
    $value = $Raw.Trim()
    if ($value.Length -eq 0) { return "" }
    $first = $value.Substring(0, 1)
    if ($first -eq '"' -or $first -eq "'") {
        $closing = $value.IndexOf($first, 1)
        if ($closing -ge 1) {
            return $value.Substring(1, $closing - 1)
        }
        return $value.Trim($first)
    }
    $comment = [regex]::Match($value, "\s+#")
    if ($comment.Success) {
        $value = $value.Substring(0, $comment.Index).TrimEnd()
    }
    return $value
}

function Get-EnvDelimiterIndex {
    param([string] $Line)
    $eq = $Line.IndexOf("=")
    $colon = $Line.IndexOf(":")
    $candidates = @(@($eq, $colon) | Where-Object { $_ -gt 0 } | Sort-Object)
    if ($candidates.Count -eq 0) { return -1 }
    return [int]$candidates[0]
}

function Read-EnvFile {
    param([string] $Path)
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) { continue }
        $idx = Get-EnvDelimiterIndex -Line $trimmed
        if ($idx -le 0) { continue }
        $name = $trimmed.Substring(0, $idx).Trim()
        $value = Normalize-EnvValue -Raw $trimmed.Substring($idx + 1)
        $values[$name] = $value
    }
    return $values
}

function Value-OrDefault {
    param(
        [hashtable] $Values,
        [string] $Name,
        [string] $Default
    )
    $envValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }
    if ($Values.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace([string]$Values[$Name])) {
        return [string]$Values[$Name]
    }
    return $Default
}

$resolvedEnvFile = Resolve-HybridEnvFile -Requested $EnvFile
$envValues = Read-EnvFile -Path $resolvedEnvFile
$coordinatorPort = Value-OrDefault -Values $envValues -Name "COORDINATOR_PORT" -Default "8004"
$viewerPort = Value-OrDefault -Values $envValues -Name "VIEWER_PORT" -Default "5173"
$publicHost = Value-OrDefault -Values $envValues -Name "PUBLIC_HOST" -Default "127.0.0.1"
$coordinatorPublicUrl = Value-OrDefault -Values $envValues -Name "COORDINATOR_PUBLIC_BASE_URL" -Default "http://${publicHost}:$coordinatorPort"
$viewerPublicUrl = Value-OrDefault -Values $envValues -Name "VIEWER_PUBLIC_BASE_URL" -Default "http://${publicHost}:$viewerPort"
$viewerBindHost = Value-OrDefault -Values $envValues -Name "VIEWER_BIND_HOST" -Default "127.0.0.1"

# RUNTIME_STORAGE_ROOT 注入 process env 為 host 絕對路徑(正斜線)。compose 變數插值
# 「shell env 優先於 --env-file」,故此處覆蓋 .env 內可能的相對值(如 ./storage)。
# 相對值會經 STORAGE_HOST_ROOT → host_local_path 傳給 host-native streaming-server,
# 被其 conversion adapter 對 storage_root 二次解析成 double-nest 找不到檔 → 轉檔
# invalid_ifc_input(見 Resolve-AbsoluteStorageRoot 的根因註解)。
$repoRootForStorage = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtimeStorageRootRaw = Value-OrDefault -Values $envValues -Name "RUNTIME_STORAGE_ROOT" -Default "./storage"
$runtimeStorageRootAbs = Resolve-AbsoluteStorageRoot -RepoRoot $repoRootForStorage -Raw $runtimeStorageRootRaw
[Environment]::SetEnvironmentVariable("RUNTIME_STORAGE_ROOT", $runtimeStorageRootAbs, "Process")
Write-Host "[hybrid] RUNTIME_STORAGE_ROOT (host abs) = $runtimeStorageRootAbs" -ForegroundColor Cyan

$composeArgs = @(
    "compose",
    "-f", "compose.runtime-manager.yml",
    "-f", "compose.host-kit.yml",
    "--env-file", $resolvedEnvFile
)

$upArgs = $composeArgs + @("up", "-d")
if ($Build) {
    $upArgs += "--build"
}
$upArgs += @("coordinator", "viewer")

Write-Host "[hybrid] docker $($upArgs -join ' ')" -ForegroundColor Cyan
docker @upArgs
if ($LASTEXITCODE -ne 0) {
    throw "docker_web_plane_start_failed"
}

Write-Host ""
Write-Host "[hybrid] mode: Docker web plane + host-native Kit/conversion" -ForegroundColor Green
Write-Host "[hybrid] env file: $resolvedEnvFile" -ForegroundColor Green
Write-Host "[hybrid] coordinator: $coordinatorPublicUrl" -ForegroundColor Green
Write-Host "[hybrid] viewer:      $viewerPublicUrl (bind=$viewerBindHost)" -ForegroundColor Green
Write-Host "[hybrid] next: pwsh -File scripts/check-web-plane-docker.ps1 -EnvFile $resolvedEnvFile" -ForegroundColor Green
Write-Host "[hybrid] host-native conversion: pwsh -File bim-streaming-server/scripts/start-host-native-conversion-service.ps1" -ForegroundColor Yellow
