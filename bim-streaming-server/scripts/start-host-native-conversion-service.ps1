# Host-native IFC->USDC conversion authority service launcher
# (introduce-host-native-conversion-authority-service, design.md D6).
#
# Windows host-native start. Launch this from PowerShell, NOT Git Bash:
# the converter path (`scripts/convert-ifc-to-usdc.ps1` -> Kit/HOOPS) relies on
# PowerShell `.ps1` / `.bat` semantics that Git Bash mangles. Git Bash is only a
# git shell here, not the `.bat`/Kit launcher environment.
#
# This runner is conversion-only. It binds 127.0.0.1:49101 and does NOT start
# Kit, WebRTC (49100), or a viewport; those are separate tiers.
#
# Usage:
#   pwsh -File bim-streaming-server/scripts/start-host-native-conversion-service.ps1
#   $env:STREAMING_CONVERSION_PORT="49101"; pwsh -File bim-streaming-server/scripts/start-host-native-conversion-service.ps1
#   $env:STREAMING_CONVERSION_KIT_EXE="C:\path\to\kit.exe"; ... (real converter prereqs)
#
# Honest behavior: with no real converter prerequisites configured, the service
# still starts and serves /health + the conversion API, but conversion jobs fail
# with `converter_unavailable` (blocked) instead of publishing fake-ready
# results (see ifc2usdc_powershell_adapter preflight).

[CmdletBinding()]
param(
    [string] $BindHost = $env:STREAMING_CONVERSION_HOST,
    # Keep as string: eager [int] casting in the default would fail parameter
    # binding (InvalidArgument) when STREAMING_CONVERSION_PORT is non-numeric,
    # before the script can apply a safe fallback.
    [string] $PortRaw  = $env:STREAMING_CONVERSION_PORT,
    [string] $PythonExe = $(if ($env:STREAMING_CONVERSION_PYTHON) { $env:STREAMING_CONVERSION_PYTHON } else { "python" })
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BindHost)) { $BindHost = "127.0.0.1" }

$Port = 49101
if (-not [string]::IsNullOrWhiteSpace($PortRaw)) {
    $parsed = 0
    if ([int]::TryParse($PortRaw, [ref]$parsed) -and $parsed -ge 1 -and $parsed -le 65535) {
        $Port = $parsed
    }
    else {
        Write-Warning "STREAMING_CONVERSION_PORT='$PortRaw' invalid; using $Port"
    }
}

$serverRoot = Split-Path -Parent $PSScriptRoot
$moduleDir = Join-Path $serverRoot "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"

if (-not (Test-Path (Join-Path $moduleDir "host_native_conversion_service.py"))) {
    Write-Error "host_native_conversion_service.py not found under $moduleDir"
    exit 2
}

$env:STREAMING_CONVERSION_HOST = $BindHost
$env:STREAMING_CONVERSION_PORT = "$Port"

Write-Host "host-native conversion authority -> http://${BindHost}:${Port} (conversion-only; not WebRTC/Kit)"
Write-Host "module dir: $moduleDir"

# storage sandbox root: the conversion authority refuses to fall back to cwd, so
# default STORAGE_ROOT to the repo's storage/ dir when the operator did not set it.
if ([string]::IsNullOrWhiteSpace($env:STORAGE_ROOT)) {
    $repoRoot = Split-Path -Parent $serverRoot
    $env:STORAGE_ROOT = Join-Path $repoRoot "storage"
}
# 確保 sandbox base 目錄存在,否則 adapter 會在 request 期才因目錄缺失 fail、難診斷。
if (-not (Test-Path $env:STORAGE_ROOT)) {
    New-Item -ItemType Directory -Force -Path $env:STORAGE_ROOT | Out-Null
}
Write-Host "STORAGE_ROOT: $($env:STORAGE_ROOT)"

Push-Location $moduleDir
try {
    & $PythonExe "-c" "import host_native_conversion_service as s; raise SystemExit(s.main())"
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
