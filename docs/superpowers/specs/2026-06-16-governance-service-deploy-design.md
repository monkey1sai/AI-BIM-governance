# deploy.ps1 -Build 啟動 governance-service 設計規格

## 文件性質

- 文件性質：spec design（設計文件）。
- 需求來源：使用者要求「`deploy.ps1 -Build` 新增 `governance-service`」。
- 權威序：code > contracts > `AGENTS.md` > 本 spec > generated wiki。
- 對應背景：PR #213 已把 A1/M1 closeout 的五步 stepper、失敗構件抽屜、`GET /api/rule-runs/{id}/failures` 與 `/api/governance/*` proxy 做完；目前阻塞點不是 A1 功能本身，而是 canonical deploy 沒有啟動 `governance-service :49102`。

## 問題

`scripts/deploy.ps1 -Build` 目前會建置 coordinator + viewer 的 Docker web-plane，也會啟動 host-native conversion-service 與 Kit runtime，但不會啟動 `governance-service`。結果是：

1. `/ui/#/a1` 已被打包進 coordinator `/ui`，但按 A1 rule-run 時，coordinator 的 `/api/governance/*` proxy 會連不到 `http://host.docker.internal:49102` 或 `127.0.0.1:49102`。
2. 使用者必須另開一個 terminal 手動跑 `governance-service\app.py`，這讓 `deploy.ps1 -Build` 不是完整的 A1/M1 closeout 啟動入口。
3. `stop-all.ps1` 不知道 `governance-service`，即使手動啟動也沒有一致的 PID/log/cleanup lifecycle。

## 目標

讓 `.\scripts\deploy.ps1 -Build` 在 canonical hybrid deploy 中一併啟動 host-native `governance-service`，使 A1/M1 closeout 可從單一 deploy 命令啟動到可操作狀態。

成功標準：

1. `deploy.ps1` 預設啟動 `governance-service` 於 `127.0.0.1:49102`。
2. Docker coordinator 仍透過 `HOST_GOVERNANCE_API_BASE=http://host.docker.internal:49102` 連到 host-native service。
3. `scripts\.run\governance-service.pid`、`governance-service.log`、`governance-service.log.err` 由共用 host-native launcher 管理。
4. `deploy.ps1 -DryRun` 不進 Phase 4，但會在 `scripts\.run\deploy-audit.json` 記錄 governance runtime 意圖（port、skip state、base URL），不實際啟 process。
5. `deploy.ps1 -SkipGovernance` 可跳過 governance，且 Phase 5 不把 governance health 視為失敗。
6. `stop-all.ps1` 會停止 `governance-service` 並清掉 PID file。
7. `StrictPostVerify` 開啟時，governance health 失敗會讓 deploy exit 5。
8. A1 UI 可在 `http://127.0.0.1:8004/ui/#/a1` 使用預設 fixture 走到 rule-run success/failure state，不需要第二個 terminal。

## 非目標

- 不把 `governance-service` Docker 化。此服務維持 host-native，原因是 ifcopenshell/CPU IFC 掃描與本機 IFC 檔案視角要跟 host storage 對齊。
- 不修改 A1 stepper、失敗構件抽屜、rule engine、BCF/export 行為。
- 不新增 production dependency。
- 不把 `governance-service` 暴露給瀏覽器直連；瀏覽器仍只打 coordinator `/api/governance/*`。
- 不用 `-Force` 殺無關 PID。port 被陌生 process 佔住時沿用 Phase 3 guard。
- 不把 local `storage/`、DB、IFC、USDC 或 deploy logs commit 進 repo。

## 架構

```txt
PowerShell deploy.ps1 -Build
  -> Phase 1/2 preflight + docker build
  -> Phase 3 dangerous action guard
  -> Phase 4a host-native governance-service :49102
  -> Phase 4b host-native conversion-service :49101
  -> Phase 4c host-native Kit :49100
  -> Phase 4d Docker web-plane coordinator/viewer
  -> Phase 5 health verify

Browser
  -> http://127.0.0.1:8004/ui/#/a1
  -> /api/governance/*
  -> coordinator container
  -> http://host.docker.internal:49102
  -> host-native governance-service
```

`governance-service` 應透過共用 launcher 啟動：

```powershell
python -m uvicorn app:app --host 127.0.0.1 --port 49102
```

啟動工作目錄：

```txt
C:\Repos\active\iot\AI-BIM-governance\governance-service
```

建議環境變數：

| 變數 | 值 | 說明 |
|---|---|---|
| `GOV_PORT` | `49102` | 與 deploy 參數一致 |
| `GOV_DB_PATH` | `<RepoRoot>\storage\governance.db` | 預設 DB，沿用 service 現有預設語意 |
| `BIM_FILE_LIBRARY_ROOT` | `<RuntimeStorageRoot>` 或 `<RepoRoot>\storage` | A1 file-library tree 的 host 視角 |
| `PYTHONNOUSERSITE` | unset | `governance-service` 指定 host Python312；實機依賴可能位於 user-site，launcher 需清掉此變數，避免 `python -m uvicorn` 找不到 uvicorn |

## deploy.ps1 行為變更

新增參數：

```powershell
[switch] $SkipGovernance,
[int]    $GovernancePort = 49102
```

新增 script-scope signature：

```powershell
$script:governanceRuntimeSignaturePath = Join-Path $RunDir 'governance-service.params.json'
```

新增 runtime signature 欄位：

```json
{
  "host": "127.0.0.1",
  "port": 49102,
  "dbPath": "<RepoRoot>\\storage\\governance.db",
  "fileLibraryRoot": "<runtimeStorageRoot>"
}
```

若 PID file 已存在：

1. signature 相符且 `/health` 回 200：skip，不重啟。
2. signature 不相符：只停止 PID file 指向的 `governance-service` process tree，再重啟。
3. wrapper process 活著但 `/health` 不健康：停止 PID file 指向 process tree，再重啟。

若 port 49102 被陌生 process 佔用：

1. Phase 3 依既有 dangerous action guard 詢問或在 `-Force` 下處理。
2. 不為 governance 新增繞過 guard 的 kill 行為。

## launcher 行為變更

在 `scripts/lib/host-native-launcher.ps1` 新增 `Start-HostNativeGovernance`，薄包裝既有 `Start-HostNativeService`。

必須使用既有 PID/log 標準：

```txt
scripts\.run\governance-service.pid
scripts\.run\governance-service.log
scripts\.run\governance-service.log.err
```

Python 解析順序：

1. 優先使用 `C:\Program Files\Python312\python.exe`，因為 `governance-service` contract 指定這個 host Python 具備 `ifcopenshell`。
2. 若 `C:\Program Files\Python312\python.exe` 不存在，才允許 fallback 到 `<RepoRoot>\.venv\Scripts\python.exe` 或 `python`。
3. 選定 interpreter 後，啟動前必須驗證可 import `ifcopenshell`、`fastapi`、`uvicorn`。驗證失敗要在 Phase 4a 直接 fail，不能等 `/health` timeout 才模糊失敗。

## compose/env 行為

`compose.host-kit.yml` 已有：

```yaml
GOVERNANCE_API_BASE: ${HOST_GOVERNANCE_API_BASE:-http://host.docker.internal:49102}
```

deploy 預設不需改 compose。若 `-GovernancePort` 不是 `49102`，`deploy.ps1` 必須在啟 docker compose 子程序前設定 process env：

```powershell
[Environment]::SetEnvironmentVariable(
  'HOST_GOVERNANCE_API_BASE',
  "http://host.docker.internal:$resolvedGovernancePort",
  'Process'
)
```

當 `-GovernancePort` 明確傳入或解析後不是 `49102`，`deploy.ps1` 必須強制 refresh Docker web-plane；不得因 coordinator/viewer 已 running 就 skip compose，否則 running coordinator container 可能保留舊的 `GOVERNANCE_API_BASE`。

## stop-all 行為變更

`scripts/stop-all.ps1` 的 expected services 必須加入：

```powershell
@{ Name = "governance-service"; Ports = @(49102) }
```

若後續支援非 49102 port，`stop-all.ps1` 可先以 PID file 為主，port audit 仍列 49102 預設值。本輪不要求 stop-all 解析 deploy env。

## 測試與驗收

最小文件/腳本驗證：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-deploy-dryrun.ps1
powershell -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts\deploy.ps1)) | Out-Null; [scriptblock]::Create((Get-Content -Raw scripts\stop-all.ps1)) | Out-Null; [scriptblock]::Create((Get-Content -Raw scripts\lib\host-native-launcher.ps1)) | Out-Null"
```

最小 runtime smoke：

```powershell
.\scripts\stop-all.ps1
.\scripts\deploy.ps1 -Build -SkipKit -SkipConversion -StrictPostVerify
Invoke-WebRequest http://127.0.0.1:49102/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8004/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8004/ui -UseBasicParsing
```

完整 A1 驗收：

```powershell
.\scripts\deploy.ps1 -Build -StrictPostVerify
cd web-viewer-sample
npm run e2e -- --project=chromium --grep "A1"
```

完成回報必須列出：

- Frontend URL：`http://127.0.0.1:8004/ui/#/a1`
- Buttons tested：檔案庫選取、執行規則檢核、展開失敗構件、建立 issue、匯出 Excel/BCF
- Test fixture used：repo local `storage/fixture-bytes.ifc` 或明確替代 fixture
- Expected visible result：五步 stepper 到 scored/issued/delivered，失敗構件抽屜可見 GUID/name/type/storey
- E2E command
- Screenshot/trace path
- Known limitations

## 風險

- host-native Python 環境若缺 `ifcopenshell`，`governance-service` 可能在 `app.py` import 階段就啟動失敗；因此 Phase 4a 需要 interpreter import sanity check，不能只依賴 `/health` timeout。
- Docker coordinator 看到的是 `host.docker.internal`；PowerShell host health 看到的是 `127.0.0.1`。兩者都要在驗收中覆蓋。
- `-SkipGovernance` 是 escape hatch，只能用於 debug；不能用來宣告 A1/M1 deploy complete。
- 若 `GovernancePort` 改成非 49102，所有文件與測試必須確認 `HOST_GOVERNANCE_API_BASE` 有跟著傳入 docker compose 子程序。
