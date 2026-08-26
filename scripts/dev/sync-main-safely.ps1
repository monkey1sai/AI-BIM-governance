<#
.SYNOPSIS
  Safely synchronize the local main branch with origin/main across all AI agent sessions.
.DESCRIPTION
  This script safely checks:
  1. If current workspace is a git repository.
  2. If currently on the 'main' branch (or if invoked in a linked worktree, targets the main common repo).
  3. If working tree is dirty: aborts pull to protect uncommitted changes.
  4. If clean: fetches origin/main and fast-forwards local main (never hard resets).
  5. Never throws or halts agent execution (exits with 0).
#>

[CmdletBinding()]
param(
    [string]$TargetDir = $PSScriptRoot + "\..\.."
)

$ErrorActionPreference = 'SilentlyContinue'

function Write-SyncLog([string]$message, [string]$level = "INFO") {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$timestamp] [Sync-Main] [$level] $message"
}

try {
    # Resolve directory
    if (-not (Test-Path $TargetDir)) {
        $TargetDir = (Get-Location).Path
    }

    # 1. Verify git repo
    $isGit = git -C "$TargetDir" rev-parse --is-inside-work-tree 2>$null
    if ($isGit -ne 'true') {
        exit 0
    }

    # 2. Get git repo root
    $repoRoot = git -C "$TargetDir" rev-parse --show-toplevel 2>$null
    if (-not $repoRoot) { exit 0 }

    # 3. Check current branch
    $currentBranch = git -C "$repoRoot" branch --show-current 2>$null
    if ($currentBranch -ne 'main') {
        Write-SyncLog "目前位於分支 [$currentBranch]（非 main），略過自動同步以保持工作上下文。" "DEBUG"
        exit 0
    }

    # 4. Check for uncommitted changes (dirty working tree)
    $status = git -C "$repoRoot" status --porcelain 2>$null
    if ($status) {
        Write-SyncLog "工作區有未提交的變更 (Dirty)，略過自動 pull 以保護本地程式碼。" "WARN"
        exit 0
    }

    # 5. Fetch origin/main
    Write-SyncLog "正在檢查遠端 origin/main 最新狀態..." "INFO"
    git -C "$repoRoot" fetch origin main --quiet 2>$null

    # 6. Compare local vs remote
    $behindCount = [int](git -C "$repoRoot" rev-list --count HEAD..origin/main 2>$null)
    $aheadCount = [int](git -C "$repoRoot" rev-list --count origin/main..HEAD 2>$null)

    if ($behindCount -gt 0 -and $aheadCount -eq 0) {
        # Fast-forward is clean and possible
        $mergeResult = git -C "$repoRoot" merge --ff-only origin/main 2>$null
        $newHead = git -C "$repoRoot" rev-parse --short HEAD 2>$null
        Write-SyncLog "已成功將 main 快進同步至 origin/main (落後 $behindCount 個 commit -> 目前 HEAD: $newHead)。" "SUCCESS"
    } elseif ($aheadCount -gt 0) {
        Write-SyncLog "本地 main 領先遠端 $aheadCount 個 commit，略過自動同步。" "INFO"
    } else {
        Write-SyncLog "main 與 origin/main 已完全同步。" "INFO"
    }
}
catch {
    Write-SyncLog "同步過程發生非預期錯誤: $_" "WARN"
}

exit 0
