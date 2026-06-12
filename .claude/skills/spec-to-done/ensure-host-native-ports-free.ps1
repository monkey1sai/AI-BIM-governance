# spec-to-done helper — host-native port 乾淨化（啟動 / 重建 backend stack 前的前置）
#
# 目的：跑 deploy.ps1 / rebuild-test-deploy.ps1 -Build 之前，先把佔住「必要 host-native port」的
#   舊 process（殘留的 kit.exe / conversion python.exe 等）乾淨停掉並等 port 釋放。否則 deploy.ps1
#   Phase 3「Interactive guard」會把這些『非 docker forwarder 的 stranger PID』丟給 Read-Host 'y/N'；
#   spec-to-done 無人值守、stdin 非互動 → Read-Host 無限阻塞 → 卡住數小時。
#   tree-kill 同時釋放 Kit 對 storage/*.usd(c) 的檔案鎖，根治「殘留導致 viewer 切不動 / 轉檔覆寫失敗」。
#
# 為何不直接用 stop-all.ps1：stop-all 只停「commandline 含當前 RepoRoot」的 process（Test-IsWorkspaceProcess），
#   跨工作區 / 部署區(D:\Users\deploy\AI-bim-geo) 啟動的殘留 kit.exe 會被漏掉；且 .pid 被 `git clean -fdx`
#   清掉後 .pid 路徑也失效。本 helper 改走 by-port + process-name 比對，不依賴 .pid / workspace 路徑。
#
# 授權依據：CLAUDE.md「若 deploy.ps1 -Build 被外部 kit.exe / conversion python.exe 等 host-native runtime
#   blocker 佔用必要 ports 擋住，可停止該 blocking PID 並重跑同一條 -Build」。本 helper 只 tree-kill
#   host-native runtime，不碰 docker plane（wslrelay/docker 交給 deploy.ps1 idempotent 處理），不用 -Force / -DryRun。
#
# 退出碼：0 = 全部必要 port 已 FREE（可安全啟動 stack）；1 = 逾時仍有殘留 / detect 模式偵測到佔用
#   （已列出 PID 供升級處置，不靜默卡住）。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File ensure-host-native-ports-free.ps1               # 實際停（預設）
#   powershell -NoProfile -ExecutionPolicy Bypass -File ensure-host-native-ports-free.ps1 -DetectOnly    # 只偵測列出，不停

[CmdletBinding()]
param(
    [int] $TimeoutSec = 30,
    [switch] $DetectOnly,
    # 拓樸參數，預設對齊 deploy.ps1。自訂 deploy 拓樸時用同一組值呼叫，spectator port 會依
    # SpectatorCount 自動推導（不再寫死）。SpectatorCount=0 時只清 primary（Kit + conversion）。
    [int] $KitSignalPort = 49100,
    [int] $KitMediaPort = 47998,
    [int] $ConversionPort = 49101,
    [int] $SpectatorCount = 5,
    [int] $SpectatorSignalStart = 49110,
    [int] $SpectatorMediaStart = 48008,
    [int] $SpectatorStride = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# 必要 host-native ports：primary（Kit signaling/media + conversion）+ N 個 spectator，依 SpectatorCount
# 推導（對齊 deploy.ps1 的 New-PortSequence：start + i*stride）。spectator count 不再寫死。
$tcpPorts = @($KitSignalPort, $ConversionPort)  # Kit signaling + conversion
$udpPorts = @($KitMediaPort)                     # Kit media
for ($i = 0; $i -lt $SpectatorCount; $i++) {
    $tcpPorts += ($SpectatorSignalStart + ($i * $SpectatorStride))
    $udpPorts += ($SpectatorMediaStart + ($i * $SpectatorStride))
}
$tcpPorts = @($tcpPorts | Sort-Object -Unique)
$udpPorts = @($udpPorts | Sort-Object -Unique)

# 只對這些 host-native runtime 程序放行 tree-kill（ProcessName，不含 .exe）。
# by-port + name 雙條件：佔 49100 的 kit / 佔 49101 的 python 必為本系統 runtime，
# 不會誤殺機器上其他無關的 python.exe。
$killablePattern = '^(kit|kitd|python|pythonw|nvstreamer|pvd_streamer)$'

function Get-PortOwnerPid {
    param([int] $Port, [ValidateSet('TCP', 'UDP')][string] $Protocol)
    if ($Protocol -eq 'UDP') {
        $conn = Get-NetUDPEndpoint -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    } else {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($null -ne $conn -and $conn.OwningProcess) { return [int]$conn.OwningProcess }
    return $null
}

function Get-BusyPorts {
    $busy = @()
    foreach ($p in $tcpPorts) {
        $owner = Get-PortOwnerPid -Port $p -Protocol 'TCP'
        if ($null -ne $owner) { $busy += [pscustomobject]@{ Port = $p; Protocol = 'TCP'; ProcId = $owner } }
    }
    foreach ($p in $udpPorts) {
        $owner = Get-PortOwnerPid -Port $p -Protocol 'UDP'
        if ($null -ne $owner) { $busy += [pscustomobject]@{ Port = $p; Protocol = 'UDP'; ProcId = $owner } }
    }
    return @($busy)
}

function Get-ProcName {
    param([int] $ProcId)
    $proc = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
    if ($null -ne $proc) { return $proc.ProcessName }
    return '(exited)'
}

# DetectOnly：只偵測一輪、列出佔用，不 kill、不等。
if ($DetectOnly) {
    $busy = Get-BusyPorts
    if ($busy.Count -eq 0) {
        Write-Host '[detect] all required host-native ports FREE'
        exit 0
    }
    Write-Host '[detect] required host-native ports occupied:'
    foreach ($b in $busy) {
        $name = Get-ProcName -ProcId $b.ProcId
        $verdict = if ($name -match $killablePattern) { 'killable (host-native runtime)' } else { 'NOT killable (review manually)' }
        Write-Host ("        {0}/{1} PID={2} ({3}) -> {4}" -f $b.Protocol, $b.Port, $b.ProcId, $name, $verdict)
    }
    exit 1
}

# 主迴圈：tree-kill host-native owner，輪詢等到全 FREE 或逾時。
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ($true) {
    $busy = Get-BusyPorts
    if ($busy.Count -eq 0) {
        Write-Host '[ports-free] all required host-native ports FREE'
        exit 0
    }
    foreach ($b in $busy) {
        $name = Get-ProcName -ProcId $b.ProcId
        if ($name -match $killablePattern) {
            Write-Host ("[stop ] {0}/{1} owned by {2} PID={3} -> taskkill /F /T" -f $b.Protocol, $b.Port, $name, $b.ProcId)
            & taskkill.exe /F /T /PID $b.ProcId 2>&1 | Out-Null
        } else {
            Write-Host ("[warn ] {0}/{1} owned by {2} PID={3} — not a host-native runtime; left untouched" -f $b.Protocol, $b.Port, $name, $b.ProcId)
        }
    }
    if ((Get-Date) -gt $deadline) {
        Write-Host '[fail ] timeout: required host-native ports still occupied after stop attempts:'
        foreach ($b in (Get-BusyPorts)) {
            $name = Get-ProcName -ProcId $b.ProcId
            Write-Host ("        {0}/{1} PID={2} ({3})" -f $b.Protocol, $b.Port, $b.ProcId, $name)
        }
        exit 1
    }
    Start-Sleep -Milliseconds 1000
}
