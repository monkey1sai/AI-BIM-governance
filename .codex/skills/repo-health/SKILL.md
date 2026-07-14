---
name: repo-health
description: Use when the user wants to check or clean up the AI-BIM-governance repo's health — version/dependency drift across services, branch/worktree/temp cleanup, .claude asset hygiene, and doc/config sync. Scans read-only across four dimensions, reports, then fixes only what the user confirms.
argument-hint: "（選填）只想看某面向：version / cleanup / assets / docs"
---

# repo-health — AI-BIM repo 四面向健檢

對 `AI-BIM-governance` 跑唯讀健檢，回報問題，**只修使用者確認的項目**。

## 安全鐵則（不可違反）

1. **掃描階段唯讀** — 本 skill 的掃描絕不修改任何檔案。
2. **報告 → 確認 → 才修** — 任何修復都要先把報告給使用者、等使用者勾選後才動手。
3. **risky 項一律明確確認** — 改版本檔、`.claude` agent 設定、文件內容、`.env.example`（只補 key 名、留空值，永不寫入任何 .env 值）都屬 risky。
4. **優先複用既有腳本** — 清理用 `scripts/git-prune-merged-branches.ps1`、`scripts/log-retention/`；不要另寫新腳本（遵守 `scripts/SCRIPT_CONTRACT.md`）。
5. **修完重驗** — 修復後對該項重新掃一次，確認真的閉合，如實回報。

## 面向

**4 個衛生面向（可修）：**

| 面向 | 抓什麼 | 修復安全性 |
|---|---|---|
| **版本漂移** | 同套件跨服務版本不一致（fastapi/uvicorn/pydantic/vitest/react…） | risky（改依賴檔） |
| **清理** | 已 merged 分支、過期 worktree、`.tmp`/`.pytest_cache`/舊 log | safe（純清理） |
| **.claude 資產** | 命名不一致、重複、孤兒 workflow、漏索引的 skill | risky（動 agent 設定） |
| **文件同步** | script-registry 落差、`.env.example` 缺 key、文件指向不存在的檔 | risky（動文件/設定） |

**1 個進度面向（唯讀評估，不產可修項）：**

| 面向 | 抓什麼 | 性質 |
|---|---|---|
| **進度差異** | `docs/plans/TRUTH.md` 的 route／A1–A10 現況與 `docs/plans/BACKLOG.md` gap 佇列「帳本自報 vs 獨立查證」並列，標出帳本高估/低報 | 唯讀評估，**不納入「要修哪幾項」** |

## 流程

1. **掃描** — coordinator 在目前 session 直接執行以下 5 個唯讀檢查；不得呼叫 Claude workflow，也不得在此階段派 writer：
   - `version`：讀各服務的 `requirements.txt` / `package.json`，比對同名 dependency 版本。
   - `cleanup`：讀 `git status`、merged branches、`git worktree list` 與 `.tmp` / cache / logs；不刪除。
   - `assets`：比對 `agent-skills-manifest.json`、`.claude/skills`、`.codex/skills`、workflow/command 引用與入口檔。
   - `docs`：比對 `scripts/script-registry.json`、實際 scripts、`.env` 與 `.env.example` 的 key 名、文件連結目標；不得輸出 `.env` 值。
   - `progress`：依 `docs/plans/docs-plans-README.md` 讀 `TRUTH.md` / `BACKLOG.md` / `PROCESS.md`，再以原始碼、測試與 git history 獨立查證。
   - 若使用者只要某一面向（arg = version/cleanup/assets/docs），仍跑全掃但報告時只聚焦該面向。
2. **報告** — coordinator 直接把掃描結果整理成健康狀態表：
   - 開頭一張總表（4 個衛生面向，每面向 ✅ 無問題 / ⚠️ warn / ❌ fail + 問題數）。
   - 各面向逐項列：標題、證據、建議修法、`[safe]`/`[risky]` 標記。
   - **進度差異獨立區塊** — 衛生面向之後另起「📊 進度差異」，把回傳的 `progress.items` 畫成小表：`目標 / 計畫說 / 實際 / 對齊 / 差距`；對齊用圖示（✅相符 / 🔴計畫高估 / 🟡計畫低報 / ❔查不出）。此區塊**純資訊，不列入可修項**。
3. **問** — 結尾固定問：「**要修哪幾項?**」只列 4 個衛生面向的可修項（用編號），標清楚哪些 safe、哪些 risky。進度差異不在此問句範圍。
4. **修** — 只對使用者勾選的項目動手：
   - safe 項（清理）：複用既有腳本執行。
   - risky 項（版本/資產/文件）：先說明具體會改什麼，再以最小 diff 修改；版本對齊要讓使用者指定目標版本。
5. **重驗** — 對已修項目重掃，回報 keep / 仍有問題；產出四項收尾（改了什麼 / 驗了什麼 / 沒做什麼+原因 / 已知風險）。

## 觸發

- skill：`$repo-health`。
- 或使用者直接說「跑 repo 健檢 / 檢查 repo 健康 / 清一下 repo」。

## 注意

- 以 `git rev-parse --show-toplevel` 決定 root；若在 linked worktree 執行，所有讀取與 git 指令都使用該 worktree 的絕對路徑。
- 掃描是 best-effort：某面向無法完成時如實標「該面向未完成」，不要假裝健康。
