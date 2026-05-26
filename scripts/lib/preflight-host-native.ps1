# scripts\lib\preflight-host-native.ps1
# Preflight: Host-native 工具鏈 audit。Read-only。

Set-StrictMode -Version Latest

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
        [scriptblock] $NvidiaSmiProbe = {
            $cmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
            if (-not $cmd) { return @{ Exists = $false; ExitCode = -1 } }
            $null = & nvidia-smi --query-gpu=name --format=csv,noheader 2>&1
            return @{ Exists = $true; ExitCode = $LASTEXITCODE }
        }
    )

    $audit = [ordered]@{
        venv         = 'MISSING'
        kitLauncher  = 'MISSING_PATH'
        nvidiaDriver = 'MISSING'
        ok           = $false
    }

    # .venv
    $pyExe = Join-Path $RepoRoot '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $pyExe) {
        $ver = & $PythonVersionProbe $pyExe
        if ($ver) {
            $parts = $ver.Split('.')
            $major = [int]$parts[0]
            $minor = [int]$parts[1]
            if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 11)) {
                $audit.venv = 'OK'
            } else {
                $audit.venv = 'WRONG_VERSION'
            }
        } else {
            $audit.venv = 'WRONG_VERSION'
        }
    }

    # Kit launcher
    $launcher = Join-Path $RepoRoot 'bim-streaming-server\scripts\start-streaming-server.ps1'
    if (Test-Path -LiteralPath $launcher) {
        $audit.kitLauncher = 'OK'
    }

    # nvidia-smi
    $nv = & $NvidiaSmiProbe
    if ($nv.Exists -and $nv.ExitCode -eq 0) {
        $audit.nvidiaDriver = 'OK'
    }

    $audit.ok = ($audit.venv -eq 'OK' -and $audit.kitLauncher -eq 'OK' -and $audit.nvidiaDriver -eq 'OK')
    return [pscustomobject]$audit
}
