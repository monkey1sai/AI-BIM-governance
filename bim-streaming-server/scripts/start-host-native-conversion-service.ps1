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

# storage sandbox root — 不變式(正本註解在 scripts/lib/host-native-launcher.ps1 的
# Start-HostNativeConversion):STORAGE_ROOT 是 conversion service 內
# ifc2usdc_powershell_adapter.py 用來驗 dispatch payload host_local_path 的 sandbox 根。
# coordinator 給的 host_local_path = <runtime storage root>\ifc-cache\<job>\source.ifc,
# 所以 STORAGE_ROOT 必須等於 coordinator 派工用的那個 runtime storage root。
#
# 這裡刻意不猜路徑。舊版在缺值時把 STORAGE_ROOT 預設成 <repoRoot>\storage 並把該目錄
# 建出來,於是任何不經 deploy.ps1 的啟動路徑(例如 scripts/start-all.ps1)看起來一切正常,
# 卻對每一筆轉檔回 `invalid_ifc_input: local IFC path is outside storage_root`,而且訊息
# 把人帶往「路徑非法」而不是「sandbox 根設錯」(issue #626)。缺值時只接受
# RUNTIME_STORAGE_ROOT——部署契約(scripts/deploy.ps1 的 edge runtime contract)寫下的
# 同一個值;兩者皆缺即 fail closed,與 adapter 自身「拒絕 fallback 到 cwd」的設計一致。
function Get-ConversionStorageRootComparisonKey {
    param([Parameter(Mandatory = $true)][string] $Path)
    # 比較用正規化:去頭尾空白、解析成絕對路徑、去尾端分隔符。大小寫一律忽略——本啟動
    # 路徑的正規宿主是 Windows(路徑不分大小寫);在區分大小寫的檔案系統上,只差大小寫的
    # 兩個真實不同目錄會被判為一致,方向是「少擋一次」而不是「誤擋一次合法啟動」。
    $trimmed = $Path.Trim()
    try {
        $full = [System.IO.Path]::GetFullPath($trimmed)
    }
    catch {
        # 路徑含非法字元時不要用一個更難懂的例外蓋掉本層的診斷訊息;退回原字串比較,
        # 不一致仍會被下方的斷言擋下。
        return $trimmed.TrimEnd([char[]]@('\', '/'))
    }
    return $full.TrimEnd([char[]]@('\', '/'))
}

$storageRootRaw = $env:STORAGE_ROOT
$runtimeStorageRootRaw = $env:RUNTIME_STORAGE_ROOT
$storageRootSource = 'STORAGE_ROOT'
if ([string]::IsNullOrWhiteSpace($storageRootRaw)) {
    if ([string]::IsNullOrWhiteSpace($runtimeStorageRootRaw)) {
        Write-Error ("STORAGE_ROOT is not configured and RUNTIME_STORAGE_ROOT is not set either. " +
            "This service validates every dispatched host_local_path against STORAGE_ROOT, and the " +
            "coordinator dispatches <runtime storage root>\ifc-cache\<job>\source.ifc, so STORAGE_ROOT must " +
            "equal the coordinator's runtime storage root (invariant: Start-HostNativeConversion in " +
            "scripts/lib/host-native-launcher.ps1). Refusing to guess a storage root: set STORAGE_ROOT or " +
            "RUNTIME_STORAGE_ROOT before starting this service, or start it through scripts/deploy.ps1 or " +
            "scripts/start-all.ps1, which set them for you.") -ErrorAction Continue
        exit 2
    }
    $storageRootRaw = $runtimeStorageRootRaw
    $storageRootSource = 'RUNTIME_STORAGE_ROOT'
}
elseif (-not [string]::IsNullOrWhiteSpace($runtimeStorageRootRaw)) {
    # 兩個都設了就必須是同一個目錄。不然這個服務會拿一個 coordinator 從來不寫入的
    # sandbox 去驗每一筆派工,而且要等第一筆轉檔失敗才看得出來。
    $storageRootKey = Get-ConversionStorageRootComparisonKey -Path $storageRootRaw
    $runtimeStorageRootKey = Get-ConversionStorageRootComparisonKey -Path $runtimeStorageRootRaw
    if (-not $storageRootKey.Equals($runtimeStorageRootKey, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Error ("STORAGE_ROOT and RUNTIME_STORAGE_ROOT name different directories, so this service would " +
            "validate every dispatched IFC against a sandbox the coordinator never writes to. " +
            "STORAGE_ROOT='$storageRootRaw' (normalized '$storageRootKey'); " +
            "RUNTIME_STORAGE_ROOT='$runtimeStorageRootRaw' (normalized '$runtimeStorageRootKey'). " +
            "They must name the same directory (invariant: Start-HostNativeConversion in " +
            "scripts/lib/host-native-launcher.ps1). Refusing to start.") -ErrorAction Continue
        exit 2
    }
}
$env:STORAGE_ROOT = $storageRootRaw
# 確保 sandbox base 目錄存在,否則 adapter 會在 request 期才因目錄缺失 fail、難診斷。
# 只為「被明示宣告」的 root 建目錄:先前的問題不是建目錄,是為猜出來的路徑建目錄。
if (-not (Test-Path -LiteralPath $env:STORAGE_ROOT)) {
    New-Item -ItemType Directory -Force -Path $env:STORAGE_ROOT | Out-Null
}
Write-Host "STORAGE_ROOT: $($env:STORAGE_ROOT) (source: $storageRootSource)"

Push-Location $moduleDir
try {
    & $PythonExe "-c" "import host_native_conversion_service as s; raise SystemExit(s.main())"
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
