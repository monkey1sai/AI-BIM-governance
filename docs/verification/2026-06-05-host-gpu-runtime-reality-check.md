# Host GPU / Kit / WebRTC runtime 實況查證（2026-06-05）

> 起因：使用者指正「此環境一直有 GPU 繪圖驅動」，反駁我先前在報告與 `docs/frontend-redesign-implementation-notes.md` §11 寫的「此環境無 GPU 繪圖驅動 / viewer Runtime=no / GPU-pending」。本檔記錄查證結果與更正。**結論：使用者正確，我先前宣稱不精確/錯誤。**

## 查證方法

主對話 inline 直查 + 4-agent 並行 workflow（host GPU / Kit runtime / WebRTC 真實性 / 自我宣稱稽核）交叉驗證。HTTP 用 node global fetch（curl 在此環境被 deny）。

## 查證到的事實

### host GPU + 繪圖驅動 — 有

- `nvidia-smi`：`NVIDIA GeForce RTX 4060 Ti`，`driver_version=580.97`，CUDA 13.0，`memory.total=8188 MiB`。
- Driver-Model=**WDDM**（繪圖顯示驅動，非 compute-only TCC），`Disp.A=On`（顯示器掛載），NVENC 編碼單元使用率非零（~16%）。
- `Get-CimInstance Win32_VideoController`：同卡，DriverVersion=32.0.15.8097（=580.97 inf 版本），Status=OK。

### host-native Kit 串流 plane — 正在跑

- `kit.exe` PID 40232 = `C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe`，cmdline `ezplus.bim_review_stream_streaming.kit --no-window`，帶 `omni.kit.livestream.app/primaryStream/streamType=webrtc signalPort=49100 streamPort=47998 publicIp=192.168.10.105` + 5 組 spectatorStream（49110/48008 … 49150/48048）。
- listen：TCP 49100 + 49110–49150（signaling/spectator）、UDP 47998（media）皆 OwningProcess=40232；`net.connect` 即時測 49100/49110/49101 皆接受連線（非 netstat 殘影）。
- Kit log 證實：`omni.kit.livestream.webrtc-10.1.2` 載入；`[omni.rtx] Active GPU: NVIDIA GeForce RTX 4060 Ti | Driver 580.97 | Graphics API: D3D12`（真實硬體，非軟體 fallback）。
- conversion authority `:49101`（python `host_native_conversion_service`，PID 2868）`/health`=200。

### 真實 IFC session 綁定 — ready

- coordinator `GET /api/runtime/status` + `/api/review-sessions/review_session_cff0b3fc5faf/stream-config`：model.status=ready，conversion_job_id=`stream_conv_20260605093932_f79903a0`，6 筆 kit bindings（primary `kit_local_001` + 5 spectator），來源 IFC=`許良宇圖書館建築_2026.ifc`（543 entities，coverage pass，無 mock/fake_mapping 旗標）。

## 誠實邊界（未做的部分）

- **未實際打 WebRTC handshake 截取 live 解碼影格**。以上證明「能力可達 + 串流 plane 在線」，**非**「我親眼看到像素」。真正的 on-screen frame 驗證需一次瀏覽器 WebRTC attach（必要時配 `start-streaming-server.ps1 -ResetUser`，healthy=readyState=4 + 影像尺寸）。
- streaming-server 端 `source_client_id` 後端強制（CH-C streaming 側）仍是**實作缺口**——但根因是「程式碼未寫 + 未做 host Kit E2E」，**不是**環境缺 GPU。

## 更正

| 先前（錯/含糊） | 更正（精確） |
|---|---|
| 「此環境無 GPU 繪圖驅動」 | host 有 RTX 4060 Ti + driver 580.97（WDDM），繪圖能力完整 |
| 「viewer Runtime=no（環境降級）」 | 該次 E2E **刻意採 harness 佔位**（CI 可決定性）；Runtime=no 是該 run 快照，非環境上限 |
| 「CH-C GPU-pending（需 host GPU runtime）」 | host GPU/Kit runtime 在線；待補的是 streaming-side 程式碼 + host Kit WebRTC DataChannel E2E |

## 真正受限處（與既有 memory / doc 一致）

`docs/verification/2026-05-20-wsl-toolkit-graphics-blocker.md`：`host_windows_driver=580.97`、`cuda_passthrough=pass`，blocked 僅 `graphics_capability_inside_container`（Docker/WSL2 Linux 容器缺 libGLX_nvidia/Vulkan ICD）。**牆在容器 plane，不在 host**；故 Kit 渲染走 host-native。memory `kit-gpu-render-needs-windows-native.md` 本就精確記錄此事——我的錯在沒精確套用它。
