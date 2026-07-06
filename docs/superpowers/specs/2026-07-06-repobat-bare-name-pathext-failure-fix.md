# Spec：Invoke-KitRepoBuild 改用完整路徑呼叫 repo.bat

## 問題

2026-07-06 執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build` 重建測試部署區
（`D:\Users\deploy\AI-bim-geo`），在 Phase 2 Kit build 步驟失敗（exit 2，
`Phase 2 (kit build artifacts)`）。`scripts\.run\kit-repo-build.log` 內容：

```
'repo.bat' is not recognized as an internal or external command,
operable program or batch file.
```

但同時：

- `Test-Path (Join-Path $workingDirectory 'repo.bat')` → `True`
- `dir` 在該目錄下清楚列出 `repo.bat`
- `where repo.bat` 在該目錄下也找得到完整路徑

這是繼 [[repobat-build-stream-redirect-hang]]（PR #268/#281 已修的 EINVAL 鎖檔
／output-redirect-hang）之後，**第三種**、獨立的 Phase 2 失敗成因：檔案確實
存在，但 cmd.exe 對**裸檔名**的執行查找（PATHEXT 展開 + 檔案關聯解析）在這台
部署機上失敗（`assoc .bat`／`ftype batfile` 皆回報 not found）。

根因定位在 `Invoke-KitRepoBuild`（`scripts/lib/host-native-launcher.ps1`）
預設 `StartProcessFn` 用裸檔名組出的 command line：

```powershell
$cmdLine = "repo.bat build > `"$logPath`" 2>&1"
```

## 設計

改用 `Join-Path $workingDirectory 'repo.bat'` 組出完整、已加引號的路徑，取代
裸檔名：

```powershell
$repoBatPath = Join-Path $workingDirectory 'repo.bat'
$cmdLine = "`"$repoBatPath`" build > `"$logPath`" 2>&1"
```

其餘（`Start-Process -FilePath cmd.exe -ArgumentList @('/c', $cmdLine)
-WorkingDirectory $workingDirectory -NoNewWindow -PassThru`、PID file、
`WaitForExitFn`、`StopTreeFn` 逾時砍樹）維持不變 —— 這是最小、行為不變的
呼叫方式調整，健康主機下（裸名查找本來就能成功的情況）產生完全相同的執行
結果。

## 治理護欄

- 只改 `$cmdLine` 的組成方式，不改函式簽章、不改任何注入 seam
  （`-StartProcessFn`/`-WaitForExitFn`/`-StopTreeFn`）的介面。
- `deploy.ps1` 呼叫端（`Invoke-KitRepoBuild -WorkingDirectory ... -LogPath
  ... -RunDir ...`）完全不用修改。
- 不涉及機碼 / 系統層級變更（不修 `assoc`/`ftype`/`HKEY_CLASSES_ROOT`）——
  那是主機環境設定，不是這個 repo 的程式碼職責。

## 驗證

`powershell -NoProfile -ExecutionPolicy Bypass -File
scripts/tests/test-host-native-launcher.ps1` → 17/17 PASS，新增 Test 17：

- 斷言預設 `StartProcessFn` 的原始碼**不**含裸檔名 `"repo.bat build` 呼叫；
- 斷言含 `Join-Path $workingDirectory 'repo.bat'` 的完整路徑組成邏輯。

`test-rebuild-test-deploy.ps1` PASS，無迴歸。`.\scripts\deploy.ps1 -DryRun`
於本 worktree 正常完成，Phase 1 preflight 正確列出 `kitRuntime=NEEDS_BUILD`，
無 crash。

**未完整端到端驗證此修復對部署測試區的實際效果**：嘗試直接對現有部署區
（`D:\Users\deploy\AI-bim-geo`）用修好的程式碼呼叫真實 `Invoke-KitRepoBuild`
時，多次遇到另一個更深層、且獨立於本次修法的現象——執行環境（Claude 背景
job session）內執行**任何** `.bat` 檔案（不論裸檔名或完整路徑，包含現場
新建的最小測試 `.bat`）都失敗，而 `.exe`／cmd 內建指令不受影響；
`assoc .exe` 在這個 session 內同樣回報 not found，判斷是背景 job 的
process/token 對 `HKEY_CLASSES_ROOT` 存取受限（sandbox 限制），而非這次
要修的 bug。這個限制使本次修復無法在該次診斷 session 內被完整端到端驗證，
但不影響本次修法本身的正確性（單元測試層級已鎖住行為，且是最小、不改變
健康主機既有行為的呼叫方式調整）。建議下次互動式（非背景自動化）觸發
`rebuild-test-deploy.ps1 -Build` 時，確認 Phase 2 是否確實通過。

## Impact

`Invoke-KitRepoBuild` 唯一呼叫端是 `scripts/deploy.ps1` Phase 2 的 kit build
區塊（grep 全 repo 找到的另外兩個命中是它自己的測試檔與
[[repobat-build-stream-redirect-hang]] spec 文件，非額外呼叫端）。Blast
radius：LOW。（GitNexus 未索引此 PowerShell symbol，`impact()` 查
`Invoke-KitRepoBuild` 回傳 not found；以上為手動 grep 全部呼叫端後的推理。）
