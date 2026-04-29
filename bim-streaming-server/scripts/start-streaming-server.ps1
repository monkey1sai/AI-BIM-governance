param(
    [string] $UsdPath = ".\bim-models\許良宇圖書館建築_2026.usd",

    [string] $TraceRoot = ".\logs\nvstreamer",

    [switch] $NoWindow = $true,

    [switch] $SkipGpuCheck,

    [switch] $PreflightOnly
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

function Initialize-WindowsRuntimeEnvironment {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $parts = $identity.Split("\", 2)
    if ($parts.Count -eq 2) {
        if ([string]::IsNullOrWhiteSpace($env:USERDOMAIN)) {
            $env:USERDOMAIN = $parts[0]
        }
        if ([string]::IsNullOrWhiteSpace($env:USERNAME)) {
            $env:USERNAME = $parts[1]
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $env:APPDATA = Join-Path $env:USERPROFILE "AppData\Roaming"
    }
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $env:LOCALAPPDATA = Join-Path $env:USERPROFILE "AppData\Local"
    }
    if ([string]::IsNullOrWhiteSpace($env:ProgramData)) {
        $env:ProgramData = "C:\ProgramData"
    }
    if ([string]::IsNullOrWhiteSpace($env:ALLUSERSPROFILE)) {
        $env:ALLUSERSPROFILE = "C:\ProgramData"
    }
    if ([string]::IsNullOrWhiteSpace($env:SystemRoot)) {
        $env:SystemRoot = "C:\WINDOWS"
    }
    if ([string]::IsNullOrWhiteSpace($env:windir)) {
        $env:windir = $env:SystemRoot
    }
    if ([string]::IsNullOrWhiteSpace($env:ComSpec)) {
        $env:ComSpec = Join-Path $env:SystemRoot "system32\cmd.exe"
    }
    if ([string]::IsNullOrWhiteSpace($env:COMPUTERNAME)) {
        $env:COMPUTERNAME = $env:USERDOMAIN
    }
}

function ConvertTo-AbsolutePath {
    param([Parameter(Mandatory = $true)][string] $Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Test-PortFree {
    param([Parameter(Mandatory = $true)][int] $Port)

    $matches = @(netstat -ano | Select-String ":$Port")
    if ($matches.Count -gt 0) {
        throw "Port $Port is already in use:`n$($matches -join "`n")"
    }
}

function Test-GpuReady {
    if ($SkipGpuCheck) {
        Write-Warning "Skipping GPU preflight check."
        return
    }

    $nvidiaSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $nvidiaSmi) {
        throw "nvidia-smi was not found. Omniverse WebRTC streaming requires a working NVIDIA GPU driver."
    }

    $output = & $nvidiaSmi.Source 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw @"
NVIDIA GPU preflight failed.

Command:
    nvidia-smi

Output:
$($output -join "`n")

Run this server from an interactive desktop session where nvidia-smi and D3D12 can initialize the GPU.
"@
    }

    Write-Host "[preflight] nvidia-smi OK"
}

Initialize-WindowsRuntimeEnvironment

$resolvedUsd = ConvertTo-AbsolutePath -Path $UsdPath
if (-not (Test-Path -LiteralPath $resolvedUsd -PathType Leaf)) {
    throw "USD file not found: $resolvedUsd"
}

$launcher = Join-Path $RepoRoot "_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Streaming launcher not found: $launcher. Run .\repo.bat build first."
}

Test-PortFree -Port 49100
Test-PortFree -Port 47998
Test-GpuReady

if ($PreflightOnly) {
    Write-Host "[preflight] USD path OK: $resolvedUsd"
    Write-Host "[preflight] ports OK: 49100 / 47998 are free"
    return
}

$kitPath = $resolvedUsd.Replace("\", "/")
$resolvedTraceRoot = ConvertTo-AbsolutePath -Path $TraceRoot
New-Item -ItemType Directory -Force -Path $resolvedTraceRoot | Out-Null

$args = @()
if ($NoWindow) {
    $args += "--no-window"
}
$args += "--/app/auto_load_usd=$kitPath"

Write-Host "[streaming] launcher: $launcher"
Write-Host "[streaming] USD     : $kitPath"
Write-Host "[streaming] traces  : $resolvedTraceRoot"
Write-Host "[streaming] ports   : 49100 / 47998"
Write-Host "[streaming] starting Kit. Press Ctrl+C to stop."

Push-Location -LiteralPath $resolvedTraceRoot
try {
    & $launcher @args
}
finally {
    Pop-Location
}
