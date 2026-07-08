# scripts\lib\preflight-host-native.ps1
# Preflight: Host-native 工具鏈 audit。Read-only。

Set-StrictMode -Version Latest

function Get-KitRuntimeBuildArtifacts {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $RepoRoot)

    $launcher = Join-Path $RepoRoot 'bim-streaming-server\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat'
    $kitExe = Join-Path $RepoRoot 'bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe'
    $missing = @()
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { $missing += 'streaming_launcher' }
    if (-not (Test-Path -LiteralPath $kitExe -PathType Leaf)) { $missing += 'kit_exe' }

    $status = if ($missing.Count -eq 0) { 'OK' } else { 'NEEDS_BUILD' }
    $reason = if ($missing.Count -eq 0) { '' } else { "missing $($missing -join ',')" }

    return [pscustomobject]@{
        status       = $status
        reason       = $reason
        missing      = @($missing)
        launcherPath = $launcher
        kitExePath   = $kitExe
        buildCommand = 'cd bim-streaming-server; .\repo.bat build'
    }
}

function Test-HostNativePythonDependencies {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $PythonExe)

    $probe = @'
import importlib.metadata as metadata
import importlib.util
import json

versioned_required = {
    "fastapi": "0.115.6",
    "starlette": "0.41.3",
    "uvicorn": "0.45.0",
}
import_required = ("pxr", "ifcopenshell")

versions = {}
missing = []
for name in versioned_required:
    try:
        versions[name] = metadata.version(name)
    except metadata.PackageNotFoundError:
        versions[name] = ""
        missing.append(name)

for name in import_required:
    try:
        spec = importlib.util.find_spec(name)
    except Exception:
        spec = None
    if spec is None:
        missing.append(name)

def parse_version(value):
    parts = []
    for item in value.split("."):
        digits = "".join(ch for ch in item if ch.isdigit())
        parts.append(int(digits or 0))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])

status = "OK"
reason = ""
if missing:
    status = "MISSING"
    reason = "missing " + ",".join(missing)
else:
    fastapi_version = parse_version(versions["fastapi"])
    starlette_version = parse_version(versions["starlette"])
    if fastapi_version != parse_version("0.115.6"):
        status = "INCOMPATIBLE"
        reason = "fastapi " + versions["fastapi"] + " does not match repo baseline 0.115.6"
    elif starlette_version != parse_version("0.41.3"):
        status = "INCOMPATIBLE"
        reason = "starlette " + versions["starlette"] + " does not match repo baseline 0.41.3"
    elif parse_version(versions["uvicorn"]) != parse_version("0.45.0"):
        status = "INCOMPATIBLE"
        reason = "uvicorn " + versions["uvicorn"] + " does not match repo baseline 0.45.0"

print(json.dumps({
    "Status": status,
    "Reason": reason,
    "FastApi": versions["fastapi"],
    "Starlette": versions["starlette"],
    "Uvicorn": versions["uvicorn"],
}))
'@

    try {
        $out = $probe | & $PythonExe - 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            return @{
                Status = 'MISSING'
                Reason = (($out | Out-String).Trim())
                FastApi = ''
                Starlette = ''
                Uvicorn = ''
            }
        }
        $parsed = ($out | Out-String) | ConvertFrom-Json
        return @{
            Status = [string]$parsed.Status
            Reason = [string]$parsed.Reason
            FastApi = [string]$parsed.FastApi
            Starlette = [string]$parsed.Starlette
            Uvicorn = [string]$parsed.Uvicorn
        }
    } catch {
        return @{
            Status = 'MISSING'
            Reason = $_.Exception.Message
            FastApi = ''
            Starlette = ''
            Uvicorn = ''
        }
    }
}

function Test-HostNativeEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [scriptblock] $PythonVersionProbe = {
            param($exe)
            try {
                $out = & $exe --version 2>&1
                if ($out -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
                return $null
            } catch { return $null }
        },
        [scriptblock] $PythonDependencyProbe = {
            param($exe)
            Test-HostNativePythonDependencies -PythonExe $exe
        },
        [scriptblock] $NvidiaSmiProbe = {
            $cmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
            if (-not $cmd) { return @{ Exists = $false; ExitCode = -1 } }
            $null = & nvidia-smi --query-gpu=name --format=csv,noheader 2>&1
            return @{ Exists = $true; ExitCode = $LASTEXITCODE }
        }
    )

    $audit = [ordered]@{
        venv                    = 'MISSING'
        pythonExe               = ''
        pythonDependencies      = 'MISSING'
        pythonDependencyReason  = ''
        pythonDependencyFastApi = ''
        pythonDependencyStarlette = ''
        pythonDependencyUvicorn = ''
        kitLauncher             = 'MISSING_PATH'
        kitLauncherPath         = ''
        kitRuntime              = 'NEEDS_BUILD'
        kitBuildRequired        = $true
        kitBuildReason          = ''
        kitRuntimeLauncherPath  = ''
        kitRuntimeBinaryPath    = ''
        kitBuildCommand         = 'cd bim-streaming-server; .\repo.bat build'
        nvidiaDriver            = 'MISSING'
        ok                      = $false
    }

    # .venv
    $pyExe = Join-Path $RepoRoot '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $pyExe) {
        $audit.pythonExe = $pyExe
        $ver = & $PythonVersionProbe $pyExe
        if ($ver) {
            $parts = $ver.Split('.')
            $major = [int]$parts[0]
            $minor = [int]$parts[1]
            if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 11)) {
                $audit.venv = 'OK'
                $deps = & $PythonDependencyProbe $pyExe
                $audit.pythonDependencies = [string]$deps.Status
                $audit.pythonDependencyReason = [string]$deps.Reason
                $audit.pythonDependencyFastApi = [string]$deps.FastApi
                $audit.pythonDependencyStarlette = [string]$deps.Starlette
                $audit.pythonDependencyUvicorn = [string]$deps.Uvicorn
            } else {
                $audit.venv = 'WRONG_VERSION'
            }
        } else {
            $audit.venv = 'WRONG_VERSION'
        }
    }

    # Kit launcher
    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
    $audit.kitLauncherPath = $launcher
    if (Test-Path -LiteralPath $launcher) {
        $audit.kitLauncher = 'OK'
    }

    $kitRuntime = Get-KitRuntimeBuildArtifacts -RepoRoot $RepoRoot
    $audit.kitRuntime = $kitRuntime.status
    $audit.kitBuildRequired = ($kitRuntime.status -ne 'OK')
    $audit.kitBuildReason = $kitRuntime.reason
    $audit.kitRuntimeLauncherPath = $kitRuntime.launcherPath
    $audit.kitRuntimeBinaryPath = $kitRuntime.kitExePath
    $audit.kitBuildCommand = $kitRuntime.buildCommand

    # nvidia-smi
    $nv = & $NvidiaSmiProbe
    if ($nv.Exists -and $nv.ExitCode -eq 0) {
        $audit.nvidiaDriver = 'OK'
    }

    $audit.ok = ($audit.venv -eq 'OK' -and $audit.pythonDependencies -eq 'OK' -and $audit.kitLauncher -eq 'OK' -and $audit.kitRuntime -eq 'OK' -and $audit.nvidiaDriver -eq 'OK')
    return [pscustomobject]$audit
}
