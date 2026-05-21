[CmdletBinding()]
param(
    [switch] $Build,
    [string] $EnvFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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
Write-Host "[hybrid] coordinator: http://127.0.0.1:$coordinatorPort" -ForegroundColor Green
Write-Host "[hybrid] viewer:      http://127.0.0.1:$viewerPort" -ForegroundColor Green
Write-Host "[hybrid] next: pwsh -File scripts/check-web-plane-docker.ps1 -EnvFile $resolvedEnvFile" -ForegroundColor Green
Write-Host "[hybrid] host-native conversion: pwsh -File bim-streaming-server/scripts/start-host-native-conversion-service.ps1" -ForegroundColor Yellow
