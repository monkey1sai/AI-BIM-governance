# BIM Streaming Server

<p align="center">
  <img src="readme-assets/kit_app_template_banner.png" width="100%" />
</p>

## 專案說明

這個 repo 以 NVIDIA `kit-app-template` 為基底，整理出目前用於 `BIM Review Stream` 的 Omniverse Kit 應用與串流設定。它同時包含：

- `Kit` 原生應用本體
- `WebRTC` 串流用的 streaming app layer
- `source/apps` 與 `source/extensions` 內的專案原始碼
- `repo.bat` / `repo.sh` 所使用的 build、launch、package tooling

目前主要 app：

- `source/apps/ezplus.bim_review_stream.kit`
- `source/apps/ezplus.bim_review_stream_streaming.kit`

目前主要 extension：

- `source/extensions/ezplus.bim_review_stream.setup`
- `source/extensions/ezplus.bim_review_stream.messaging`

## 重要定位

這個 repo 產生的是：

- `Kit viewer`：本機 Omniverse / Kit 原生視窗
- `WebRTC stream server`：把 viewport 畫面串流出去

它不是內建 browser viewer。若要用瀏覽器觀看，通常會搭配另一個 web client，例如 `web-viewer-sample`。

## 環境需求

- 作業系統：Windows 10/11 或 Linux（Ubuntu 22.04+）
- GPU：NVIDIA RTX 顯示卡
- Driver：
  - Linux `>= 550.54.15`
  - Windows `>= 551.78`
- 網路：首次抓取 Kit SDK、extension 與工具時需要可連外

### 建議安裝

- [Git](https://git-scm.com/downloads)
- [Git LFS](https://git-lfs.com/)
- Windows 若有 C++ 編譯需求：
  - Visual Studio 2019/2022
  - Desktop development with C++
  - Windows SDK

## 目錄說明

| 路徑 | 用途 |
| --- | --- |
| `source/apps/` | App `.kit` 定義 |
| `source/extensions/` | 專案 extension 原始碼 |
| `docs/` | 專案文件與 issue wiki |
| `templates/` | kit-app-template 內建模板 |
| `tools/` | repo tool 與相依設定 |
| `premake5.lua` | 定義要 build 的 app |
| `repo.toml` | repo tool 主設定 |
| `repo.bat` / `repo.sh` | Windows / Linux 入口 |

### 不建議納入版控的本機產物

以下目錄或檔案預設應視為本機產物：

- `_build/`
- `_compiler/`
- `_repo/`
- `_debug/`
- `.claude/`
- `.playwright-mcp/`
- `*.etl`

## 快速開始

### 1. Clone

```powershell
git clone https://github.com/monkey1sai/bim-streaming-server.git
cd bim-streaming-server
```

### 2. 建立或更新 source

如果你要從模板建立新的 app / extension，可用：

```powershell
.\repo.bat template new
```

若只是使用目前 repo 已存在的 `source/apps` 與 `source/extensions`，可直接進行 build。

### 3. Build

```powershell
.\repo.bat build
```

若要強制重建：

```powershell
.\repo.bat build -x
```

成功時應看到類似：

```text
BUILD (RELEASE) SUCCEEDED (Took XX.XX seconds)
```

### 4. 啟動 app / streaming server

NVIDIA `kit-app-template` 官方流程是先 build，再用 `repo.bat launch` 啟動；若要把參數傳給 Kit executable，放在 `--` 後面。Streaming app 建議用 `--no-window`，避免本機視窗大小與瀏覽器串流互相干擾。

官方基準流程：

```powershell
.\repo.bat launch -- --no-window
```

當 launch 選單出現時，選：

```text
ezplus.bim_review_stream_streaming.kit
```

本專案也可直接指定目前 streaming app：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

若已 build 完成，也可直接執行 build 產物：

```powershell
.\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat --no-window
```

這樣做：

- 不會出現「windowed 模式下實際內容區漂到 `1062` / `1009`」造成 `FrameGrabFailed` 的根因
- Client 端應從 WebRTC `streamInfo` 動態取得協商解析度，**不要寫死 `width` / `height`**
- 2026-04-27 在本 repo 新路徑 `C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server` 重新 build 後，已實測 `video.readyState=4`、`videoWidth=1920`、`videoHeight=1080`、`currentTime` 持續推進

如果 `--no-window` 重現 `Failed to start the primary stream server`，先檢查 Windows `Hardware-accelerated GPU scheduling` 是否關閉（NVIDIA 文件已知此設定下 Omniverse WebRTC 會 freeze），不要回頭去 windowed + 寫死像素。

### 5. 對應 client 啟動步驟

server 啟動後，搭配 `web-viewer-sample` 做端到端測試：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
npm run dev
```

`stream.config.json` 維持預設 `local` / `127.0.0.1` / `49100`：

```json
{
  "source": "local",
  "local": { "server": "127.0.0.1", "signalingPort": 49100, "mediaPort": null }
}
```

開啟 `http://localhost:5173`，維持「UI for default streaming USD Viewer app」並按 Next。

預期：`video.readyState=4`、`videoWidth>0`、`videoHeight>0`、`currentTime` 持續推進、Console 無 `FrameGrabFailed` / `NoVideoPacketsReceivedEver`。本機 2026-04-27 重新驗證值為 `1920x1080`。

> client 端**不要**寫死 `width` / `height`；`omni.kit.livestream.webrtc` 會透過 `streamInfo` 自動完成解析度協商。

詳細排查脈絡與實測量測值見 [docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md](./docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md)。

更多 build / launch / source 產生步驟請見：

- [BUILD.md](./BUILD.md)

## Streaming 說明

`bim-streaming-server` 的角色是：

- 本機開啟 `Kit` 原生 viewer
- 將 viewer 畫面經由 `WebRTC` 對外串流

它常見會搭配另一個 web client，例如 `web-viewer-sample`：

```text
bim-streaming-server
  = Kit viewer + WebRTC stream server

web-viewer-sample
  = browser viewer client sample
```

因此：

- `49100` 是實際的 WebRTC signaling / streaming 入口
- `5173` 若存在，通常只是 sample web viewer 的 dev server

## 重要文件

- [BUILD.md](./BUILD.md)
- [docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md](./docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md)
- [docs/todo-webrtc-server-reboot-checklist-2026-04-24.md](./docs/todo-webrtc-server-reboot-checklist-2026-04-24.md)

## 官方文件

- [NVIDIA-Omniverse/kit-app-template](https://github.com/NVIDIA-Omniverse/kit-app-template)
- [Application Streaming](https://docs.omniverse.nvidia.com/kit/docs/kit-app-template/latest/docs/streaming.html)
- [kit-app-template Tooling Guide](https://github.com/NVIDIA-Omniverse/kit-app-template/blob/main/readme-assets/additional-docs/kit_app_template_tooling_guide.md)
- [Kit Kernel Command Line Options](https://docs.omniverse.nvidia.com/kit/docs/carbonite/latest/docs/Kernel/CommandLineOptions.html)
- [Kit Manual: Configuration](https://docs.omniverse.nvidia.com/kit/docs/kit-manual/105.1/guide/configuring.html)

## 授權與安全

- 授權條款摘要：見 [PRODUCT_TERMS_OMNIVERSE](./PRODUCT_TERMS_OMNIVERSE)
- 安全通報方式：見 [SECURITY.md](./SECURITY.md)

## 備註

這個 repo 仍以 NVIDIA `kit-app-template` 生態為基底。若未來需要升級 Kit SDK 或調整 launch / package 流程，應優先以 NVIDIA 官方文件與當前 `repo.toml` 為準。
