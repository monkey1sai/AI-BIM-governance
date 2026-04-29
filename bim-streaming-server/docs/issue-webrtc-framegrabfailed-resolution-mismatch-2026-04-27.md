# Issue Wiki: WebRTC `FrameGrabFailed` 排查與解法

日期：2026-04-27

## 結論

這次 `FrameGrabFailed` / 黑畫面問題的主因是 WebRTC 串流解析度協商不一致，不是 stage 空白、port 錯誤，或搬移 repo 後 source 仍指向舊路徑。

正式解法：

- server 使用 NVIDIA kit-app-template 官方建議的 headless streaming 啟動方式：`--no-window`
- client 不要寫死 `height: 1062` / `1009` / `1008`
- 以 server / WebRTC handshake 回傳的實際 stream size 為準
- 不要再用 windowed server 的視窗高度 workaround 當正式方案

最新驗證結果：

```text
server repo: C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
client repo: C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
server: _build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat --no-window
client: npm run dev -- --host 127.0.0.1
browser: http://127.0.0.1:5173/
```

成功證據：

```text
Started primary stream server on signal port 49100 and stream port 47998
app ready
Client connected to WebRTC server
```

Browser 端曾量測到：

```json
{
  "readyState": 4,
  "videoWidth": 1920,
  "videoHeight": 1080,
  "currentTime": "0.224821 -> 3.229019",
  "paused": false
}
```

2026-04-27 16:47 再次驗證：重新關閉 client/server 後重啟，browser 顯示 NVIDIA Web Viewer 3D demo scene，可看到球、方塊、圓錐畫面。

## 正確啟動方式

### Server

官方基準流程：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\repo.bat launch -- --no-window
```

選單中選：

```text
ezplus.bim_review_stream_streaming.kit
```

本 repo 便利指令：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

或直接跑 build 產物：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat --no-window
```

Server log 預期：

```text
Started primary stream server on signal port 49100 and stream port 47998
app ready
```

### Client

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
npm run dev -- --host 127.0.0.1
```

開啟：

```text
http://127.0.0.1:5173/
```

使用預設：

```text
UI for default streaming USD Viewer app
```

按 `Next` 後，server log 應出現：

```text
Client connected to WebRTC server
```

詳細日常測試 checklist 請看：

```text
C:\Repos\active\iot\AI-BIM-governance\連線測試.md
```

## Root Cause

### 1. Windowed server 的實際串流高度會漂移

曾觀察到 server / client 協商或實際輸出高度出現：

```text
1920x1080
1920x1062
1920x1009
1920x1008
```

windowed Kit server 的內容區高度會受 Windows working area、工作列、DPI、視窗 chrome、focus 狀態影響。這導致 `.kit` 裡設定 `1920x1080`，但實際 stream content area 不一定是 `1920x1080`。

### 2. Client 寫死解析度會導致 mismatch

`web-viewer-sample/src/AppStream.tsx` local mode 曾經寫死：

```ts
width: 1920,
height: 1080,
fps: 60,
```

當 server 實際送出 `1920x1062` 或其他高度時，server 端會出現：

```text
Cannot stream video frame with resolution `1920x1062` that differs from that of 1920x1080 established when the client connected to the stream.
```

把 client 改成 `1062` 或 `1009` 只能修當下環境，不能作為永久解。

### 3. 奇數高度會放大 1-pixel mismatch

曾觀察到：

```text
Processing static resize of video stream with expected extents 1920x1079 that are invalid so they have been adjusted to 1920x1078
```

stream SDK / encoder 對高度有偶數限制。若實際高度落在 `1009`，就可能形成 `1009` vs `1008` 的 1-pixel mismatch，最後導致 frame grab / no video packet 問題。

## 正式解法

使用 headless streaming：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

原因：

- NVIDIA kit-app-template streaming 文件建議使用 `--no-window`
- headless 模式不經過 OS window manager 的可用工作區計算
- 避免視窗高度、工作列、DPI、window chrome 影響 stream content area
- 從架構上消除 windowed content area 漂移

不應再採用：

- `--/app/window/height=1079 --/app/window/width=1920`
- client 寫死 `height: 1062`
- client 寫死 `height: 1009`
- client 寫死 `height: 1008`

這些都是排查期間 workaround，不是產品解法。

## Client 修正原則

Client 應接受 server / WebRTC handshake 的實際解析度，不要把某次實測高度當常數。

建議方向：

1. WebRTC handshake 後讀 server 回傳的 `streamInfo.width/height`
2. 用實際值更新 video / internal stream state
3. 若要 resize，透過 `livestream.allowResize` 重新協商
4. 視需要評估 `dynamicResize`

## 搬移路徑後排查

原路徑：

```text
C:\Repos\active\iot\bim-streaming-server
```

新路徑：

```text
C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
```

搬移後不能 work 時，照以下順序查：

### 1. 搜尋舊絕對路徑

```powershell
rg -n --hidden --glob '!**/.git/**' --glob '!**/extscache/**' "C:\\Repos\\active\\iot\\bim-streaming-server|C:/Repos/active/iot/bim-streaming-server" .
```

本次驗證未找到 source 或目前 generated config 仍引用舊路徑。

### 2. 重新 build

```powershell
.\repo.bat build -x
```

成功條件：

```text
BUILD (RELEASE) SUCCEEDED
```

本次實測：

```text
BUILD (RELEASE) SUCCEEDED (Took 21.68 seconds)
```

### 3. 用互動桌面 session 啟動

Omniverse streaming 需要 GPU / D3D12 / NVML 正常初始化。若從 sandbox、service、非互動 task 或權限受限 runner 啟動，可能看到：

```text
OSError: [WinError 10106] 無法載入或初始化所要求的服務提供者。
Failed to initialize NVML: Unknown Error
D3D12CreateDevice failed
Failed to create any GPU devices
```

這類錯誤代表啟動 session 不可靠，不等於 repo 搬移後壞掉。

### 4. 確認 client 指向正確 server

`web-viewer-sample/stream.config.json` local mode 應指向實際 server：

```json
{
  "source": "local",
  "local": {
    "server": "127.0.0.1",
    "signalingPort": 49100,
    "mediaPort": null
  }
}
```

同機測試用 `127.0.0.1`。跨機測試時必須改成 server 主機 IP，不能維持 `127.0.0.1`。

## 不乾淨關閉現象

若 browser client 還在或仍嘗試 signaling 時直接關 server，Kit log 可能出現：

```text
Failed to setup the streaming session because: StreamSdkException 800b0000 [NVST_R_GENERIC_ERROR] Got stop event while waiting for client connection.
```

若 server 還活著，可能持續看到：

```text
Processing 13 signaling headers
Got stop event while waiting for client connection
```

判斷：

- 這代表 WebRTC session setup 被 shutdown / stop event 打斷
- 它是 session 狀態不乾淨的證據
- 不一定代表 process 或 port 沒釋放
- 但會讓後續排查 log 變髒

本輪曾確認到一個殘留案例：

```text
kit.exe PID 15576
Path: C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe
```

使用者在 server terminal 回答：

```text
Terminate batch job (Y/N)? Y
```

再次檢查：

```powershell
Get-Process -Id 15576 -ErrorAction SilentlyContinue
```

沒有輸出，表示該次殘留 process 已結束。

## 正確關閉順序

建議順序：

1. 關 browser viewer tab
2. 停 client Vite：`Ctrl+C`
3. 停 server：`Ctrl+C`
4. 若出現 `Terminate batch job (Y/N)?`，輸入 `Y`
5. 確認 port / process 釋放

檢查：

```powershell
Get-Process kit -ErrorAction SilentlyContinue
netstat -ano | Select-String ':49100|:47998|:5173'
```

若 server terminal 已關閉但 `kit.exe` 還在，先確認 PID path：

```powershell
Get-Process kit -ErrorAction SilentlyContinue | Select-Object Id,Path,StartTime
```

必要時精準停止：

```powershell
Stop-Process -Id <PID>
```

仍不退出才使用：

```powershell
Stop-Process -Id <PID> -Force
```

不要直接：

```powershell
Stop-Process -Name kit -Force
```

避免誤殺其他 Omniverse / Kit app。

## 常見故障對照

| 現象 | 判斷 | 處理 |
| --- | --- | --- |
| `FrameGrabFailed` | 多半是解析度協商不一致的外顯結果 | 用 `--no-window`，不要寫死高度 |
| `NoVideoPacketsReceivedEver` | client 沒收到有效 video packet | 查 server 是否有 resolution mismatch |
| `Cannot stream video frame with resolution X that differs from Y` | server/client 協商高度不同 | 移除硬編碼高度，改 headless |
| `Got stop event while waiting for client connection` | client/session 還在 setup 時 server 被停止或 session 被打斷 | 先關 client，再重啟 server/client |
| `Device lost` | 可能是 mismatch 後連帶 renderer 異常 | 先查前面是否已有 resolution mismatch |
| `Failed to start the primary stream server` / `NVST_R_INTERNAL_ERROR` | 可能是 Windows GPU scheduling 或 session 問題 | 檢查 HwSchMode、互動桌面 session |

## Windows GPU Scheduling 前置條件

若 `--no-window` 啟動時重現：

```text
Failed to start the primary stream server
NVST_R_INTERNAL_ERROR
Device lost
```

先檢查 Windows `Hardware-accelerated GPU scheduling`。

已知設定：

```text
HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\HwSchMode = 1
```

`1` 代表 Off。修改後需重開機。

## 架構角色

```text
bim-streaming-server
  = Kit 原生 viewer + WebRTC stream server
  -> 對外提供 49100 等 streaming 端點

web-viewer-sample
  = browser viewer client sample
  -> 透過 5173 提供前端頁面
  -> 頁面載入後再去連 49100
```

重點：

- `5173` 是 Vite dev server，不是 WebRTC stream server
- `49100` 是 WebRTC signaling 入口
- `47998` 是 stream media port
- 跨機觀看時，`web-viewer-sample` 頁面可打開還不夠，`stream.config.json` 也要指向 server 主機 IP

## Codex / 自動化測試注意事項

以下屬於 Codex / sandbox / Windows automation 限制，不應誤判為 server repo 壞掉：

- Codex shell 內直接 `Start-Process` Kit 或 npm，曾失敗於「目錄名稱無效」或「找不到指定的模組」
- 當前 shell 沒有 `ScheduledTasks` PowerShell cmdlet，需改用 `schtasks.exe`
- `schtasks.exe /TR` 直接包 `powershell -Command "Set-Location ...; npm run dev"` 時，引號容易被 Task Scheduler 解析壞
- Chrome `--remote-debugging-port` 在既有 Chrome instance/profile 下可能不產生 `DevToolsActivePort`
- Codex shell 內 `curl` / `netstat` 對 localhost port 的結果曾與桌面實際狀態不一致

自動化驗證應以以下證據為準：

- Kit log：`Started primary stream server...`
- Kit log：`Client connected to WebRTC server`
- Vite log：`Local: http://127.0.0.1:5173/`
- browser 實際畫面：NVIDIA Web Viewer 3D scene

## 官方參考

- NVIDIA-Omniverse/kit-app-template：`repo.bat` / `repo.sh` 是 repo tool 入口
  - https://github.com/NVIDIA-Omniverse/kit-app-template
- kit-app-template README：build 使用 `.\repo.bat build`，launch 使用 `.\repo.bat launch`
  - https://github.com/NVIDIA-Omniverse/kit-app-template
- Application Streaming：build 後用 `.\repo.bat launch -- --no-window` 啟動 streaming app，另一個 terminal 啟動 `web-viewer-sample`
  - https://docs.omniverse.nvidia.com/kit/docs/kit-app-template/latest/docs/streaming.html
- kit-app-template Tooling Guide：`--` 後面的參數會直接傳給 Kit executable
  - https://github.com/NVIDIA-Omniverse/kit-app-template/blob/main/readme-assets/additional-docs/kit_app_template_tooling_guide.md
