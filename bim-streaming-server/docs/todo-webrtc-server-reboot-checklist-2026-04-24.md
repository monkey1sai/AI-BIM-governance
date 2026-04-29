# WebRTC Stream Server 重開機前後待辦清單

日期：2026-04-24

後續結果：

- 已完成的正式排查與修復紀錄請見：
  - `docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md`

## 目的

在不修改 `server` repo source code 或 repo 設定的前提下，記錄目前 `ezplus.bim_review_stream_streaming.kit` 的盤查結果，以及重開機後的驗證步驟。

## 目前盤查結論

1. `web-viewer-sample` 的 client 連線方式本身沒有先看到設定錯誤。
2. `server` 端真正的問題發生在 WebRTC stream server 啟動階段，而不是瀏覽器 UI 選項階段。
3. 最新觀察到的關鍵 log：
   - `NVST_R_INTERNAL_ERROR`
   - `Failed to start the primary stream server`
   - `NVST_R_INVALID_STATE`
   - `Device lost`
4. `source/apps/ezplus.bim_review_stream_streaming.kit` 與 `source/apps/ezplus.bim_review_stream.kit` 沒有看出明顯偏離模板、足以單獨解釋這次失敗的自訂設定。
5. Windows registry 觀察到：
   - `HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\\HwSchMode = 2`
   - 這代表 `Hardware-accelerated GPU scheduling` 已啟用。
6. NVIDIA 官方文件指出：Windows 上啟用 `Hardware-accelerated GPU scheduling` 時，Omniverse WebRTC Streaming 可能 freeze。

## 重開機前待辦

- [ ] 關閉 Windows `Hardware-accelerated GPU scheduling`
- [ ] 關閉所有 Omniverse / Kit / web-viewer-sample / Chrome 測試視窗
- [ ] 確認不需要保留任何暫存執行狀態後再重開機

## 重開機後 server 驗證

- [ ] 在 repo 根目錄重新執行：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

- [ ] 觀察 terminal 或最新 log 是否仍出現以下錯誤：
  - `Failed to start the primary stream server`
  - `NVST_R_INTERNAL_ERROR`
  - `NVST_R_INVALID_STATE`
  - `Device lost`
- [ ] 確認 `49100` 真的由新的 `kit.exe` 持有
- [ ] 確認 `kit.exe` 不會在啟動後數十秒內自行退出

## 重開機後 client 驗證

- [ ] 進入 `C:\Repos\active\iot\web-viewer-sample`
- [ ] 確認 `stream.config.json` 維持 local 連線設定：

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

- [ ] 執行：

```powershell
npm run dev
```

- [ ] 瀏覽器開啟：

```text
http://localhost:5173
```

- [ ] 在 UI 選 `UI for any streaming app`
- [ ] 按 `Next`
- [ ] 驗證是否成功建立 WebRTC 連線並看到串流畫面

## 若仍失敗，下一輪排查方向

- [ ] 比較 `--no-window` 與有視窗模式是否只有 headless 會失敗
- [ ] 確認 Windows 防火牆是否影響 `49100`
- [ ] 檢查 GPU / driver / DX12 與 Omniverse WebRTC 相容性
- [ ] 再次比對最新 crash log 與 `kit_*.log`

## 參考位置

- repo streaming layer：`source/apps/ezplus.bim_review_stream_streaming.kit`
- base app：`source/apps/ezplus.bim_review_stream.kit`
- 最新觀察 log 目錄：`C:\Users\IOT\.nvidia-omniverse\logs\Kit\BIM Review Stream Streaming\0.1`
- client repo：`C:\Repos\active\iot\web-viewer-sample`
