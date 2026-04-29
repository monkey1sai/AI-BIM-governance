# Server App Validation

本文件用來驗證 server repo 的 app 設定修改後沒有破壞 build、test 與 WebRTC streaming runtime。

適用情境：

- 修改 `premake5.lua` 的 `define_app(...)`
- 修改 `repo.toml` 的 repo 設定
- 新增或移除 `source/apps/*.kit`
- 調整 server app 啟動流程

## 1. 前置檢查

在 server repo 根目錄執行：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
git status --short
git diff -- premake5.lua repo.toml
```

確認本次 diff 只包含預期修改。

## 2. App 檔案存在性檢查

```powershell
Test-Path .\source\apps\ezplus.bim_review_stream.kit
Test-Path .\source\apps\ezplus.bim_review_stream_streaming.kit
Test-Path .\source\apps\ezplus.bim_ifc_usd_converter.kit
```

預期三個結果都是 `True`。

## 3. Build 驗證

```powershell
.\repo.bat build
```

預期結果：

```text
BUILD (RELEASE) SUCCEEDED
```

build 後確認 launcher 產物存在：

```powershell
Test-Path .\_build\windows-x86_64\release\ezplus.bim_review_stream.kit.bat
Test-Path .\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat
Test-Path .\_build\windows-x86_64\release\ezplus.bim_ifc_usd_converter.kit.bat
```

預期三個結果都是 `True`。

## 4. Test Runner

```powershell
.\repo.bat test
```

預期測試完成且沒有 failed tests。若這一步因環境、GPU、SDK 或測試相依問題失敗，需保留完整錯誤訊息並說明是否與本次 app 設定修改相關。

## 5. Streaming Runtime Smoke

啟動主要 streaming app：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

預期 server log 包含：

```text
Started primary stream server on signal port 49100
```

不得出現：

```text
Failed to start the primary stream server
FrameGrabFailed
```

另一個 PowerShell 視窗可檢查 port：

```powershell
Get-NetTCPConnection -LocalPort 49100 -ErrorAction SilentlyContinue
```

預期 `49100` 被新的 `kit.exe` 持有。

## 6. Web Viewer End-to-End

如果要驗證 browser 端是否真的收到串流，啟動 sibling client repo：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
npm run dev
```

開啟：

```text
http://localhost:5173
```

在 browser DevTools 檢查：

```javascript
const video = document.querySelector("video");
({
  readyState: video?.readyState,
  videoWidth: video?.videoWidth,
  videoHeight: video?.videoHeight,
  currentTime: video?.currentTime,
});
```

預期：

- `readyState` 是 `4`
- `videoWidth > 0`
- `videoHeight > 0`
- `currentTime` 持續增加
- console 沒有 `NoVideoPacketsReceivedEver` 或 `FrameGrabFailed`

## 7. 驗證紀錄範本

```markdown
| Check | Command / method | Result | Evidence / notes | Coverage gap | Residual risk |
| --- | --- | --- | --- | --- | --- |
| Git diff | `git diff -- premake5.lua repo.toml` |  |  |  |  |
| App files | `Test-Path ...` |  |  |  |  |
| Build | `.\repo.bat build` |  |  |  |  |
| Launcher files | `Test-Path .\_build\...\*.kit.bat` |  |  |  |  |
| Tests | `.\repo.bat test` |  |  |  |  |
| Streaming smoke | `.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window` |  |  |  |  |
| Web viewer E2E | `npm run dev` + browser check |  |  |  |  |
```

## 8. 本次執行紀錄：2026-04-28

| Check | Command / method | Result | Evidence / notes | Coverage gap | Residual risk |
| --- | --- | --- | --- | --- | --- |
| Git diff | `git diff -- premake5.lua repo.toml` | PASS | diff 僅包含新增 `ezplus.bim_ifc_usd_converter.kit` app 定義與 repo name 改為 `bim-streaming-server`。 | 未涵蓋其他未追蹤文件。 | 低。 |
| App files | `Test-Path .\source\apps\*.kit` | PASS | 三個 app 源檔都回傳 `True`。 | 只檢查存在性，不檢查 kit 設定語意。 | 低。 |
| Build | `.\repo.bat build` | PASS | `BUILD (RELEASE) SUCCEEDED (Took 7.37 seconds)`。build precache 包含 `ezplus.bim_ifc_usd_converter.kit`。 | 未做 package/container build。 | 低。 |
| Launcher files | `Test-Path .\_build\windows-x86_64\release\*.kit.bat` | PASS | 三個 launcher 都回傳 `True`，包含 `ezplus.bim_ifc_usd_converter.kit.bat`。 | 只檢查 release launcher。 | 低。 |
| Tests | `.\repo.bat test` | PASS | `All 5 tests processes returned 0`。`ezplus.bim_review_stream.setup` 實際跑 3 tests 並 OK。app-level kit test process 無 extension tests 但回 OK。 | app-level smoke 不等同完整互動測試。 | 中低。 |
| Streaming smoke | script 啟動 `.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window`，等待 port/log 後清理 | PASS | `Port49100Detected=True`，`StartedPrimaryStreamServerLog=True`，`FailurePattern=` 空，`RepoKitPidsAfterCleanup=` 空。stdout：`_testoutput\server-app-validation-launch-20260428-154924.out.log`。 | 未連 browser client。 | 中低。 |
| Web viewer E2E | `npm run dev` + browser check | NOT RUN | 本任務限定在 server repo 內建立並執行 server app 驗證，未啟動 sibling `web-viewer-sample`。 | 未驗證 browser video frame 是否推進。 | 若要交付 WebRTC 端到端體驗，仍需補跑。 |

## 9. 連線卡在 `Waiting for stream to begin` 的排查紀錄：2026-04-28

### Root cause

第一次 browser 卡在 `Waiting for stream to begin` 的直接原因是 server app 沒有在 `49100` 上提供 signaling service。先前 server runtime smoke 完成後，驗證腳本把 server repo 的 `kit.exe` 清掉，因此 `web-viewer-sample` 仍開著但已沒有可連線的 streaming server。

確認方式：

```powershell
Get-NetTCPConnection -LocalPort 49100 -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "name = 'kit.exe'"
```

當時 `49100` 無 listener，且沒有 server repo 的 `kit.exe`。

### Clean restart

只停止 server repo 底下的 stale Kit process，重新啟動 streaming app：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

重啟後確認：

- `49100` 由新的 server repo `kit.exe` listen。
- Kit log `C:\Users\IOT\.nvidia-omniverse\logs\Kit\BIM Review Stream Streaming\0.1\kit_20260428_162250.log` 包含 `Started primary stream server on signal port 49100 and stream port 47998`。
- 同一份 log 包含 `app ready`。

### Web viewer E2E result

使用 `web-viewer-sample` 的 Vite dev server 連到 `http://127.0.0.1:5173`，並確認 `GET /api/assets` 回傳：

```json
[
  {
    "name": "BIM: 許良宇圖書館建築 2026",
    "url": "C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/許良宇圖書館建築_2026.usdc"
  }
]
```

browser 端驗證結果：

```text
readyState=4
videoWidth=1920
videoHeight=1080
currentTime=5.782038
paused=false
streamVisible=visible
```

server log 對應證據：

```text
Client connected to WebRTC server
Processing custom kit message: {"event_type":"openStageRequest", ...}
... 許良宇圖書館建築_2026.usdc opened successfully in 0.28 seconds
Sending message to client that stage has loaded: ...
```

結論：`/api/assets`、client custom message、server stage loading 與 WebRTC video frame 都已通過端到端驗證。若日後再次停在 `Waiting for stream to begin`，第一步應先檢查 `49100` listener 與 server repo `kit.exe` 是否存在，再檢查 browser video `readyState`。
