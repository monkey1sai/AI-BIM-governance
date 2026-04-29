# Build / Source / Launch 指南

本文件整理這個 repo 目前最常用的幾組指令：

- 如何從 template 產生 `source`
- 如何 build
- 如何啟動目前的 streaming server
- 哪些額外參數在官方文件中有明確說明，可直接用在 launch 流程

## 1. `source` 是怎麼來的

這個 repo 原本基於 NVIDIA `kit-app-template`。一般情況下，`source/apps` 與 `source/extensions` 可以由 template 工具建立，再進一步客製化。

### 1.1 建立新的 app / extension source

Windows：

```powershell
.\repo.bat template new
```

Linux：

```bash
./repo.sh template new
```

用途：

- 從官方模板產生新的 `.kit` app
- 或產生新的 extension 骨架
- 產生的內容會落在 `source/apps` 或 `source/extensions`

### 1.2 修改既有 template 產物

若需要替既有 app 增加 layer 或調整 template 設定，可使用：

Windows：

```powershell
.\repo.bat template modify
```

Linux：

```bash
./repo.sh template modify
```

用途：

- 對既有 app 加上 streaming layer
- 調整 template 相關設定，而不是手動重建整份 source

### 1.3 這個 repo 目前已經有可直接使用的 source

目前主要 source 已存在：

- `source/apps/ezplus.bim_review_stream.kit`
- `source/apps/ezplus.bim_review_stream_streaming.kit`
- `source/extensions/ezplus.bim_review_stream.setup`
- `source/extensions/ezplus.bim_review_stream.messaging`

所以若你只是要 build / launch 現有 server，通常不需要再重新產生 source。

## 2. Build

NVIDIA `kit-app-template` 官方 repo 的基本流程是：

```powershell
.\repo.bat build
```

成功時會看到：

```text
BUILD (RELEASE) SUCCEEDED (Took XX.XX seconds)
```

### 2.1 一般 build

Windows：

```powershell
.\repo.bat build
```

Linux：

```bash
./repo.sh build
```

用途：

- 建立 `_build/...` 下的 app 啟動器、Kit 執行檔與相依內容
- build 完成後再用 `repo.bat launch` 或 `_build/.../*.kit.bat` 啟動

### 2.2 強制重建

Windows：

```powershell
.\repo.bat build -x
```

Linux：

```bash
./repo.sh build -x
```

用途：

- 清理後重建
- 適合遇到快取殘留、pip prebundle 沒更新、或你想確認不是舊產物影響時使用
- 搬移 repo 路徑後，建議先跑一次，避免沿用舊路徑產物

## 3. 啟動目前的 server

### 3.1 官方基準流程：互動式 launch + `--no-window`

NVIDIA streaming 文件建議：build 後用 `launch` 啟動 streaming app，並把 `--no-window` 傳給 Kit。Windows 官方形式如下：

```powershell
.\repo.bat launch -- --no-window
```

接著在互動選單選：

```text
ezplus.bim_review_stream_streaming.kit
```

用途：

- 對齊官方 `kit-app-template` / Application Streaming 的使用方式
- `--` 後面的 `--no-window` 會原樣傳給 Kit executable
- headless streaming path 避免 OS window chrome、工作列、DPI 或 working area 影響 WebRTC 解析度

### 3.2 一般互動式啟動

Windows：

```powershell
.\repo.bat launch
```

Linux：

```bash
./repo.sh launch
```

用途：

- 由 repo tool 列出可啟動的 app，互動選擇

### 3.3 專案便利指令：直接指定目前的 streaming app

Windows：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit
```

Linux：

```bash
./repo.sh launch -n ezplus.bim_review_stream_streaming.kit
```

用途：

- 直接啟動目前的 WebRTC streaming server app
- 不經選單

### 3.4 目前建議的 server 啟動指令（headless）

若你已確定要啟動 `ezplus.bim_review_stream_streaming.kit`，可用本 repo 支援的 `-n` 直接指定：

Windows：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

用途：

- 指定啟動 `ezplus.bim_review_stream_streaming.kit`
- 走 headless render path，避免 windowed 模式下內容區高度漂移
- **不要**用 `--/app/window/height=...` 寫死像素來繞 mismatch；那只是 fallback，且高度本來就會隨 Windows working area 漂移

對應 client 端：應從 WebRTC `streamInfo` 動態取協商解析度，不再硬編碼 `1080` / `1062` / `1009` / `1008`。

2026-04-27 在搬移後的新路徑 `C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server` 重新 build + headless 啟動，已實測：

- server log：`Started primary stream server on signal port 49100 and stream port 47998`
- server log：`Client connected to WebRTC server`
- browser：`video.readyState=4`
- browser：`videoWidth=1920`
- browser：`videoHeight=1080`
- browser：`currentTime` 持續推進

若 `--no-window` 重現 `Failed to start the primary stream server`：先檢查 Windows `Hardware-accelerated GPU scheduling` 是否關閉（`HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\HwSchMode`），這是 NVIDIA 文件已知會讓 Omniverse WebRTC freeze 的設定。

詳細脈絡：[./docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md](./docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md)

### 3.5 直接執行 build 後的 app 啟動批次檔

Windows：

```powershell
.\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat --no-window
```

用途：

- 略過 `repo launch`
- 直接啟動 build 產物
- 適合已經確定要跑哪一個 app 時使用
- 這個方式不是官方 `repo launch` 主流程，但適合本機 smoke test 或排除 repo launch 互動選單因素

## 4. 常用額外參數

以下參數以 NVIDIA 官方 tooling guide / Kit command line 文件為基準；本 repo 的 `-n ezplus...` 是為了省略互動選單的專案便利用法。

### 4.1 指定 app：`-n`（本 repo 便利用法）

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit
```

用途：

- 直接指定要啟動哪個 `.kit`
- 適合 repo 內有多個 app 時使用

### 4.2 傳入 Kit setting override：`--`（官方用法）

`repo launch` 後面加 `--`，可以把後面的參數原封不動傳給 Kit。

例如：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --/app/printConfig=true
```

用途：

- 覆寫 `.kit` 裡的 setting
- 常用於 print config、臨時除錯
- 注意：streaming layer **不建議**用 `--/app/window/width=...` / `--/app/window/height=...` 寫死視窗像素來繞 WebRTC mismatch；正解請見 §3.3 與 [issue doc](./docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md)

### 4.3 顯示完整設定：`--/app/printConfig=true`

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --/app/printConfig=true
```

用途：

- 在啟動時把合併後的設定印出
- 適合除錯某個 setting 最終值

### 4.4 啟用 developer bundle：`-d`

```powershell
.\repo.bat launch -d
```

用途：

- 若 app 本身沒把 developer bundle 放進 `.kit`
- 可在 launch 時臨時加上

### 4.5 直接從 package 啟動：`--package`

```powershell
.\repo.bat launch --package <path-to-fat-package>
```

用途：

- 直接啟動 fat package
- 不適用 thin package

### 4.6 顯示較詳細 log：`--info` / `--verbose`

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --info
```

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --verbose
```

用途：

- `--info`：輸出較詳細資訊
- `--verbose`：輸出更細的除錯資訊

### 4.7 執行腳本後退出：`--exec`

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --exec "my_script.py"
```

用途：

- 啟動後執行指定 Python script
- script 完成後 Kit 會退出

### 4.8 使用 portable mode：`--portable` / `--portable-root`

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --portable
```

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --portable-root C:\temp\kit-portable
```

用途：

- 把 log、cache、user config 改到指定位置
- 避免污染目前使用者的全域 Kit 設定

### 4.9 清理使用者設定或快取

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --reset-user
```

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --clear-data --clear-cache
```

用途：

- `--reset-user`：不載入持久化 user config
- `--clear-data`：清掉 `${data}`
- `--clear-cache`：清掉 `${cache}`

### 4.10 列出 extension：`--list-exts`

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --list-exts
```

用途：

- 列出目前可見的本機 extensions
- 適合除錯 extension search path 或版本問題

## 5. 目前這個專案的實務建議

### 5.1 平常開發

```powershell
.\repo.bat build
.\repo.bat launch -- --no-window
```

啟動選單選：

```text
ezplus.bim_review_stream_streaming.kit
```

若要略過選單：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

### 5.2 要查設定或參數衝突

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window --/app/printConfig=true --info
```

### 5.3 要排除使用者設定與快取影響、避免 trace / log 污染 repo

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window --portable-root C:\temp\kit-portable --reset-user --clear-cache
```

`--portable-root` 的長期建議：把 `*.etl` (NvStreamer trace)、log、user config、cache 都集中到 portable root，避免污染 repo 根目錄。

## 6. 正確關閉 server / client 並釋放資源

Omniverse Kit streaming server 會持有 GPU、D3D12、WebRTC signaling port（通常是 `49100`）與 media port（常見是 `47998`）。關閉時優先走正常 shutdown，避免留下殘留 `kit.exe`、port 被占用、GPU / NVENC resource 未釋放，或下一次 launch 出現 `Failed to start the primary stream server`。

### 6.1 正常關閉順序

若同時跑 server 與 `web-viewer-sample`，建議順序如下：

1. 先關 browser viewer 分頁，或在頁面中結束 stream。
2. 在 `web-viewer-sample` 的 `npm run dev` terminal 按 `Ctrl+C`，停止 Vite dev server。
3. 在 server 的 `repo.bat launch ...` terminal 按 `Ctrl+C`，等待 Kit 印出 shutdown / cleanup log 後退出。
4. 再確認 `kit.exe` 已消失、`49100` 不再被占用。

### 6.2 官方 launch 流程的關閉方式

若 server 是用官方基準流程啟動：

```powershell
.\repo.bat launch -- --no-window
```

或本專案便利指令：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

關閉方式是在同一個 terminal 按：

```text
Ctrl+C
```

不要直接關閉整個 terminal 視窗作為第一選擇；直接關閉視窗較容易讓子行程或 log flush 狀態不清楚。

### 6.3 直接執行 build 產物時的關閉方式

若 server 是用 build 產物直接啟動：

```powershell
.\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat --no-window
```

同樣在該 terminal 按：

```text
Ctrl+C
```

等待 `kit.exe` 結束後，再啟動下一輪測試。

### 6.4 確認 port 是否已釋放

Windows 可用：

```powershell
netstat -ano | Select-String ':49100|:47998'
```

若沒有輸出，代表常用 WebRTC signaling / media port 已釋放。若仍看到 `LISTENING` 或 `ESTABLISHED`，記下最後一欄 PID。

也可以查看目前 `kit.exe`：

```powershell
Get-Process kit -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path,StartTime
```

### 6.5 只在必要時精準停止殘留 `kit.exe`

若 `Ctrl+C` 後 `kit.exe` 仍存在，或 `49100` 還被舊 server 占用，先確認該 PID 的路徑確實是本 repo 的 build 產物：

```powershell
Get-Process -Id <PID> | Select-Object Id,ProcessName,Path,StartTime
```

確認 `Path` 類似：

```text
C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe
```

再精準停止該 PID：

```powershell
Stop-Process -Id <PID>
```

若一般停止無效，再使用：

```powershell
Stop-Process -Id <PID> -Force
```

不要直接用 `Stop-Process -Name kit -Force` 當預設做法，因為同一台機器可能還有其他 Omniverse / Kit app 正在跑。

### 6.6 清掉 client dev server

`web-viewer-sample` 的 Vite dev server 正常關閉方式也是在 terminal 按：

```text
Ctrl+C
```

若需要確認 `5173` 是否釋放：

```powershell
netstat -ano | Select-String ':5173'
```

若仍被占用，先用 PID 確認是該次 `npm run dev` 的 `node.exe`，再停止該 PID：

```powershell
Get-Process -Id <PID> | Select-Object Id,ProcessName,Path,StartTime
Stop-Process -Id <PID>
```

### 6.7 下一次啟動前的快速檢查

重新啟動 streaming server 前，建議確認：

```powershell
netstat -ano | Select-String ':49100|:47998'
Get-Process kit -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path,StartTime
```

預期：

- `49100` 沒有被舊 `kit.exe` 占用
- 沒有殘留本 repo `_build\...\kit.exe`
- 若有殘留，先依 §6.5 精準停止後再 launch

## 7. 官方文件來源

以下是本文件整理時使用的 NVIDIA 官方文件：

- NVIDIA-Omniverse/kit-app-template
  https://github.com/NVIDIA-Omniverse/kit-app-template
- Application Streaming
  https://docs.omniverse.nvidia.com/kit/docs/kit-app-template/latest/docs/streaming.html
- kit-app-template Tooling Guide
  https://github.com/NVIDIA-Omniverse/kit-app-template/blob/main/readme-assets/additional-docs/kit_app_template_tooling_guide.md
- Using Python Pip Packages
  https://docs.omniverse.nvidia.com/kit/docs/kit-app-template/latest/docs/using_python_pip_packages.html
- Package App
  https://docs.omniverse.nvidia.com/kit/docs/kit-app-template/latest/docs/packaging_app.html
- Kit Kernel Command Line Options
  https://docs.omniverse.nvidia.com/kit/docs/carbonite/latest/docs/Kernel/CommandLineOptions.html
- Kit Manual: Configuration
  https://docs.omniverse.nvidia.com/kit/docs/kit-manual/105.1/guide/configuring.html
- Kit CAE User Guide（`repo.bat launch -n ... -- ...` 用法示例）
  https://docs.omniverse.nvidia.com/guide-kit-cae/latest/getting-started.html
