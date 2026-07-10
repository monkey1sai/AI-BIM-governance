# 主 checkout untracked 殘留清單（2026-07-10 衛生輪 C2）

> 掃描對象：`C:\Repos\active\iot\AI-BIM-governance`（主 checkout）。以下皆為 **untracked/ignored** 本地檔，
> 不在任何 PR diff 內；刪除需人工確認（R5 裁決：清單化、確認後刪）。執行結果回寫本檔。

| # | 路徑 | 大小 | 判定理由 | 處置 |
|---|---|---|---|---|
| 1 | `output/` | 3.0M | Playwright 輸出殘骸（agent 8 盤點認列） | 待確認刪除 |
| 2 | `patches/`（主 checkout 殘餘） | 4K | tracked 檔已於 PR-C 移除；目錄殘餘 | 待確認刪除 |
| 3 | `logs/`（`gitnexus-analyze-*.log`、`mcp-runtime/`） | 60K | 工具執行 log，非 runtime 依賴 | 待確認刪除 |
| 4a | `.tmp/m1-review` | （含於 112M） | **註冊中的 git worktree**（detached 168f2e0）——須 `git worktree remove --force`，非直接刪目錄 | 待確認移除 |
| 4b | `.tmp/m6-final-review`、`.tmp/pending-delete-20260710-094030` | （含於 112M） | 歷史 review 殘骸＋自標 pending-delete | 待確認刪除 |
| 5 | `g1-doctor.log` | 4K | 一次性診斷 log | 待確認刪除 |
| 6 | `.aider.chat.history.md`、`.aider.input.history` | 小 | 已停用工具的本地態 | 待確認刪除 |
| 7 | `artifacts/git-cleanup-2026-06-10/`（4 patch）、`git-cleanup-recovery-2026-06-08.txt`、`git-cleanup-stash-patches-2026-06-08.patch`、`audit-wip-shelved-2026-06-09.patch` | 小 | **2026-06 git 事故救援備份**——內容若已全數落地/失效即可刪；屬最高風險組，單獨確認 | 待確認刪除（高風險組） |
| 8 | `bim-streaming-server/*.etl`（2026-04-30 NvStreamer telemetry ×4+） | 中 | Kit 串流 telemetry 殘骸 | 待確認刪除 |

範圍外備註：`C:\temp\ai-bim-m6-review`、`C:\temp\bim-m6-237c443`、`C:\temp\m5review`、
`C:\Repos\active\iot\AI-BIM-governance-review` 為 repo 外註冊 worktree（`git worktree list` 可見），
不在本輪清理範圍，僅記錄存在。

## 執行紀錄（2026-07-10，使用者裁決：三組全刪）

- ✅ 已刪：`output/`、`logs/`、`g1-doctor.log`、`.aider.*`、`bim-streaming-server/*.etl`、
  `artifacts/git-cleanup-2026-06-10/`、`git-cleanup-recovery-2026-06-08.txt`、
  `git-cleanup-stash-patches-2026-06-08.patch`、`audit-wip-shelved-2026-06-09.patch`、
  `.tmp/m6-final-review`；`.tmp/m1-review` 已 `git worktree remove --force`（worktree list 確認消失）。
- ⚠️ **殘餘（需系統管理員）**：`.tmp/pending-delete-20260710-094030/` 內 4 個 pytest 快取目錄
  （`.pytest_cache`、`pytest-of-jacks` ×2 組）ACL 鎖死，takeown/icacls 非提權下無效
  （與 2026-07-07 repo-health「ACL admin 刪」同型）。以**系統管理員 PowerShell** 執行：
  `takeown /f C:\Repos\active\iot\AI-BIM-governance\.tmp /r /d Y; icacls C:\Repos\active\iot\AI-BIM-governance\.tmp /grant "*S-1-5-32-544:(OI)(CI)F" /t; Remove-Item -Recurse -Force C:\Repos\active\iot\AI-BIM-governance\.tmp`
- ℹ️ `patches/` 的 tracked 檔由 PR-C 移除，主 checkout 于 merge 後 `git pull` 自然收斂，未手動干預。
- ℹ️ 另觀察到 `.worktrees/m9-final`、`.worktrees/m9-fix`（detached）與 repo 外 review worktrees——
  疑似 Codex M9 in-flight 作業，**未動**（不在本輪確認範圍）。
