# scripts/hooks/require-gstack-evidence.ps1
#
# PreToolUse gate（由 .claude/settings.json 以 `if: Bash(gh pr merge*)` 觸發）：
# 機制化 AGENTS.md §0.1 user-facing browser evidence 規則。
#
# 邏輯：當前分支 vs origin/main 的 diff 若改到任一 user-facing frontend surface，
# 而近 24h 內沒有 screenshot 或 trace（artifacts/e2e 下 *.png / *trace*.zip；evidence 通常
# gitignored，故看 disk mtime 而非 diff），就回 PreToolUse deny 擋下 `gh pr merge`。
# 其餘情況（非前端變更、或近期已有 e2e 截圖、或不在 repo）一律放行 exit 0。
#
# 註：這是 heuristic 閘，不是嚴格 E2E 通過判定；證據可由 Playwright / gstack / supported browser engine 產生。

$ErrorActionPreference = 'SilentlyContinue'

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
$payload = @{
  hookSpecificOutput = @{
    hookEventName            = 'PreToolUse'
    permissionDecision       = 'deny'
    permissionDecisionReason = $reason
  }
}
$payload | ConvertTo-Json -Compress -Depth 6
exit 0
