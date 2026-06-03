# scripts\tests\test-deploy-nullderef-guard.ps1
# 固化 deploy-nullderef-guard:deploy.ps1 兩處對「空 / 不存在」檔的 .Trim() null-deref 防禦。
#   - DEPLOY-001: Print-FinalSummary 失敗分支對空 .pid 檔的 Get-Content guard,
#                 確保 Final Summary 不在印出診斷前 throw。
#   - DEPLOY-002: Test-KitRuntimeSignatureMatches 對「存在但空」signature 檔回 $false 不 throw。
#
# 為何不 dot-source deploy.ps1:deploy.ps1 頂層(Phase 1 preflight,約 :439 起)在載入時
# 立即執行整條 audit pipeline,無法只取其函式做單元測試(同 test-deploy-env-fallback.ps1
# 對 deploy.ps1 解析分支的處理方式——改測等價單元邏輯)。Test-KitRuntimeSignatureMatches
# 是純函式,本檔以 byte-faithful 的本地複本驗證其 guard 行為;Print-FinalSummary 依賴大量
# script-scope 變數,本檔針對其 load-bearing 的「空 .pid Get-Content guard 迴圈」邏輯做等價驗證。
# 兩個測試都先證明「未防禦寫法」在 strict-mode 下確實 throw(RED),再證明「已防禦寫法」安全(GREEN)。
# 沿用 test-helpers.ps1 的 dot-source + 自訂 assert + temp sandbox 風格;不依賴 Pester。
. (Join-Path $PSScriptRoot 'test-helpers.ps1')

Set-StrictMode -Version Latest

# deploy.ps1 :406 Test-KitRuntimeSignatureMatches 的 byte-faithful 複本(DEPLOY-002 修復後)。
# 與受測函式同步;若 deploy.ps1 改了 guard,本複本需一起改,測試才有意義。
function Test-KitRuntimeSignatureMatches {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Expected
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
    $actual = if ($null -ne $raw) { $raw.Trim() } else { '' }
    return ($actual -eq $Expected)
}

# ---------------------------------------------------------------------------
# RED 防呆:先證明「未防禦」寫法在 strict-mode 下對空檔確實 throw(否則 GREEN 測試是 tautology)。
# 這正是 DEPLOY-002 修復前 deploy.ps1 的原始程式碼:(Get-Content -Raw).Trim()。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-nullderef-002-red'
try {
    $emptySig = Join-Path $sb 'bim-streaming-server.params.json'
    # 建真零位元組空檔(版本無關):Set-Content -NoNewline 在部分 Windows PowerShell 5.1 缺席,
    # 改用 .NET WriteAllText 確保 powershell.exe / pwsh 皆建出 0-byte 檔。
    [System.IO.File]::WriteAllText($emptySig, '')
    Assert-Throws {
        $r = (Get-Content -LiteralPath $emptySig -Raw -ErrorAction SilentlyContinue).Trim()
        $r
    } 'unguarded (Get-Content -Raw).Trim() throws on empty signature file under strict-mode (regression baseline)'
    Write-TestPass 'DEPLOY-002 RED: unguarded .Trim() on empty signature throws'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# DEPLOY-002 GREEN: 存在但「空」signature 檔 → Test-KitRuntimeSignatureMatches 回 $false 不 throw。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-nullderef-002-empty'
try {
    $emptySig = Join-Path $sb 'bim-streaming-server.params.json'
    # 真零位元組空檔(版本無關),理由同上。
    [System.IO.File]::WriteAllText($emptySig, '')
    $result = $null
    # 直接呼叫受測複本:期望 $false,且過程不得 throw(用內層旗標表達「期望不 throw」)。
    $threw = $false
    try { $result = Test-KitRuntimeSignatureMatches -Path $emptySig -Expected 'some-signature' }
    catch { $threw = $true }
    Assert-True (-not $threw) 'Test-KitRuntimeSignatureMatches does not throw on existing-but-empty signature file'
    Assert-Equal $false $result 'empty signature file is treated as non-matching ($false)'
    Write-TestPass 'DEPLOY-002 GREEN: empty signature -> $false, no throw'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# DEPLOY-002 補充:不存在的 signature 檔 → $false(既有行為,確保 guard 沒退化此分支)。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-nullderef-002-missing'
try {
    $missingSig = Join-Path $sb 'does-not-exist.params.json'
    $threw = $false
    $result = $null
    try { $result = Test-KitRuntimeSignatureMatches -Path $missingSig -Expected 'some-signature' }
    catch { $threw = $true }
    Assert-True (-not $threw) 'Test-KitRuntimeSignatureMatches does not throw on missing signature file'
    Assert-Equal $false $result 'missing signature file -> $false'
    Write-TestPass 'DEPLOY-002: missing signature -> $false, no throw'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# DEPLOY-002 補充:非空且相符 → $true(確保 guard 沒誤殺 happy path)。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-nullderef-002-match'
try {
    $sig = Join-Path $sb 'bim-streaming-server.params.json'
    Set-Content -LiteralPath $sig -Value '{"publicHost":"127.0.0.1"}' -Encoding ascii
    $result = Test-KitRuntimeSignatureMatches -Path $sig -Expected '{"publicHost":"127.0.0.1"}'
    Assert-Equal $true $result 'non-empty matching signature -> $true (happy path preserved)'
    Write-TestPass 'DEPLOY-002: non-empty matching signature -> $true'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# DEPLOY-001 RED 防呆:Print-FinalSummary 失敗分支對空 .pid 的「未防禦」讀法
#   (Get-Content $pidFile.FullName | Select-Object -First 1).Trim()
# 在 strict-mode + 空檔時對 $null 呼叫 .Trim() → throw。先固化此 regression baseline。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-nullderef-001-red'
try {
    $emptyPid = Join-Path $sb 'bim-streaming-server.pid'
    # 真零位元組空檔(版本無關),理由同上。
    [System.IO.File]::WriteAllText($emptyPid, '')
    Assert-Throws {
        $r = (Get-Content $emptyPid -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
        $r
    } 'unguarded (Get-Content | Select -First 1).Trim() throws on empty .pid under strict-mode (regression baseline)'
    Write-TestPass 'DEPLOY-001 RED: unguarded .Trim() on empty .pid throws'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# DEPLOY-001 GREEN: 把 Print-FinalSummary 失敗分支「列 PID-file」迴圈的 load-bearing 邏輯
# 抽成等價單元,對含一個空 .pid 的 RunDir 執行 → 應正常產出每行 summary 文字、回 '(empty)',不 throw。
# 此 scriptblock 與 deploy.ps1 :104-111 的 guard 等價(同 Get-Content/Select/if 結構)。
# ---------------------------------------------------------------------------
function Get-FailedPidSummaryLines {
    param([Parameter(Mandatory = $true)][string] $RunDir)
    $lines = @()
    foreach ($pidFile in Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
        $raw = Get-Content $pidFile.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
        # 與 deploy.ps1 :110 guard 等價:用 IsNullOrWhiteSpace 而非 `if ($raw)`,
        # 否則純空白 .pid('   ')因 truthy 會落到 .Trim() 印出空 PID 而非 '(empty)'。
        $procId = if (-not [string]::IsNullOrWhiteSpace($raw)) { $raw.Trim() } else { '(empty)' }
        $lines += "  > $($pidFile.BaseName) PID $procId"
    }
    return $lines
}

$sb = New-TestSandbox -Prefix 'deploy-nullderef-001-empty'
try {
    $emptyPid = Join-Path $sb 'bim-streaming-server.pid'
    # 真零位元組空檔(版本無關),理由同上。
    [System.IO.File]::WriteAllText($emptyPid, '')
    $threw = $false
    $lines = @()
    try { $lines = @(Get-FailedPidSummaryLines -RunDir $sb) }
    catch { $threw = $true }
    Assert-True (-not $threw) 'Final Summary PID loop does not throw on empty .pid file (DEPLOY-001)'
    Assert-Equal 1 $lines.Count 'one summary line produced for the empty .pid file'
    Assert-True ($lines[0] -match 'bim-streaming-server PID \(empty\)') 'empty .pid reported as PID (empty), summary still diagnosable'
    Write-TestPass 'DEPLOY-001 GREEN: empty .pid -> summary line "(empty)", no throw'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# DEPLOY-001 補充:只含空白的 .pid → '(empty)'(reviewer 回饋的真值缺口)。
# PowerShell 中純空白字串為 truthy,舊的 `if ($raw)` 會落到 .Trim() 印出空 PID;
# IsNullOrWhiteSpace guard 必須讓純空白也落 '(empty)',否則失敗診斷會印出 "PID "(空白)。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-nullderef-001-whitespace'
try {
    $wsPid = Join-Path $sb 'bim-streaming-server.pid'
    # 寫入只含空白(空格 + tab)的 .pid;不靠換行,確保第一行就是純空白。
    [System.IO.File]::WriteAllText($wsPid, "   `t  ")
    $threw = $false
    $lines = @()
    try { $lines = @(Get-FailedPidSummaryLines -RunDir $sb) }
    catch { $threw = $true }
    Assert-True (-not $threw) 'Final Summary PID loop does not throw on whitespace-only .pid file (DEPLOY-001)'
    Assert-Equal 1 $lines.Count 'one summary line produced for the whitespace-only .pid file'
    Assert-True ($lines[0] -match 'bim-streaming-server PID \(empty\)') 'whitespace-only .pid reported as PID (empty), not a blank PID'
    Write-TestPass 'DEPLOY-001 GREEN: whitespace-only .pid -> "(empty)", no blank PID'
}
finally { Remove-TestSandbox -Path $sb }

# ---------------------------------------------------------------------------
# DEPLOY-001 補充:非空 .pid → summary 印出實際 PID(確保 guard 沒誤殺 happy path)。
# ---------------------------------------------------------------------------
$sb = New-TestSandbox -Prefix 'deploy-nullderef-001-real'
try {
    $realPid = Join-Path $sb 'bim-streaming-server.pid'
    Set-Content -LiteralPath $realPid -Value '12345' -Encoding ascii
    $lines = @(Get-FailedPidSummaryLines -RunDir $sb)
    Assert-Equal 1 $lines.Count 'one summary line for the real .pid file'
    Assert-True ($lines[0] -match 'bim-streaming-server PID 12345') 'non-empty .pid reports actual PID (happy path preserved)'
    Write-TestPass 'DEPLOY-001: non-empty .pid -> actual PID in summary'
}
finally { Remove-TestSandbox -Path $sb }

Write-Host "`n=== test-deploy-nullderef-guard.ps1: ALL PASSED ===" -ForegroundColor Green
