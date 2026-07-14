# scripts/hooks/require-gstack-evidence.ps1
#
# PreToolUse gate（由 .claude/settings.json 以 `matcher: Bash` ＋ `if: Bash(gh pr merge*)` 註冊）：
# 機制化 AGENTS.md §0.1 user-facing browser evidence 規則。
#
# 邏輯：當前分支 vs origin/main 的 diff 若改到任一 user-facing frontend surface，
# 而近 24h 內沒有 screenshot 或 trace（artifacts/e2e 下 *.png / *trace*.zip；evidence 通常
# gitignored，故看 disk mtime 而非 diff），就回 PreToolUse deny 擋下 `gh pr merge`。
# 其餘情況（非 merge 指令、非前端變更、近期已有 e2e 截圖、不在 repo）一律放行 exit 0。
#
# ── 自我把關（2026-07-14，修 deadlock）────────────────────────────────────────
# 本 script 現在自行從 stdin 讀取 PreToolUse payload（`{ tool_name, tool_input: { command } }`），
# **只在指令確實是 `gh pr merge` 時才把關**。
#
# 原本僅依賴 settings.json 的 `if` 條件，但實測該條件未如預期生效：Playwright／npm test 這類
# **取證指令本身**會被擋下，形成 deadlock——要解除本閘就得先產生截圖，要產生截圖就得跑
# Playwright，而跑 Playwright 又被本閘擋。任何在此 repo 改前端的人（含 agent）都會撞上。
#
# 自我把關讓行為不再取決於 `if` 是否被正確評估：即使 hook 被誤觸發，非 merge 指令一律放行。
# 回歸測試見 scripts/tests/test-require-gstack-evidence.ps1。
#
# 註：這是 heuristic 閘，不是嚴格 E2E 通過判定；證據可由 Playwright / gstack / supported
# browser engine 產生。

$ErrorActionPreference = 'SilentlyContinue'

# ── Gate 0：只對 `gh pr merge` 把關；其餘 Bash 指令一律放行 ─────────────────────
# PreToolUse payload 由 stdin 傳入。以 IsInputRedirected 判斷有無 stdin，避免人工在互動式
# 終端執行本 script 時 ReadToEnd() 永久阻塞。無 payload（人工執行／測試）時不做指令篩選，
# 沿用下方 evidence 檢查邏輯，保留可獨立測試性。
$raw = ''
if ([Console]::IsInputRedirected) {
    try { $raw = [Console]::In.ReadToEnd() } catch { $raw = '' }
}
if (-not [string]::IsNullOrWhiteSpace($raw)) {
    $command = $null
    try {
        $payload = $raw | ConvertFrom-Json
        $command = [string]$payload.tool_input.command
    }
    catch {
        exit 0   # payload 無法解析 → 放行；本閘絕不因自身故障阻塞流程
    }
    if (-not [string]::IsNullOrWhiteSpace($command) -and $command -notmatch '(?i)\bgh\s+pr\s+merge\b') {
        exit 0   # 非 merge 指令（含取證用的 playwright / npm test / npx）→ 放行
    }
}

$root = (& git rev-parse --show-toplevel 2>$null)
if (-not $root) { exit 0 }            # 不在 git repo → 放行
Set-Location -LiteralPath $root

$changed = & git diff --name-only origin/main...HEAD 2>$null
if (-not $changed) { exit 0 }         # 與 origin/main 無 diff（如在 main 上）→ 放行

$frontendPattern = '^(web-viewer-sample/|apps/kit-manager-web/|bim-review-coordinator/(src|public)/).+\.(tsx|ts|jsx|js|css|html|vue|svelte)$'
$frontend = @($changed | Where-Object { $_ -match $frontendPattern })
if ($frontend.Count -eq 0) { exit 0 } # 沒動前端 → 放行

# Browser 證據 = artifacts/e2e 下近 24h 內的 screenshot 或 trace。
$cut = (Get-Date).AddHours(-24)
$e2eDir = Join-Path $root 'artifacts/e2e'
$evidence = @()
if (Test-Path -LiteralPath $e2eDir) {
    $evidence = @(Get-ChildItem -LiteralPath $e2eDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
            $_.LastWriteTime -gt $cut -and ($_.Extension -eq '.png' -or $_.Name -match '(?i)trace.*\.zip$')
        })
}
if ($evidence.Count -gt 0) { exit 0 } # 近 24h 有 browser screenshot/trace → 放行

$reason = "[browser-evidence-gate] 偵測到 user-facing 前端變更（$($frontend.Count) 檔，如 $($frontend[0])）但近 24h 無 browser screenshot/trace（artifacts/e2e/*.png 或 *trace*.zip）。依 AGENTS.md §0.1，請先用 Playwright / gstack / supported browser engine 取證再 merge。"
$denyPayload = @{
    hookSpecificOutput = @{
        hookEventName            = 'PreToolUse'
        permissionDecision       = 'deny'
        permissionDecisionReason = $reason
    }
}
$denyPayload | ConvertTo-Json -Compress -Depth 6
exit 0
