# rebuild-test-deploy-pwsh7-child — self-referential bootstrap

> 文件性質：**bootstrap 宣告證據**。本檔說明為何本 PR 無法在合併前取得代表變更後行為的 canonical 證據，以及 fixpoint 要重放什麼。

## 變更對象是驗證機制本身

本 PR 改的是 `scripts/lib/rebuild-test-deploy.ps1` 的 deploy 子行程啟動器，命中 `SelfReferentialMechanismPattern` 的 `^scripts/lib/(...|rebuild-test-deploy|...)\.ps1$`。

`Invoke-TestDeployScript` 原本以 `powershell.exe`（Windows PowerShell 5.1）執行 `scripts\deploy.ps1`。5.1 在傳遞 native command 參數時會吃掉內嵌雙引號，使 `Resolve-PlatformSystemPython` 的版本探針

```
& $candidate -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
```

送出損壞的 `-c` payload、python 以語法錯誤 exit 非 0、兩個候選都被 `continue` 跳過，resolver 回 `$null`，`deploy.ps1` 於 `New-DeployVenv` 以「no usable system python found (tried python / python3)」exit 2 —— 儘管該機器 PATH 上有可用的 Python 3.12。

## 本機隔離證據（同機、同 python、腳本檔執行）

| 條件 | 結果 |
|---|---|
| PS 5.1 ＋ 原始 f-string | `exit=1`，python 回 `File "<string>", line 1` 語法錯誤 |
| PS 5.1 ＋ 同邏輯但無內嵌雙引號 | `exit=0` → `3.12` |
| PS 7 ＋ 原始 f-string | `exit=0` → `3.12` |

## 為何 pre-merge 取不到 canonical 證據

`rebuild-test-deploy` 每次都以 freshly fetched `origin/main` 換成全新 checkout（因此 `.venv` 不存在、`New-DeployVenv` 必被呼叫）。分支上的 launcher 不會出現在該 checkout 內；能代表「變更後行為」的 canonical 重建只有在本變更進入 `main` 之後才成立。故登記 fixpoint debt，由 post-merge 重放結案。

## 影響邊界

`scripts/dev/rebuild-test-deploy.ps1` 對 `connection.type -eq 'ssh'` 的 target 直接走 `Invoke-RemoteTestDeployRebuild` 並 `exit`，**不經過** `Invoke-TestDeployScript`。因此本變更只影響 **local target（`local-windows`）**，canonical Linux 路徑未受影響 —— contract 因此以 `local-windows-rebuild` 而非 `canonical-linux-rebuild` 作為部署面證明。

## 一併修正的自身錯誤

本分支第一版同時把子行程 PSModulePath 改成 PowerShell 7 模組根，結果重現了原設計要防的污染：`deploy.ps1` 透過 `Get-HostNativePowerShellExe`（Windows 回 `powershell.exe`）生出 5.1 孫行程，它們繼承該值後解析到 Core-only 的 `Microsoft.PowerShell.Utility` 而載入失敗，`Get-FileHash` 消失，Phase 4d 掛掉。以 `Get-FileHash` 為探針實測：

| 模組根順序 | PS 5.1 | PS 7 |
|---|---|---|
| PS7 根在前 | MISSING | OK |
| Windows 根在前 | OK | OK |
| **只給 Windows 根（原設計）** | **OK** | **OK** |

已還原為原設計（只給 Windows 根），並把實測三列寫進函式註解。pwsh 7 透過 `$PSHOME` 解析自身模組，不需要 PSModulePath 協助。

## Contract 為何不含部署命令

`scripts/tests/test-self-referential-bootstrap.ps1` 的 immutable command map 只有 `canonical-linux-rebuild`／`canonical-linux-deployment-verify` 兩個部署命令，**沒有 local-windows 對應項**。而如上所述，本變更只影響 local target；宣告 `canonical-linux-rebuild` 會用一個**根本跑不到本變更**的動作充當證明，因此不採用。

contract 因此只收 map 內真正會執行到本變更的測試。真實的 local-windows 重建屬 operator 動作，於 fixpoint summary 以誠實敘述揭露，不冒充為機器契約的一部分。

| 欄位 | 值 |
|---|---|
| entry id | `rebuild-test-deploy-pwsh7-child` |
| contract id | `rebuild-test-deploy-pwsh7-child/v1` |
| command_ids | `test-rebuild-test-deploy`, `test-platform-adapter`, `test-host-native-launcher`, `test-host-native-child-launch`, `test-deploy-target-registry`, `test-deploy-governance-static`, `test-self-referential-bootstrap`, `test-agent-governance-check`, `invoke-powershell-static` |
| contract_sha256 | `b425887e7bd4ea8801ec645bbbf6511f542a1207c267e35230136b8bb435aa85` |
