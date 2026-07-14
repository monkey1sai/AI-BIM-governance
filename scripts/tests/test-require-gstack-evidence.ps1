# scripts/tests/test-require-gstack-evidence.ps1
#
# 回歸測試：require-gstack-evidence.ps1 的指令篩選（deadlock 防線）。
#
# 背景（2026-07-14 實測）：本閘原本對**所有** Bash 指令執行 evidence 檢查，導致取證指令
# 本身（`npx playwright test`／`npm run test:e2e`）在「尚無 24h 內截圖」時被 deny——
# 要解除本閘就得先取證，要取證卻被本閘擋下，形成 deadlock。任何在此 repo 改前端的人
# （含 agent）都會撞上，且無法靠自己脫困。
#
# 修復：script 自行從 stdin 讀 PreToolUse payload（{ tool_name, tool_input: { command } }），
# 只在指令確實是 `gh pr merge` 時才把關，其餘一律放行。
#
# 本測試固化該行為：非 merge 指令必須放行（無 deny 輸出）。
#
# 為何不測「merge ＋ 無 evidence → deny」：該路徑依賴當前 branch 相對 origin/main 的 diff
# 與 artifacts/e2e 的檔案 mtime，隨 repo 狀態浮動，不適合作為穩定斷言。deny 路徑的正確性
# 由 script 本身的既有邏輯與 PR review 覆蓋。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hookPath = Join-Path $PSScriptRoot '..\hooks\require-gstack-evidence.ps1'
if (-not (Test-Path -LiteralPath $hookPath)) {
    throw "hook script not found: $hookPath"
}

# 用「執行本測試的同一個 PowerShell」去執行 hook，而非寫死 pwsh 或 powershell.exe。
#
# 原因（2026-07-14 實測）：Windows PowerShell 5.1 把字串 pipe 給 pwsh 7 時，**stdin 傳不
# 過去**——子行程收到空 stdin，於是 hook 讀不到 PreToolUse payload，測試會得到假結果
# （實測：5.1 → pwsh 得到空輸出；5.1 → powershell.exe 得到正確的 deny JSON；從 bash
# pipe 給 pwsh 則正常）。寫死其中一種就會在「本機 5.1／CI pwsh」之一失真。
#
# 用 $PID 的執行檔可讓：CI（pwsh 跑測試）以 pwsh 測、本機（5.1 跑測試）以 5.1 測，
# 兩邊都不跨版本 pipe。-ExecutionPolicy 在非 Windows 平台無效果，帶著也安全。
$script:PsExe = (Get-Process -Id $PID).Path
if ([string]::IsNullOrWhiteSpace($script:PsExe)) {
    throw '[test-require-gstack-evidence] 無法解析目前 PowerShell 的執行檔路徑。'
}

function Invoke-EvidenceHook {
    param([Parameter(Mandatory = $true)][string] $Command)

    $payload = @{ tool_name = 'Bash'; tool_input = @{ command = $Command } } | ConvertTo-Json -Compress
    $stdout = $payload | & $script:PsExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $hookPath 2>$null
    return ($stdout | Out-String).Trim()
}

# 這些指令一律不得被本閘 deny。前兩條正是造成 deadlock 的元兇：它們是**產生 evidence 的
# 手段**，若被擋，使用者永遠無法滿足本閘的要求。
$mustAllow = @(
    'cd web-viewer-sample && npx playwright test e2e/a9-a10-identity-a4-primary.spec.ts',
    'cd web-viewer-sample && npm run test:e2e -- e2e/foo.spec.ts',
    'cd web-viewer-sample && npm run verify',
    'git commit -m "fix: something"',
    'git push origin feature-branch',
    'echo hello',
    'gh pr create --title x --body-file y.md',
    'gh pr checks 336',
    'gh pr view 336 --json mergeable'
)

$failures = @()
foreach ($cmd in $mustAllow) {
    $out = Invoke-EvidenceHook -Command $cmd
    if ($out -match '"permissionDecision"\s*:\s*"deny"') {
        $failures += $cmd
    }
}

if ($failures.Count -gt 0) {
    foreach ($f in $failures) { Write-Host "  FAIL (wrongly denied): $f" }
    throw "[test-require-gstack-evidence] deadlock regression: $($failures.Count) non-merge command(s) were denied. 本閘只應在 'gh pr merge' 時把關。"
}

# ── 結構性防線 ────────────────────────────────────────────────────────────────
# 上面的行為測試有一個鑑別力盲點：當「當前 branch 相對 origin/main 沒有前端變更」時，
# script 會在 frontend.Count -eq 0 就放行，於是即使指令篩選被整段移除，行為測試仍會
# vacuous pass（例如本 PR 自己只改 .ps1，就正好落在這個盲點裡）。
# 故補上原始碼層級的斷言，確保指令篩選邏輯不會被靜默拿掉。
$src = Get-Content -LiteralPath $hookPath -Raw
if ($src -notmatch 'IsInputRedirected') {
    throw '[test-require-gstack-evidence] 指令篩選遺失：script 不再從 stdin 讀取 PreToolUse payload，deadlock 會復發。'
}
if ($src -notmatch 'tool_input') {
    throw '[test-require-gstack-evidence] 指令篩選遺失：script 不再解析 tool_input.command。'
}
if ($src -notmatch 'gh\\s\+pr\\s\+merge') {
    throw '[test-require-gstack-evidence] 指令篩選遺失：script 不再判斷指令是否為 gh pr merge，將對所有 Bash 指令把關。'
}

# ── 端到端鑑別力測試（在模擬 repo 中重現 deadlock 情境）──────────────────────
# 建臨時 git repo：feature branch 相對 origin/main 有前端變更，且 artifacts/e2e 不存在
# （＝零 evidence）——這正是本閘會 deny 的情境，也正是 2026-07-14 造成 deadlock 的情境。
# 在此情境下同時驗證兩件事：
#   1. `npx playwright test`（取證手段）必須放行 ← deadlock 修復的核心
#   2. `gh pr merge` 必須 deny                  ← 本閘的職責未被修壞
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "gstack-hook-test-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    Push-Location -LiteralPath $tmp
    & git init -q 2>$null
    & git config user.email 'test@example.invalid' 2>$null
    & git config user.name 'gstack hook test' 2>$null
    Set-Content -LiteralPath (Join-Path $tmp 'README.md') -Value 'base' -Encoding utf8
    & git add -A 2>$null
    & git commit -q -m 'base' 2>$null
    & git update-ref refs/remotes/origin/main HEAD 2>$null   # 模擬 origin/main
    & git checkout -q -b feature 2>$null
    New-Item -ItemType Directory -Force -Path (Join-Path $tmp 'web-viewer-sample/src') | Out-Null
    Set-Content -LiteralPath (Join-Path $tmp 'web-viewer-sample/src/Foo.tsx') -Value 'export const Foo = () => null;' -Encoding utf8
    & git add -A 2>$null
    & git commit -q -m 'frontend change (no evidence)' 2>$null

    $probePlaywright = Invoke-EvidenceHook -Command 'cd web-viewer-sample && npx playwright test e2e/foo.spec.ts'
    $probeMerge = Invoke-EvidenceHook -Command 'gh pr merge 336 --squash --delete-branch'

    if ($probePlaywright -match '"permissionDecision"\s*:\s*"deny"') {
        throw '[test-require-gstack-evidence] DEADLOCK 復發：有前端變更且零 evidence 時，取證指令「npx playwright test」被 deny——使用者將永遠無法產生本閘要求的截圖。'
    }
    if ($probeMerge -notmatch '"permissionDecision"\s*:\s*"deny"') {
        throw '[test-require-gstack-evidence] 閘失效：有前端變更且零 evidence 時，「gh pr merge」未被 deny，AGENTS.md §0.1 的 browser evidence 規則形同虛設。'
    }
    Write-Host '  ok  模擬 repo（前端變更 + 零 evidence）：playwright 放行、gh pr merge 被 deny'
}
finally {
    Pop-Location
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[test-require-gstack-evidence] passed — $($mustAllow.Count) non-merge commands allowed + 指令篩選結構完整 + 模擬 repo 端到端鑑別（deadlock guard intact）"
