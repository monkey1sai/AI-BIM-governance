# Spec：deploy.ps1 Kit repo.bat build 改用 cmd.exe 真檔重導向 + timeout

## 問題

`scripts\deploy.ps1` Phase 2 的 Kit runtime build 步驟：

```powershell
& .\repo.bat build *> $kitBuildLog
$kitBuildExit = $LASTEXITCODE
```

2026-07-01 實測：`repo.bat build` 自己的 log（`kit-repo-build.log`）已印出
`BUILD (RELEASE) SUCCEEDED`、4 個 Kit precache 子程序全部 `Shutting down`，但外層
`deploy.ps1` process 停滯 20+ 分鐘沒有繼續往下印任何訊息 —— 子行程數=0、CPU 6 秒
視窗內 delta≈0，不是還在算。

根因：PowerShell 對 native process 的 stream redirect（`&` 搭配 `*>`）會等
**該 redirect stream 的 EOF**，而非只等直接子行程（`repo.bat`／`cmd.exe`）本身
結束。若 `repo.bat` 底下的 Kit precache 工具鏈留下一個未釋放 stdout/stderr
handle 的背景分支程序（即使該分支程序本身無害、只是尚未退出），PowerShell 就會
永久卡在等 EOF，即使真正的 build 工作早已完成。這跟 PR #268
（[[rebuild-stop-locker-before-clean]]，`git clean -fdx` 遇 EINVAL 鎖檔）是完全
不同的兩種卡住成因 —— 前者是 unlink 一個仍被鎖的檔案立即失敗，這次是等一個永遠
不會關閉的 stream 永久掛住，同一條 rebuild-test-deploy 流程裡可能各自獨立發生。

## 設計

新增 `Invoke-KitRepoBuild`（`scripts/lib/host-native-launcher.ps1`），沿用同檔案
既有 `Start-HostNativeService`/`Stop-HostNativeService`/`Wait-HostNativeHealth`
的 dependency-injection 測試風格：

1. **cmd.exe 自己做檔案重導向**：`Start-Process -FilePath cmd.exe -ArgumentList
   '/c', 'repo.bat build > "<log>" 2>&1'`。`>` 由 cmd.exe 開啟一個真實 Win32
   file handle,不是 PowerShell 讀取的 pipe;孫行程即使繼續持有這個 handle 也
   不影響「process 本身是否已結束」的判斷。
2. **只等 process 本身**：用 `Process.WaitForExit(timeoutMs)`（.NET
   `System.Diagnostics.Process` 方法，等的是 process 的 OS handle 訊號，不是
   stream）取代 `& ... *>`。
3. **PID file + 逾時砍樹**：啟動後立刻把 PID 寫進 `kit-repo-build.pid`；逾時
   （預設 1200 秒 = 20 分鐘，涵蓋 cold build，同時在真的卡住時及時失敗而非無限期
   掛住整條 deploy pipeline）呼叫既有 `Stop-HostNativeService -Name
   'kit-repo-build'` 砍掉整棵 process tree 並回報 `TimedOut=$true`。
4. **注入 seam**：`-StartProcessFn`/`-WaitForExitFn`/`-StopTreeFn` 三個
   scriptblock 參數（對齊既有 `-ChildPidLookup`/`-StopProcessFn`/`-ProbeFn`
   慣例），預設呼叫真實實作，測試可注入假值不觸真進程。

`deploy.ps1` Phase 2 呼叫端改為：

```powershell
$kitBuildResult = Invoke-KitRepoBuild -WorkingDirectory ... -LogPath $kitBuildLog -RunDir $RunDir
if ($kitBuildResult.TimedOut) { ... Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (kit build timeout)'; exit 2 }
if ($kitBuildResult.ExitCode -ne 0) { ... Print-FinalSummary -ExitCode 2 -FailedPhase 'Phase 2 (kit build)'; exit 2 }
```

移除原本的 `Push-Location`/`Pop-Location`/`try-finally`（改由 `Start-Process
-WorkingDirectory` 處理工作目錄）。

## 治理護欄

- 逾時後只砍 `kit-repo-build.pid` 記錄的 PID-tree（重用既有
  `Stop-HostNativeService` 的 pidfile-scoped 護欄），不新增任何無條件的
  machine-global `Get-Process | Stop-Process`。
- `deploy.ps1` 對外行為（CLI 參數、成功/失敗語意、log 檔路徑
  `scripts\.run\kit-repo-build.log`）不變，只有內部呼叫機制與新增的逾時失敗
  路徑。
- 逾時視為 build 失敗（`exit 2`，跟原本非零 exit code 走同一種失敗語意），不會
  讓 deploy.ps1 誤判成功。

## 驗證

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-host-native-launcher.ps1`
→ 16/16 PASS，新增 4 項（Test 13–16）：

- 成功路徑：`ExitCode` 正確轉發、pid file 於成功後移除；
- 非零 exit code：視為失敗但不算逾時；
- **逾時 regression guard**：`WaitForExitFn` 永遠回傳 `$false` 時，`StopTreeFn`
  會被以 `('kit-repo-build', $RunDir)` 呼叫、回傳 `TimedOut=$true`（直接對映
  2026-07-01 實測的卡死場景）；
- pid file 在等待期間（呼叫 `WaitForExitFn` 之前）就已寫入實際 PID，確保外部
  可以在逾時判定前就看到正確的目標 PID。

`test-preflight-host-native.ps1`、`test-rebuild-test-deploy.ps1`、
`test-deploy-report.ps1`、`test-deploy-nullderef-guard.ps1`、
`test-deploy-governance-static.ps1` 皆 PASS，無迴歸；`test-deploy-dryrun.ps1`、
`test-deploy-env-fallback.ps1` 在改動前後（`git stash` 比對）於本機環境同樣失敗
（docker compose file／runtime storage root 相關），確認與本次改動無關。

未在部署測試區重跑一次真的 `repo.bat build` 端到端驗證 —— 那會打斷同一 session
稍早才修復並部署起來、目前健康運作中的測試部署區，風險/效益不成比例。下次測試
部署區觸發真正的 Kit 重建時可以順便驗證這個修復。

## Impact

`Invoke-KitRepoBuild` 是新函式，唯一呼叫端是 `deploy.ps1` 這段 Phase 2 kit
build 區塊；`Stop-HostNativeService`（既有、被動重用，未修改其簽章）另有的呼叫端
（governance-service／conversion-service／bim-streaming-server 的既有 stop
路徑、`rebuild-test-deploy.ps1` 的 pre-clean stopper）皆用各自既有的
`Name`/`RunDir` 參數，跟這次新增的 `'kit-repo-build'` 服務名稱不衝突。Blast
radius：LOW。（本機 GitNexus 圖譜未索引這些 PowerShell symbol，`impact()` 查
`Stop-HostNativeService` 回傳 0 筆；以上為手動讀碼 grep 全部呼叫端後的推理，CI
pr-review-agent 之 GitNexus detect-changes 為權威 impact 檢查。）
