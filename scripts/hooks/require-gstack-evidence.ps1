# scripts/hooks/require-gstack-evidence.ps1
#
# PreToolUse gate（由 .claude/settings.json 以 `if: Bash(gh pr merge*)` 觸發）：
# 機制化 AGENTS.md §0.1 治理規則「不要用 Superpowers 宣告 UI 完成而不跑 gstack」。
#
# 邏輯：當前分支 vs origin/main 的 diff 若改到前端（web-viewer-sample 下 .tsx/.ts/.jsx/.css），
# 而近 24h 內沒有任何 gstack 瀏覽器證據（artifacts/e2e 下 *.png；evidence 通常 gitignored，
# 故看 disk mtime 而非 diff），就回 PreToolUse deny 擋下 `gh pr merge`，要求先跑 gstack 驗收。
# 其餘情況（非前端變更、或近期已有 e2e 截圖、或不在 repo）一律放行 exit 0。
#
# 註：這是 heuristic 閘（看 24h 內的 e2e PNG），不是嚴格 E2E 通過判定；目的是擋「改了前端卻沒跑 gstack 就 merge」。

$ErrorActionPreference = 'SilentlyContinue'

$root = (& git rev-parse --show-toplevel 2>$null)
if (-not $root) { exit 0 }            # 不在 git repo → 放行
Set-Location -LiteralPath $root

$changed = & git diff --name-only origin/main...HEAD 2>$null
if (-not $changed) { exit 0 }         # 與 origin/main 無 diff（如在 main 上）→ 放行

$frontend = @($changed | Where-Object { $_ -match '^web-viewer-sample/.*\.(tsx|ts|jsx|css)$' })
if ($frontend.Count -eq 0) { exit 0 } # 沒動前端 → 放行

# gstack 證據 = artifacts/e2e 下近 24h 內被寫入的 *.png（evidence 多為 gitignored，看 mtime）
$cut = (Get-Date).AddHours(-24)
$e2eDir = Join-Path $root 'artifacts/e2e'
$png = @()
if (Test-Path -LiteralPath $e2eDir) {
  $png = @(Get-ChildItem -LiteralPath $e2eDir -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $cut })
}
if ($png.Count -gt 0) { exit 0 }      # 近 24h 有 gstack 截圖 → 放行

$reason = "[gstack-gate] 偵測到 user-facing 前端變更（$($frontend.Count) 檔，如 $($frontend[0])）但近 24h 無 gstack browser evidence（artifacts/e2e/*.png）。依 AGENTS.md §0.1，UI 完成須附 gstack 截圖 / E2E 證據才能 merge。請先跑 gstack 驗收（截圖存 artifacts/e2e/）再 merge。"
$payload = @{
  hookSpecificOutput = @{
    hookEventName            = 'PreToolUse'
    permissionDecision       = 'deny'
    permissionDecisionReason = $reason
  }
}
$payload | ConvertTo-Json -Compress -Depth 6
exit 0
