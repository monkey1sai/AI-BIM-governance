# Spec：rebuild-test-deploy 的 git clean 排除 Kit 執行期 log 目錄

## 問題

`.\scripts\dev\rebuild-test-deploy.ps1 -Build` 在部署區 `D:\Users\deploy\AI-bim-geo` 執行 `git clean -fdx` 時，連續兩次撞上同一顆 Kit 執行期 log 檔：

```
warning: failed to remove bim-streaming-server/_build/windows-x86_64/release/logs/Kit/BIM Review Stream/0.1/kit_20260701_181448.log: Invalid argument
```

前一輪 [[rebuild-stop-locker-before-clean|rebuild-stop-locker-before-clean.md]]（PR #268）已經加上「clean 前 best-effort 停 3 個部署區服務」+「clean 本身重試 3 次、間隔 1 秒」，但這次實測仍在第 3 次重試後失敗。逐項排除嫌疑：

- 無任何 `kit.exe` / `python.exe` 行程存活（`Get-Process` 全列表查無）
- Windows Defender 閒置：3 秒 CPU 增量 = 0，最近一次 quick scan 結束時間早於檔案建立時間，從未跑過 full scan
- 非 OneDrive（`D:\Users\deploy` 不在 OneDrive 同步範圍）、非網路磁碟（`Get-Partition` 確認是本機實體 Basic partition）、非雲端同步磁碟
- 直接對該檔用 `[System.IO.File]::Open($p, 'Open', 'ReadWrite', 'None')` 測試，60 秒內連續 6 次輪詢仍持續丟出 `being used by another process`

判斷是查無擁有行程的孤兒 OS-level handle（可能是先前某次當機/被強制關閉的行程留下的殘留 kernel handle），不是 #268 的重試機制設計要處理的「剛釋放的 handle 瞬間 EINVAL」情境——這種孤兒鎖沒有「稍後就會放開」的性質，重試次數/間隔再加大也無法保證解決。

## 設計

在 `Invoke-TestDeployRebuild` 的 `git clean -fdx` 加上排除路徑：

```powershell
git clean -fdx -e 'bim-streaming-server/_build/**/logs/**'
```

`bim-streaming-server/_build/**/logs/**` 底下是 Kit 自己的執行期診斷 log，純輸出、不是建置狀態；真正的建置產物（DLL / exe，含 `streaming_launcher` / `kit_exe`）仍在 `_build` 其餘路徑下照常被 `-fdx` 清除重建，不受此排除影響。

[[rebuild-stop-locker-before-clean|#268 spec]] 的「安全網（未採用，記錄備援）」一節已預先記錄過這個方向，當時排除的是整個 `bim-streaming-server/_build`、因「會留下 stale `_build`」而未採用。本次改用更窄的 `_build/**/logs/**`（只排除 log，不排除任何實際建置產物），避免同一顧慮，同時解決孤兒鎖問題。

## 治理護欄

- 排除範圍嚴格限定在 `logs/**`，不影響 `_build` 下任何 DLL / exe / 其他建置產物的清除重建。
- `deploy.ps1` golden path 未變動；`Invoke-TestDeployRebuild` 函式簽章未變。
- 不新增任何 process-kill 邏輯；此次问题查無可停止的擁有行程，Stop-HostNativeService 既有機制與 #268 的三服務清單保持不變。

## 驗證

`pwsh scripts/tests/test-rebuild-test-deploy.ps1` → `[PASS]`，含新增斷言：

- `git clean -fdx -e bim-streaming-server/_build/**/logs/**` 的完整參數字串確實被傳入 `CommandRunner`（4 處既有 mock 的精確字串比對同步更新，任何參數漂移都會讓對應斷言失敗）。

真實端到端驗證：套用前，在真實鎖檔中的部署區連續兩次跑 `.\scripts\dev\rebuild-test-deploy.ps1 -Build` 都在 `git clean` 階段丟例外；套用後完整跑過 clean/reset/env-restore，進入 `deploy.ps1` Phase 1（Preflight）與 Phase 2（Auto-fix / Kit build）。

## Impact

`Invoke-TestDeployRebuild` 唯一呼叫者為 `scripts/dev/rebuild-test-deploy.ps1` 包裝器與其專屬測試檔；改動只在既有 `git clean` 呼叫的參數陣列多加兩個元素，不影響函式簽章、不影響其他呼叫路徑。Blast radius：LOW。（本機 GitNexus 索引 stale；CI `pr-review-agent` 的 GitNexus detect-changes 為權威 impact 檢查。）

## 已知限制

- 治標不治本：未解釋孤兒 handle 從何而來，只是讓它不再擋住 rebuild。若同一機器重複出現孤兒鎖，值得後續觀察是否有更深層系統成因。
- 端到端驗證途中，`deploy.ps1` 在更後面的 Kit `repo.bat build` 步驟遇到另一個失敗（`streaming_launcher` / `kit_exe` 產物缺失）；已排查確認是驗證時的 agent 沙盒環境變數 `NoDefaultCurrentDirectoryInExePath=1` 造成的假警報（僅存在於該次驗證的 Process 層級環境，不影響使用者一般終端機執行、也未持久化在 Machine / User 登錄檔層級），與本次修復無關，不在此 spec 範圍內。
