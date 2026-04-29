# Other — 連線測試.md

# BIM Streaming 連線測試

## 目的

本模組旨在快速確認 `bim-streaming-server` 重新啟動後，`web-viewer-sample` 客戶端是否能夠成功連線並顯示 WebRTC 串流畫面。此測試流程確保了系統的穩定性和可用性，特別是在伺服器重啟後。

## 目錄結構

- **Server**: `C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server`
- **Client**: `C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample`

## 測試流程

### 1. 確認無殘留伺服器

在進行測試前，需確保沒有舊的伺服器進程在運行。使用以下 PowerShell 命令檢查：

```powershell
Get-Process kit -ErrorAction SilentlyContinue
netstat -ano | Select-String ':49100|:47998|:5173'
```

**預期結果**:
- `kit.exe` 進程應該不存在。
- 端口 `49100` 和 `47998` 應該未被占用。
- 若端口 `5173` 被占用，需確認是否為舊的 Vite 客戶端。

### 2. 啟動伺服器

建議使用官方的 headless streaming 路徑啟動伺服器：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

或直接執行已編譯的產物：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat --no-window
```

**伺服器日誌預期輸出**:

```text
Started primary stream server on signal port 49100 and stream port 47998
app ready
```

### 3. 啟動客戶端

在另一個 PowerShell 窗口中啟動客戶端：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
npm run dev -- --host 127.0.0.1
```

**Vite 預期輸出**:

```text
Local:   http://127.0.0.1:5173/
```

### 4. 瀏覽器操作

在瀏覽器中打開以下網址：

```text
http://127.0.0.1:5173/
```

選擇預設選項：

```text
UI for default streaming USD Viewer app
```

按下 `Next` 鍵。

**伺服器日誌預期輸出**:

```text
Client connected to WebRTC server
```

**畫面預期顯示**:
- NVIDIA Web Viewer 標題出現。
- 3D demo 場景可見。
- 影像持續更新，非靜止黑畫面。

### 5. 瀏覽器端可量測條件

使用 DevTools Console 檢查以下條件：

```js
const v = document.querySelector("#remote-video");
({
  readyState: v.readyState,
  videoWidth: v.videoWidth,
  videoHeight: v.videoHeight,
  currentTime: v.currentTime,
  paused: v.paused
});
```

**成功條件**:
- `readyState = 4`
- `videoWidth > 0`
- `videoHeight > 0`
- `currentTime` 隨時間增加
- `paused = false`

### 6. 正確關閉順序

為了確保系統的穩定性，建議按照以下順序關閉：

1. 關閉瀏覽器 viewer 頁面。
2. 在客戶端終端按 `Ctrl+C` 停止 Vite。
3. 在伺服器終端按 `Ctrl+C` 停止 Kit 伺服器。
4. 若 PowerShell 提問 `Terminate batch job (Y/N)?`，輸入 `Y`。
5. 檢查 `kit.exe` 是否已消失：

```powershell
Get-Process kit -ErrorAction SilentlyContinue
netstat -ano | Select-String ':49100|:47998|:5173'
```

若 `kit.exe` 仍在運行，需確認 PID 路徑是否為本 repo，並必要時精準停止該 PID：

```powershell
Stop-Process -Id <PID>
```

### 7. 不乾淨關閉後的判斷

若未按照正確順序關閉，伺服器日誌可能出現以下錯誤：

```text
Failed to setup the streaming session because: StreamSdkException 800b0000 [NVST_R_GENERIC_ERROR] Got stop event while waiting for client connection.
```

這表示 WebRTC session setup 被中斷。若重啟後日誌持續出現以下模式：

```text
Processing 13 signaling headers
Got stop event while waiting for client connection
```

**處理方式**:
1. 關閉所有 `127.0.0.1:5173` / `localhost:5173` 的瀏覽器標籤。
2. 停止 Vite 客戶端。
3. 停止伺服器。
4. 確認 `kit.exe` 和 `49100` / `47998` 已釋放。
5. 依照第 2-4 節重新啟動並按 `Next`。

### 8. Codex / 自動化測試注意事項

在 Codex sandbox 內，直接使用 `Start-Process` 啟動 Kit / npm 可能會遇到 Windows session、GPU、Winsock 或 module loading 問題。建議使用 Windows Scheduled Task 在互動桌面 session 執行。

**自動化問題與解法**:
- `Start-Process` 直接啟動失敗，錯誤包含「目錄名稱無效」或「找不到指定的模組」。
- 使用 `schtasks.exe` 代替 PowerShell `ScheduledTasks` cmdlet。
- 使用 `.cmd` wrapper 進入 client repo 再執行 `npm run dev -- --host 127.0.0.1`。
- Chrome 的 `--remote-debugging-port` 可能無法正確開啟 `DevToolsActivePort`，可使用 Windows UI Automation 找到 `Next` 按鈕並觸發。

自動化驗證仍以伺服器日誌和畫面為準，不要僅依賴 `curl` / `netstat`，因為 Codex shell 內的 TCP 查詢可能與桌面實際狀態不一致。

## 結論

本模組提供了一個完整的測試流程，確保 `bim-streaming-server` 和 `web-viewer-sample` 客戶端之間的連線穩定性。遵循上述步驟可有效地進行測試和故障排除，並確保系統的正常運行。
