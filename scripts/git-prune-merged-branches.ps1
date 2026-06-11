<#
.SYNOPSIS
    清理「PR 已合併且遠端分支已刪除」的本機分支（upstream gone）。

.DESCRIPTION
    安全的本機維護腳本。只刪除符合「upstream: gone」的分支 ——
    亦即該分支對應的 GitHub 遠端分支已在 PR 合併後被刪除（squash merge 後常見）。
    這類分支內容已進 main，本機僅剩空殼標籤，刪除不影響 main 內容。

    預設為 dry-run（只列出候選，不刪除）。確認無誤後加 -Force 才真正刪除。
    永遠跳過：當前分支、被任何 worktree 簽出的分支（branch -vv 標記 '+'）。

    本腳本為開發者本機維護工具，刻意不接入 deploy.ps1 / start / stop 等
    runtime golden path，不影響部署或執行期行為。

.PARAMETER Force
    實際執行刪除。未指定時僅列出候選分支。

.EXAMPLE
    pwsh scripts/git-prune-merged-branches.ps1
    # dry-run：列出所有 upstream 為 gone 的可刪分支

.EXAMPLE
    pwsh scripts/git-prune-merged-branches.ps1 -Force
    # 真正刪除候選分支
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# 先同步遠端狀態，讓 'gone' 判定準確
Write-Host '==> git fetch --prune' -ForegroundColor Cyan
git fetch --prune | Out-Null

# 解析 git branch -vv：抓 upstream 標記為 ': gone]' 的分支
# 行首 '*' = 當前分支，'+' = 被其他 worktree 簽出 —— 兩者一律跳過
$lines = git branch -vv

$candidates = @()
$skipped = @()

foreach ($line in $lines) {
    if ($line -notmatch ': gone\]') { continue }

    $marker = $line.Substring(0, 2)
    # 去掉行首 2 字元標記後取第一個 token 當分支名
    $name = ($line.Substring(2).TrimStart() -split '\s+')[0]

    if ($marker -match '\*') {
        $skipped += [pscustomobject]@{ Name = $name; Reason = '當前分支' }
    }
    elseif ($marker -match '\+') {
        $skipped += [pscustomobject]@{ Name = $name; Reason = 'worktree 佔用' }
    }
    else {
        $candidates += $name
    }
}

if ($skipped.Count -gt 0) {
    Write-Host "`n跳過（upstream gone 但不可刪）：" -ForegroundColor Yellow
    foreach ($s in $skipped) { Write-Host ("  - {0}  [{1}]" -f $s.Name, $s.Reason) }
}

if ($candidates.Count -eq 0) {
    Write-Host "`n沒有可清理的 'upstream gone' 分支。" -ForegroundColor Green
    return
}

Write-Host "`n可清理分支（PR 已合併、遠端已刪）：" -ForegroundColor Cyan
foreach ($b in $candidates) {
    $sha = (git rev-parse --short $b)
    Write-Host ("  - {0,-45} {1}" -f $b, $sha)
}

if (-not $Force) {
    Write-Host "`n[dry-run] 未刪除任何分支。確認後重跑並加上 -Force。" -ForegroundColor Yellow
    Write-Host "(救回任一分支： git branch <name> <SHA>)" -ForegroundColor DarkGray
    return
}

Write-Host "`n==> 刪除中..." -ForegroundColor Cyan
foreach ($b in $candidates) {
    $sha = (git rev-parse --short $b)
    git branch -D $b
    Write-Host ("  已刪 {0} (was {1})" -f $b, $sha) -ForegroundColor Green
}
Write-Host "`n完成。如需救回： git branch <name> <SHA>（90 天內 reflog 可查）" -ForegroundColor DarkGray
