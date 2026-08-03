[CmdletBinding()]
param(
    [switch] $KeepLogs,   # 保留 .run/<svc>.log
    [string[]] $KitSignalPorts = @("49100"),
    [string[]] $KitStreamPorts = @("47998"),
    [string[]] $KitSpectatorSignalPorts = @(),
    [string[]] $KitSpectatorStreamPorts = @()
)

# 一鍵關閉 Phase B current demo services（與 start-all.ps1 對應）。
# 對每個 PID 做 tree-kill：taskkill /F /T，連子行程 (例如 Kit) 一起終結。

Set-StrictMode -Version Latest

# Per-OS listener lookup. Guarded so this script stays runnable standalone.
if (-not (Get-Command -Name 'Get-PlatformTcpListenerPid' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'lib/platform/platform-adapter.ps1')
}

function Get-ExpectedPortListeners {
    # Windows-only Get-NetTCPConnection made this script a FALSE SUCCESS on Linux:
    # the sweep found nothing, "全部服務已停止" printed, and the final verification
    # used the same call so it could never notice the leftovers. A surviving Kit
    # then held :49100 and the next deploy's Kit died on bind.
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][int[]] $Ports)

    $found = @()
    foreach ($port in $Ports) {
        $owner = Get-PlatformTcpListenerPid -Port ([int]$port)
        if ($null -eq $owner) { continue }
        $found += [pscustomobject]@{ LocalPort = [int]$port; OwningProcess = [int]$owner }
    }
    return @($found)
}
$ErrorActionPreference = "Continue"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RunDir = Join-Path $PSScriptRoot ".run"

function ConvertTo-PortList {
    param(
        [string[]] $Values,
        [string] $Name
    )

    $ports = @()
    foreach ($value in $Values) {
        foreach ($part in ($value -split ",")) {
            $trimmed = $part.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            $port = 0
            if (-not [int]::TryParse($trimmed, [ref] $port)) {
                throw "$Name contains a non-integer port: $trimmed"
            }
            $ports += $port
        }
    }
    return $ports
}

$ResolvedKitSignalPorts = @(ConvertTo-PortList -Values $KitSignalPorts -Name "KitSignalPorts")
$ResolvedKitStreamPorts = @(ConvertTo-PortList -Values $KitStreamPorts -Name "KitStreamPorts")
$ResolvedKitSpectatorSignalPorts = @(ConvertTo-PortList -Values $KitSpectatorSignalPorts -Name "KitSpectatorSignalPorts")
$ResolvedKitSpectatorStreamPorts = @(ConvertTo-PortList -Values $KitSpectatorStreamPorts -Name "KitSpectatorStreamPorts")
$ResolvedStreamingPorts = @($ResolvedKitSignalPorts + $ResolvedKitStreamPorts + $ResolvedKitSpectatorSignalPorts + $ResolvedKitSpectatorStreamPorts)

$ExpectedServices = @(
    # B-scheme T2：_bim-control(:8001) / _worker(:8005) 已自 repo 刪除
    @{ Name = "bim-review-coordinator"; Ports = @(8004) },
    @{ Name = "governance-service"; Ports = @(49102) },
    @{ Name = "bim-streaming-conversion-service"; Ports = @(49101) },
    @{ Name = "web-viewer-sample"; Ports = @(5173) },
    @{ Name = "bim-streaming-server"; Ports = $ResolvedStreamingPorts },
    # R5（2026-07-10 C3）：kit-manager-api 納入 golden path（deploy.ps1 Phase 4c-2 啟動）
    @{ Name = "kit-manager-api"; Ports = @(8010) }
)

$ExpectedPorts = $ExpectedServices | ForEach-Object { $_.Ports } | ForEach-Object { $_ }
$StoppedPids = @{}

function Get-ServiceNameByPort {
    param([int] $Port)

    foreach ($svc in $ExpectedServices) {
        if ($svc.Ports -contains $Port) {
            return $svc.Name
        }
    }
    return "unknown"
}

function Test-IsExpectedServiceName {
    param([string] $Name)

    if ($ExpectedServices | Where-Object { $_.Name -eq $Name } | Select-Object -First 1) {
        return $true
    }
    return $Name.StartsWith("bim-streaming-server-kit_local_")
}

function Get-ProcessInfo {
    param([int] $ProcId)

    Get-CimInstance Win32_Process -Filter "ProcessId = $ProcId" -ErrorAction SilentlyContinue
}

function Test-IsWorkspaceProcess {
    param($ProcessInfo)

    if (-not $ProcessInfo) { return $false }

    $needle = $RepoRoot.ToLowerInvariant()
    $commandLine = ""
    $executablePath = ""
    if ($ProcessInfo.CommandLine) { $commandLine = $ProcessInfo.CommandLine.ToLowerInvariant() }
    if ($ProcessInfo.ExecutablePath) { $executablePath = $ProcessInfo.ExecutablePath.ToLowerInvariant() }

    return ($commandLine.Contains($needle) -or $executablePath.Contains($needle))
}

function Stop-ProcessTree {
    param(
        [string] $Name,
        [int] $ProcId,
        [string] $Source
    )

    if ($StoppedPids.ContainsKey($ProcId)) { return }

    try {
        $null = Get-Process -Id $ProcId -ErrorAction Stop
        Write-Host "[stop ] $Name (PID=$ProcId, source=$Source) ..." -ForegroundColor Cyan
        & taskkill.exe /F /T /PID $ProcId 2>&1 | Out-Null
        $StoppedPids[$ProcId] = $true
    } catch {
        Write-Host "[skip ] $Name (PID=$ProcId) 已不存在" -ForegroundColor DarkGray
        $StoppedPids[$ProcId] = $true
    }
}

if (-not (Test-Path $RunDir)) {
    Write-Host "[stop ] 沒有 scripts/.run/ 目錄，改用 port/process fallback 檢查" -ForegroundColor DarkGray
} else {
    $pidFiles = @(Get-ChildItem -Path $RunDir -Filter "*.pid" -ErrorAction SilentlyContinue)

    if (-not $pidFiles -or $pidFiles.Count -eq 0) {
        Write-Host "[stop ] 找不到任何 PID 檔，改用 port/process fallback 檢查" -ForegroundColor DarkGray
    }

    foreach ($f in $pidFiles) {
        $name = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        if (-not (Test-IsExpectedServiceName -Name $name)) {
            Write-Host "[skip ] $name 不屬於 Phase B current demo services，移除 stale PID file" -ForegroundColor DarkGray
            Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
            if (-not $KeepLogs) {
                Remove-Item (Join-Path $RunDir "$name.log") -Force -ErrorAction SilentlyContinue
                Remove-Item (Join-Path $RunDir "$name.log.err") -Force -ErrorAction SilentlyContinue
            }
            continue
        }
        $procIdText = Get-Content $f.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $procIdText) {
            Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
            continue
        }

        $procId = 0
        if ([int]::TryParse($procIdText, [ref] $procId)) {
            Stop-ProcessTree -Name $name -ProcId $procId -Source "pid-file"
        } else {
            Write-Host "[skip ] $name PID 檔內容不是數字：$procIdText" -ForegroundColor Yellow
        }

        Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
        if (-not $KeepLogs) {
            Remove-Item (Join-Path $RunDir "$name.log") -Force -ErrorAction SilentlyContinue
            Remove-Item (Join-Path $RunDir "$name.log.err") -Force -ErrorAction SilentlyContinue
        }
    }
}

$listening = @(Get-ExpectedPortListeners -Ports $ExpectedPorts)

foreach ($conn in $listening) {
    $procId = [int] $conn.OwningProcess
    if ($procId -le 0 -or $StoppedPids.ContainsKey($procId)) { continue }

    $processInfo = Get-ProcessInfo -ProcId $procId
    $name = Get-ServiceNameByPort -Port ([int] $conn.LocalPort)

    if (Test-IsWorkspaceProcess -ProcessInfo $processInfo) {
        Stop-ProcessTree -Name $name -ProcId $procId -Source "port:$($conn.LocalPort)"
        if ((Test-Path $RunDir) -and -not $KeepLogs) {
            Remove-Item (Join-Path $RunDir "$name.log") -Force -ErrorAction SilentlyContinue
            Remove-Item (Join-Path $RunDir "$name.log.err") -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "[skip ] port $($conn.LocalPort) PID=$procId 不屬於此 workspace，未停止" -ForegroundColor Yellow
    }
}

Start-Sleep -Milliseconds 500
$remaining = @(Get-ExpectedPortListeners -Ports $ExpectedPorts)

$workspaceRemaining = @()
foreach ($conn in $remaining) {
    $processInfo = Get-ProcessInfo -ProcId ([int] $conn.OwningProcess)
    if (Test-IsWorkspaceProcess -ProcessInfo $processInfo) {
        $workspaceRemaining += $conn
    }
}

Write-Host ""
if ($workspaceRemaining.Count -gt 0) {
    Write-Host "[warn ] 部分 workspace 服務仍在 listen：" -ForegroundColor Yellow
    foreach ($conn in $workspaceRemaining) {
        Write-Host "       port $($conn.LocalPort), PID=$($conn.OwningProcess)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[done ] 全部服務已停止" -ForegroundColor Green
}
