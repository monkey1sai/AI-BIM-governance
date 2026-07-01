# Spec：rebuild-test-deploy 於 git clean 前先停部署區 locker 服務

## 問題

`.\scripts\dev\rebuild-test-deploy.ps1 -Build` 偶發失敗於 `git clean -fdx`：

```
warning: failed to remove bim-streaming-server/_build/.../logs/Kit/kit_*.log: Invalid argument
git clean -fdx failed with exit code 1
```

根因：clean 在部署區 `D:\Users\deploy\AI-bim-geo` 執行，`-x` 會納入 gitignored 的 `bim-streaming-server/_build/`；上一輪重建（rebuild N）以 `Start-HostNativeKit` 起的 `kit.exe` 到下一輪（N+1）仍存活、持有 `_build/.../logs/Kit/*.log` 的檔案 handle，Windows 拒絕 unlink，git 對映成 EINVAL「Invalid argument」→ exit 1 → `Invoke-TestDeployGitCommand` throw、重建在 `deploy.ps1` 尚未執行前 abort。同一次 clean 也會刪除 `scripts/.run/*.pid`，形成「要停服務卻先被 clean 刪掉 pidfile」的雞生蛋。

（log 中的 `Removing .env ... restored env files count=3` 是 `Save/Restore-TestDeployEnvSnapshot` 既有設計、非本問題來源。）

## 設計

在 `Invoke-TestDeployRebuild` 的 `git reset --hard` 與 `git clean -fdx` 之間、且於既有 try 內：

1. **Pre-clean 停部署區 locker**：對 `$deployRoot` 的 `scripts\.run` 內、由本部署區 pidfile 記錄的三個 host-native 服務（`bim-streaming-server`、`bim-streaming-conversion-service`、`governance-service`）呼叫既有 `Stop-HostNativeService`（`scripts/lib/host-native-launcher.ps1`）；此時 pidfile 尚未被 clean 刪除。
2. **best-effort**：停服務失敗只印 WARNING、不中止；真正安全網是下方 retry。
3. **Retry only clean**：僅對 `git clean -fdx` 包 3 次、間隔約 1s 的重試，吸收「handle 剛釋放／防毒剛掃完」的瞬時競速；最後一次仍失敗才 re-throw，續走既有 env-restore catch。
4. **注入 seam**：新增 `-ServiceStopper` scriptblock 參數（對齊 `-CommandRunner`／`-DeployRunner`，預設 null → dot-source launcher 呼叫真 `Stop-HostNativeService`），供測試注入假 stopper、不觸真進程。

## 治理護欄

- **只停部署區自己 pidfile 記錄的 PID-tree**。`Stop-HostNativeService` 讀 `$RunDir\$Name.pid`，無 pidfile 即 no-op；`hub.exe`（NVIDIA Omniverse Hub，位於 `C:\Users\...\ov\pkg`）不是這三個服務的子進程、也不在部署區底下，**永遠不會被停**。
- 不新增任何無條件的 machine-global `Get-Process | Stop-Process`。
- `deploy.ps1` golden path 未變動。

## 安全網（未採用，記錄備援）

`git clean -fdx -e bim-streaming-server/_build`（`deploy.ps1 -Build` Phase 2 會重生 `_build`）可讓 clean 完全跳過最常被鎖的目錄；未預設採用，因會留下 stale `_build`，而 stop + retry 已足夠。

## 驗證

`pwsh scripts/tests/test-rebuild-test-deploy.ps1` → `[PASS]`，含新增斷言：

- 三個服務皆被停，且每個 stop 事件 index 皆早於 clean 事件（共用 ordered log）；
- clean 首次擲 `Invalid argument`、重試後成功 → 重建仍抵達 deploy、回傳 DeployExitCode、不 throw；
- 既有 `cleanFailureRunner` 改為 idempotent（`-ErrorAction SilentlyContinue`），使新重試迴圈下最終浮現的錯誤仍是 git 輸出而非 missing-file。

真實部署驗證於此變更 merge 後、在部署區執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`。

## Impact

`Invoke-TestDeployRebuild` 的呼叫者為 `scripts/dev/rebuild-test-deploy.ps1` 包裝器與本測試；新增參數為可選（預設 null），不破壞既有簽章；pre-clean stop 與 retry 皆為附加行為。Blast radius：LOW。（本機 GitNexus 索引 stale，以上為推理；CI pr-review-agent 之 GitNexus detect-changes 為權威 impact 檢查。）
