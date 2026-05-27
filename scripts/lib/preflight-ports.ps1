# scripts\lib\preflight-ports.ps1
# Preflight: Port availability audit. Read-only.
# 對每個 port,查 listen 的 PID;若 PID 在 scripts\.run\*.pid 任一檔內,
# 標 ourPidFile=true(deploy 流程後續會 skip 重啟,不會誤殺)。

Set-StrictMode -Version Latest

function Get-PidsFromRunDir {
    param(
        [Parameter(Mandatory = $true)][string] $RunDir,
        [scriptblock] $ChildPidLookup = {
            param($parentId)
            try {
                Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentId" -ErrorAction Stop |
                    ForEach-Object { [int]$_.ProcessId }
            } catch { @() }
        }
    )
    $set = @{}
    if (-not (Test-Path -LiteralPath $RunDir)) { return $set }
    # 收 PID file 內的 wrapper PID
    $wrapperIds = @()
    foreach ($file in Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
        $content = Get-Content -LiteralPath $file.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($content) {
            $procId = 0
            if ([int]::TryParse($content.Trim(), [ref]$procId)) {
                $set[$procId] = $file.Name
                $wrapperIds += $procId
            }
        }
    }
    # 遞迴展開子孫 PID(host-native-launcher 用 powershell.exe wrapper spawn 真 process,
    # :49100 owner 是 kit.exe child,:49101 owner 是 python.exe child — 都該視作 "ours")
    $stack = @($wrapperIds)
    while ($stack.Count -gt 0) {
        $current = [int]$stack[0]
        $stack = @($stack | Select-Object -Skip 1)
        $children = @(& $ChildPidLookup $current)
        foreach ($child in $children) {
            $childId = [int]$child
            if (-not $set.ContainsKey($childId)) {
                $set[$childId] = "descendant-of-$current"
                $stack += $childId
            }
        }
    }
    return $set
}

function Test-PortAvailability {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [int[]] $ExtraHostNativePorts = @(),
        [int[]] $ExtraHostNativeUdpPorts = @(),
        [scriptblock] $PortLookup = {
            param($port)
            $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($conn) { return $conn.OwningProcess } else { return $null }
        },
        [scriptblock] $UdpPortLookup = {
            param($port)
            $conn = Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
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
    $hostNativeTcpPorts = @(@(49100, 49101) + $ExtraHostNativePorts | Sort-Object -Unique)
    $hostNativeUdpPorts = @(@(47998) + $ExtraHostNativeUdpPorts | Sort-Object -Unique)
    $runDir          = Join-Path $RepoRoot 'scripts\.run'
    $ourPids         = Get-PidsFromRunDir -RunDir $runDir

    function Resolve-PortStatus {
        param([int] $Port, [string] $Protocol)
        $portPid = if ($Protocol -eq 'UDP') { & $UdpPortLookup $Port } else { & $PortLookup $Port }
        if ($null -eq $portPid) {
            return [pscustomobject]@{
                port      = $Port
                protocol  = $Protocol
                status    = 'FREE'
                pid       = $null
                name      = $null
                ourPidFile = $false
            }
        }
        # Get-NetTCPConnection.OwningProcess 是 UInt32,Get-PidsFromRunDir set key 是 Int32
        # → hashtable ContainsKey 對 type mismatch 回 false。統一 cast [int]。
        $portPidInt = [int]$portPid
        $name = & $ProcessNameLookup $portPidInt
        return [pscustomobject]@{
            port      = $Port
            protocol  = $Protocol
            status    = 'OCCUPIED'
            pid       = $portPidInt
            name      = $name
            ourPidFile = $ourPids.ContainsKey($portPidInt)
        }
    }

    $docker = @($dockerPorts | ForEach-Object { Resolve-PortStatus -Port $_ -Protocol 'TCP' })
    $hostNative = @(
        $hostNativeTcpPorts | ForEach-Object { Resolve-PortStatus -Port $_ -Protocol 'TCP' }
        $hostNativeUdpPorts | ForEach-Object { Resolve-PortStatus -Port $_ -Protocol 'UDP' }
    )

    return [pscustomobject]@{
        docker     = $docker
        hostNative = $hostNative
    }
}
