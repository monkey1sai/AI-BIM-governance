# scripts\lib\preflight-ports.ps1
# Preflight: Port availability audit. Read-only.
# 對每個 port,查 listen 的 PID;若 PID 在 scripts\.run\*.pid 任一檔內,
# 標 ourPidFile=true(deploy 流程後續會 skip 重啟,不會誤殺)。

Set-StrictMode -Version Latest

function Get-PidsFromRunDir {
    param([Parameter(Mandatory = $true)][string] $RunDir)
    $set = @{}
    if (-not (Test-Path -LiteralPath $RunDir)) { return $set }
    foreach ($file in Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
        $content = Get-Content -LiteralPath $file.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($content) {
            $procId = 0
            if ([int]::TryParse($content.Trim(), [ref]$procId)) {
                $set[$procId] = $file.Name
            }
        }
    }
    return $set
}

function Test-PortAvailability {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [scriptblock] $PortLookup = {
            param($port)
            $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($conn) { return $conn.OwningProcess } else { return $null }
        },
        [scriptblock] $ProcessNameLookup = {
            param($procId)
            try {
                $proc = Get-Process -Id $procId -ErrorAction Stop
                return $proc.ProcessName + '.exe'
            } catch { return $null }
        }
    )

    $dockerPorts     = @(8004, 5173)
    $hostNativePorts = @(49100, 49101, 47998)
    $runDir          = Join-Path $RepoRoot 'scripts\.run'
    $ourPids         = Get-PidsFromRunDir -RunDir $runDir

    function Resolve-PortStatus {
        param([int] $Port)
        $portPid = & $PortLookup $Port
        if ($null -eq $portPid) {
            return [pscustomobject]@{
                port      = $Port
                status    = 'FREE'
                pid       = $null
                name      = $null
                ourPidFile = $false
            }
        }
        $name = & $ProcessNameLookup $portPid
        return [pscustomobject]@{
            port      = $Port
            status    = 'OCCUPIED'
            pid       = $portPid
            name      = $name
            ourPidFile = $ourPids.ContainsKey($portPid)
        }
    }

    $docker     = @($dockerPorts     | ForEach-Object { Resolve-PortStatus $_ })
    $hostNative = @($hostNativePorts | ForEach-Object { Resolve-PortStatus $_ })

    return [pscustomobject]@{
        docker     = $docker
        hostNative = $hostNative
    }
}
