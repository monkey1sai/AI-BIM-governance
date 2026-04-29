# 路線 A：官方 Kit IFC → USD + Kit Streaming Server 執行手冊

日期：2026-04-27  
狀態：Active（Route A runtime smoke 已通過）
適用 repo：`C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server`

## 結論

- 本 repo 的 streaming server **不直接載入 `.ifc`**：現有 `omni.usd.UsdContext.open_stage_async` 流程以 USD stage 為輸入，應載入 `.usd` / `.usda` / `.usdc` / `.usdz`。
- 目前採取官方 Kit 轉檔流程：**使用 NVIDIA CAD Converter / HOOPS Core 將 IFC 轉成 USD，再讓 Kit streaming server 載入 USD**。
- IFC → USD 轉檔由 `scripts/convert-ifc-to-usdc.ps1` 執行；它會把 `a.ifc` 對應成 `a.usdc`，並略過已是最新的輸出。
- 預設轉檔設定放在 `config/ifc-hoops-converter.json`；需要調整 tessellation、metadata、up-axis 時優先改這份設定或用 `-ConfigPath` 指向替代設定。
- 模型放置：**repo 內 `./bim-models/`**，模型檔不入版控，由 `.gitignore` 規則阻擋。
- Server 透過 `--/app/auto_load_usd=<usd 絕對路徑>` 啟動載入；client 端可透過既有 `openStageRequest` event 動態切換 stage。
- 轉檔使用獨立 helper app `source/apps/ezplus.bim_ifc_usd_converter.kit`，不把 CAD Converter 依賴混入 streaming runtime。

## 0. 2026-04-28 執行進度

目前狀態：**§10 protocol 完整跑完。IFC → USDC、Browser WebRTC、demo scene baseline、IFC USDC 動態載入、`openStageRequest` 切換、燈光 fallback patch 全部已驗證；2026-04-28 已由 web viewer 截圖與人工視覺互動確認 IFC 轉出的 USDC 可在 browser 中渲染與操作。**

### 2026-04-28 §10 protocol 執行結果（依步驟）

#### §10.1 process / port 釋放（重開機後乾淨）

- 重開機前：port 49100 被 phantom PID 36168 占用。`tasklist` / `wmic` 都查不到該 PID（kernel-level orphan socket）。Elevated PowerShell `Stop-Process -Id 36168` 也回 `Cannot find a process`。
- 解法：重開機。重開後 49100 / 47998 / 5173 全部釋放，`kit.exe` / `node.exe` 全部清空。
- 未來預防：streaming server shutdown 流程須確認 process exit 乾淨（plan 既有 `--no-window` 約束已足夠，但若再次出現 phantom socket，先重開機而非長時間追查）。

#### §10.2 web-viewer-sample baseline 還原

- `git restore -- src/AppStream.tsx` 完成，移除 codec / AV1 強制 query 的未提交 diff。
- 隨後為驗證 §10.5 加入新項目至 `usdAssets`：`{name: "BIM: 許良宇圖書館建築 2026", url: "C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/許良宇圖書館建築_2026.usdc"}`。此項是 stable feature（讓 picker 直接列 BIM USDC），不算臨時 debug，可保留或 commit。

#### §10.3 demo scene baseline（通過）

- Server: `Started primary stream server on signal port 49100 and stream port 47998` → `app ready`。
- 02:58:01 `Client connected to WebRTC server` 出現（這是過去卡住 session 從未出現的事件）。
- 02:58:04 client 送 `openStageRequest` 載入 `./samples/stage01.usd`，2 秒內 `stage has loaded`。
- 02:58:10 切換到 `./samples/stage02.usd` 也成功。
- 證據：`_testoutput\stream-baseline-20260428-105536-kit.out.log` 與 Omniverse `kit_20260428_105540.log`。

#### §10.4 firewall

- §10.3 通過後跳過深查（同機 loopback 不受 firewall 影響）。

#### §10.5 IFC USDC 動態載入（通過，採 plan 推薦的 `openStageRequest` 路徑）

- Server 啟動時不帶 `auto_load_usd`，等 client 連線後再從 picker 觸發。避開大型 USD first-frame 與 ICE 的競賽。
- 03:12:06 client 送 `openStageRequest` 載入 `bim-models/許良宇圖書館建築_2026.usdc`。
- 03:12:07 USDC `opened successfully in 0.26 seconds`。
- 03:12:09 `Sending message to client that stage has loaded`。
- 03:16:59 起 server log 持續出現 `Selection changed` / `getChildrenRequest` / `makePrimsPickable` 等互動事件，path 內含 `IFCSTAIR/Mesh_23`、`IFCCURTAINWALL/.../75x150mm.../Mesh`、`IFCBEAM_1/Default_3..5/Mesh`、`IFCWALL`、`IFCSLAB`、`IFCRAILING/Mesh_19/23`、`IFCFURNISHINGELEMENT`、`IFCBUILDINGELEMENTPROXY` — 跨 FL3 / R1FL / RFL 多樓層，證明 BIM 幾何完整轉出且 user 在瀏覽器端可見、可選。
- 2026-04-28 user 提供 `http://127.0.0.1:5173` web viewer 截圖：右側 USD Asset 已選中 `BIM: 許良宇圖書館建築 2026`，主視窗可見 IFC 轉出的 BIM 模型，並已人工確認可視覺互動。此證據補齊 Browser runtime smoke。

#### §10.5 衍生發現：IFC USDC 視覺暗沉問題與 fallback 燈光 patch

- 第一次載入 BIM 時 user 報「黑畫面 / 簡單輪廓」。
- 對照 log：sample1/2 載入後有 `Environment texture resolution is 4096 x 2048`（自帶 dome light），BIM USDC 沒這行 — 確認 IFC 規格本身不存燈光、HOOPS converter 也不會幫補。
- Patch：[stage_loading.py](../source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py) 在 `_evaluate_load_status` 通知 client `stage has loaded` 之前，呼叫 `_ensure_default_lighting(stage)`：
  - 偵測 stage 是否已含任何 `UsdLux.{DomeLight,DistantLight,Rect/Sphere/Disk/CylinderLight}`，有就不動（sample1/2 不會被覆寫）。
  - 沒有則在 stage 的 **session layer**（Usd.EditContext）下加 `/__BIMFallbackLights/Dome`（intensity 1500，白光）+ `/__BIMFallbackLights/Sun`（DistantLight intensity 3000，angle 0.53，rotateXYZ -45/30/0）。session layer 不會回寫到 `.usdc` 檔。
- 03:26:36 重啟後 BIM USDC 重新載入時 server log 出現 `LoadingManager: added fallback dome+sun lighting under /__BIMFallbackLights (session layer, not persisted)`，確認 patch 生效。
- 03:26:45 起 user 在瀏覽器又進行密集 prim selection，間接確認視覺已可辨識（無法選擇看不到的 prim）。

#### §10.6 紀錄（本節）

- 上述五個步驟與一個衍生 patch 已寫入本文件。Browser DevTools 量測（`v.readyState` / `v.videoWidth` / `v.currentTime`）未直接取得；目前以 web viewer 可視畫面截圖、USD Asset 選中 BIM USDC、人工互動確認、以及 server-side selection / pickable 互動 log 作為 runtime smoke 證據。

### 2026-04-28 §10 protocol 啟動前盤點（read-only）

§10.1 / §10.2 / §10.4 由 read-only 命令收集到的證據（破壞性步驟尚未執行）：

- **§10.1 殘留 process / port**：
  - 本 repo `_build` 路徑下**沒有** `kit.exe` 殘留，**沒有** `node.exe`。
  - 但 port 49100 被 PID 36168 占用：`0.0.0.0:49100 LISTENING (PID 36168)`、`127.0.0.1:49100 ↔ 127.0.0.1:60152 ESTABLISHED (兩端皆 PID 36168)`。
  - 用 `tasklist /FI "PID eq 36168"` 與 `wmic process where ProcessId=36168` 都查不到此 PID（`No Instance(s) Available`）。多次重查 netstat 仍持續顯示。判定：屬 SYSTEM / 受保護 context 持有 socket，user-context shell 看不到也無法直接 kill。
  - **影響**：在解決此 PID 前，下一輪啟動 streaming server 會直接卡在 `Failed to start the primary stream server` 或 signaling port bind 失敗。
  - **建議行動（user，需要管理員權限）**：以 elevated PowerShell 執行 `Get-NetTCPConnection -LocalPort 49100`、`Get-Process -Id 36168 -IncludeUserName` 查 owner；若仍查不到再考慮重開機釋放 socket。
- **§10.2 web-viewer-sample baseline 還原範圍**：
  - `stream.config.json` 已是 baseline（與 HEAD 無 diff）。
  - `src/AppStream.tsx` 有 codec / AV1 強制 query 的未提交 diff，加了：

    ```ts
    enableAV1Support: false,
    codecList: ['H264'],
    signalingQuery: new URLSearchParams({ codeclist: 'H264', av1: 'false' }),
    ```

  - 上一個 commit 為 `acfb72f client: 改採 streamInfo 動態協商解析度，移除寫死 height workaround`，即 plan 中提到的 04-27 16:47 baseline。
  - **建議行動（user）**：`cd C:/Repos/active/iot/AI-BIM-governance/web-viewer-sample && git restore -- src/AppStream.tsx` 即可回到 baseline。
- **§10.4 firewall**：
  - inbound rules 命中 `kit|omniverse|webrtc` 共 4 條，DisplayName 皆為 `NVIDIA Omniverse Kit`，皆 `Enabled=True / Action=Allow / Profile=Private,Public`。
  - 同機 `127.0.0.1` 不受 firewall 影響；若 §10.3 baseline 通過則此項可跳過深查。

未動作項目（待 user 確認後執行）：

- 殺掉 / 釋放 PID 36168 占用的 49100。
- `git restore` `src/AppStream.tsx`。
- 啟動 server / Vite，開瀏覽器做 §10.3 demo scene baseline 視覺驗證。
- §10.5 IFC USD 載入時序測試。

已完成 / 已驗證：

- 修正 `scripts/convert-ifc-to-usdc.ps1` 的 Kit `--exec` 參數傳遞，避免 CAD Converter 只收到 script path、收不到 `--input-path` / `--output-path` / `--config-path`。
- 新增 converter wrapper `scripts/kit-cad-convert-and-quit.py`，讓官方 `hoops_main.py` 完成轉檔後主動 `post_quit()`，避免轉檔成功但 Kit process 不退出、最後被 timeout 判定失敗。
- `.\scripts\tests\test-convert-ifc-to-usdc.ps1` 已通過。
- `.\scripts\convert-ifc-to-usdc.ps1 -IfcPath .\_test_ifc_data\*.ifc -OutputName "{source-file-name}.usdc" -OutputDir .\bim-models -TimeoutSeconds 180 -Force` 已成功完成，產出 `bim-models\許良宇圖書館建築_2026.usdc`。
- USD 可載入且非空：Kit Python / USD API 檢查結果為 `stage_open=1 prims=10872 meshes=543`。
- `git status` 未顯示 `bim-models/*.usdc`，`git check-ignore -v bim-models/許良宇圖書館建築_2026.usdc` 命中 `.gitignore` 的 `*.usdc` 規則。
- Streaming server 已啟動成功並載入 `.usdc`；實測 log：`_testoutput\stream-e2e-h264-20260428-102409-kit.out.log`。
  - `Started primary stream server on signal port 49100 and stream port 47998`
  - `app ready`
  - `許良宇圖書館建築_2026.usdc opened successfully`
  - `Sending message to client that stage has loaded: [obfuscated]`
- Server log 未出現 `FrameGrabFailed` / `NoVideoPacketsReceivedEver` / `Cannot stream video frame with resolution`。

已解除的 blocker（保留排查紀錄）：

- 2026-04-28 已透過 web viewer 截圖與人工視覺互動確認解除：`http://127.0.0.1:5173` 可看到 IFC 轉 USDC 模型，且可在 viewer 中互動。以下保留當時排查紀錄，供未來遇到相同 `0xC0F22226` / `Waiting for stream to begin` 現象時對照。

- Browser client 可開啟並按 `Next`，但 video 停在：
  - `readyState=0`
  - `videoWidth=0`
  - `videoHeight=0`
  - `currentTime=0`
  - 畫面文字：`Waiting for stream to begin`
- Browser / NVIDIA streaming library 反覆回報：
  - `disconnected`
  - `0xC0F22226`（`No displayable error message found for error code 0xC0F22226. N retries left.`）
  - `failed`
- Server log（`_testoutput\stream-e2e-h264-20260428-102409-kit.out.log`，總長 4936 行）：
  - 啟動順利：`Started primary stream server on signal port 49100 and stream port 47998`、`app ready`、`許良宇圖書館建築_2026.usdc opened successfully`、`Sending message to client that stage has loaded`。
  - 自 stage loaded 之後每 20 秒固定出現一次 `Processing 12 signaling headers` 與 `Processed static resize of video stream to 1920x1080`，直到被外部終止為止。
  - **從未** 出現 `Client connected to WebRTC server`。
  - 也未出現 `Got stop event while waiting for client connection` / `Failed to setup the streaming session` / `FrameGrabFailed` / `NoVideoPacketsReceivedEver` / `Cannot stream video frame with resolution`。
- 解讀：WebSocket signaling 對 49100 已通（server 持續收到 client 的 `12 signaling headers`），但 WebRTC ICE / SDP 沒能升到 connected。常見成因：
  1. client 端強制 codec / AV1 query 與 server 協商失敗。
  2. media port 47998 UDP 或 ephemeral UDP candidate 被 firewall / VPN / AV 擋。
  3. 大型 USD 載入後 first frame 渲染延遲過長，client 端 signaling 在 ICE 升起前先 timeout。
- 已在 sibling client repo `web-viewer-sample` 試加 local streaming H264 / disable AV1 / signaling query 限制；CDP log 確認 client 對 49100 的 WebSocket signaling URL 已帶 `&codeclist=H264&av1=false`，但 library 仍記錄 `{304c3b1}##["AV1"]`，WebRTC session 仍中止。證據：`_testoutput\stream-e2e-h264-20260428-102409-cdp.json`。
- 對照組：2026-04-27 16:47 在同一 server build + 預設 demo scene（未帶 `auto_load_usd`） + 未改動的 `web-viewer-sample` 設定下，曾成功進到 `readyState=4` / `videoWidth=1920` / `videoHeight=1080` / `currentTime` 推進（見 [`docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md`](./issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md)）。本次與成功對照組的差異集中於：**(a) 帶 `auto_load_usd` 載大型 IFC 轉出的 USDC、(b) client 端加了 codec / AV1 強制 query 與 local H264 改動**。

下一步建議（依順序執行，每步只動一個變因，避免又把多個變因糾結在一起）：

1. **清理殘留 process / port**。檢查並結束所有殘留 `kit.exe`（**只殺本 repo `_build\windows-x86_64\release\kit\kit.exe` 路徑下的 PID**，不要 `Stop-Process -Name kit -Force`）；確認 `node.exe`（Vite）、Chrome 測試 instance、port 49100 / 47998 / 5173 已釋放。檢查指令見 [`issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md`](./issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md) §不乾淨關閉現象。
2. **還原 client 為 baseline**。在 sibling repo `web-viewer-sample` 把這次加上的 codec / AV1 強制 query 與 local streaming H264 改動 revert 回 04-27 16:47 成功時的版本（`git diff` 確認 `stream.config.json` 與 signaling / AppStream 相關 source 沒有 `codeclist` / `av1=false` / 強制 H264 字樣）。重新 `npm run dev -- --host 127.0.0.1`。
3. **用 demo scene baseline 對照**。先**不要** 帶 `--/app/auto_load_usd`：`.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window`。Browser 連 `http://127.0.0.1:5173/`，預期重現 04-27 16:47 的 demo scene 畫面（球、方塊、圓錐）；server log 必須出現 `Client connected to WebRTC server`。**如果這步無法重現成功**，問題就與 IFC USD 無關，繼續走步驟 4。
4. **檢查 firewall / network**。確認 Windows Defender Firewall 對 `kit.exe` 沒擋 inbound TCP 49100 與 inbound UDP 47998 / ephemeral UDP；同機 `127.0.0.1` 測試通常不受 firewall 影響，但仍要確認沒有第三方 VPN、Anti-virus、Endpoint Protection 對 UDP 做 host-based 過濾。
5. **載入 IFC USD 後再連線（時序問題排除）**。當步驟 3 baseline 通過後，再帶 `--/app/auto_load_usd=C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/<file>.usdc` 重啟 server，**等到 server log 出現 `Sending message to client that stage has loaded`** 後再開 browser client。如果仍卡住，再試：
   - 改用 `openStageRequest`：server 不帶 `auto_load_usd` 啟動，等 client `Client connected to WebRTC server` 出現後，從 client 送 `openStageRequest` 載入大型 USD，避開 first-frame 渲染與 ICE 競賽。
   - 縮小 USD 試做：先用一份 tessellation 較粗、prim / mesh 數量較少的版本（例如重跑 `convert-ifc-to-usdc.ps1` 配上自訂 `-ConfigPath` 降 tessellation），確認是否為 first-frame 渲染負載相關。
6. **最後手段才動 server 端 codec / encoder 設定**。改 streaming `.kit` 的 livestream 相關 settings 屬於 deepest 變動；除非步驟 1–5 都已排除，否則不要動。如真要改，先在 separate kit file（不污染 `ezplus.bim_review_stream_streaming.kit`）做 codec disable AV1 / 強制 H264 試驗，並把證據（前後 server log + browser console）一起入 issue 文件。

2026-04-28 已通過步驟 3 baseline 與步驟 5 IFC USD 載入連線；§7 checklist 中 Browser 視訊與 `openStageRequest` 切換兩項已可標記為完成。

## 1. 前置準備

### 1.1 官方 CAD Converter extension

- 首次使用前需讓 repo build / precache 下載官方 CAD Converter extensions。
- 需要可連線至 NVIDIA / Omniverse extension registry。
- 使用的主要官方 extension：
  - `omni.kit.converter.cad`
  - `omni.kit.converter.hoops_core`
  - `omni.services.convert.cad`

### 1.2 Streaming server repo

確認本 repo 可 build：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\repo.bat build
```

GPU / 驅動需求比照本 repo 的 [README §環境需求](../README.md#環境需求)。

### 1.3 轉檔 helper app

`source/apps/ezplus.bim_ifc_usd_converter.kit` 是專為 IFC → USD 轉檔啟動的獨立 Kit app，**不要** 把這些 CAD Converter 依賴塞進 `ezplus.bim_review_stream.kit` 或 `ezplus.bim_review_stream_streaming.kit`。理由：

- 轉檔需要的擴充（`omni.kit.converter.cad` / `omni.kit.converter.hoops_core` / `omni.services.convert.cad` 與其相依的 jt / dgn / asset_converter / scene_optimizer / services.* 等）對 streaming runtime 是不必要的負擔，會拉長啟動時間並擴大攻擊面。
- `repo.toml` 已將此 helper app 加入 `[repo_precache_exts] apps`，讓 `.\repo.bat build` 會把對應 extensions 預先下載到 build cache，`scripts/convert-ifc-to-usdc.ps1` 才能離線啟動 Kit 跑 CAD Converter。
- 這個 helper app 不直接由 user 啟動；`scripts/convert-ifc-to-usdc.ps1` 會以 `--exec` 帶入 `scripts/kit-cad-convert-and-quit.py` 由它驅動轉檔流程。

## 2. IFC → USD 轉檔

轉檔產物一律輸出到 `bim-models/`。建議命名：

```text
<project>-<level>-<yyyymmdd>.usdc
```

大型模型優先使用 `.usdc`，載入與傳輸通常比 ASCII `.usda` 更適合。

### 2.1 執行轉檔 script

每次啟動 streaming server 前，先執行轉檔 script：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\scripts\convert-ifc-to-usdc.ps1 `
  -IfcPath .\_test_ifc_data\*.ifc `
  -OutputName "{source-file-name}.usdc" `
  -OutputDir .\bim-models `
  -TimeoutSeconds 600
```

說明：

- 這個 script 會使用官方 Kit CAD Converter / HOOPS Core 做 IFC → USDC 轉換。
- 它會展開 `*.ifc`、計算每個 IFC 對應的 `.usdc` 輸出路徑、檢查輸出是否存在且不比 IFC 舊。
- 若 `.usdc` 已存在且比 `.ifc` 新，會略過轉檔。
- 若缺少 `.usdc` 或 `.usdc` 比 `.ifc` 舊，會呼叫 Kit 官方 converter 重新轉檔。
- `-OutputName` 支援 `{source-file-name}`；例如 `A.ifc` 會對應 `A.usdc`。
- 為相容常見 typo，script 也接受 `-OutputNamne` 作為 `-OutputName` alias。
- 預設使用 `config/ifc-hoops-converter.json`；要覆蓋官方 HOOPS options 可傳入 `-ConfigPath <json-path>`。
- 預設單檔轉檔 timeout 為 600 秒；可用 `-TimeoutSeconds <seconds>` 調整，避免 Kit converter 卡住後殘留背景程序。
- 可用 `-PlanOnly -Json` 只檢視轉檔計畫，不實際轉檔。

若 script 回報找不到 `hoops_main.py`，代表官方 CAD Converter extension 尚未下載到 build cache。先執行：

```powershell
.\repo.bat build
```

### 2.2 轉檔輸出檢查

轉檔後確認輸出存在：

```powershell
Get-ChildItem .\bim-models\*.usdc
git check-ignore -v .\bim-models\<file>.usdc
```

### 2.3 注意事項

- 若 IFC 來源是 Z-up，而 Kit viewer 場景預期 Y-up，需透過 converter 設定或轉檔後檢查 up-axis。
- 若模型過大，優先輸出 `.usdc`，再評估 tessellation / decimation 設定。
- CAD Converter 對 BIM property / IFC property set 的保留程度需以實際模型檢查；若後續需要 `ifc:guid` 或完整屬性查詢，需另評估 metadata 補強流程。

### 2.4 轉檔 wrapper script

`scripts/kit-cad-convert-and-quit.py` 是專門包住官方 `hoops_main.py` 的 wrapper，由 `scripts/convert-ifc-to-usdc.ps1` 透過 Kit `--exec` 啟動。它的職責很單純：

- 透過 `argparse` 接收 `--process-script`（官方 `hoops_main.py` 絕對路徑）、`--input-path`、`--output-path`、`--config-path`。
- 用 `runpy.run_path(args.process_script, run_name="__main__")` 在當前 Kit Python interpreter 中執行官方 script，模擬 `python hoops_main.py ...` 的呼叫方式。
- 把官方 script 的 `SystemExit` / 任意 exception 轉成具體 `exit_code`，最後 **一律呼叫 `omni.kit.app.get_app().post_quit(exit_code)`**。

為什麼要 wrapper：官方 `hoops_main.py` 跑完 IFC → USD 轉檔後不會主動結束 Kit process，導致 `convert-ifc-to-usdc.ps1` 的 timeout 邏輯被誤觸發成失敗。Wrapper 透過 `post_quit()` 讓 Kit 主動退出。

### 2.5 轉檔設定（`config/ifc-hoops-converter.json`）

預設設定：

| Key | 預設值 | 說明 / 何時調整 |
| --- | --- | --- |
| `accurateSurfaceCurvatures` | `true` | 曲面曲率精度。複雜曲面（圓形樓梯、自由曲面屋頂）需要保真時保持 `true`；單純梁柱模型可關掉以加速 |
| `accurateTessellation` | `false` | 高精度三角化。模型有圓弧需要平滑時改 `true`，但會放大 mesh 數量 |
| `convertCurves` | `false` | 是否輸出曲線 prim。BIM 模型只需要 mesh，可保持 `false` |
| `convertMetadata` | `true` | 寫入 IFC metadata 到 USD。要做 BIM property 查詢必須維持 `true` |
| `dedup` | `true` | 重複 mesh 去重。可顯著縮小檔案 |
| `filterStyle` | `1` | HOOPS filter 模式 |
| `globalXforms` | `false` | 將 transform baked 到頂點。`false` 可保留 hierarchy，方便 client 端做 prim 選取 |
| `instancingStyle` | `2` | Instance 模式 |
| `instancing` | `true` | 啟用 instancing。重複構件（如玻璃幕牆 module）能大幅省記憶體 |
| `materialType` | `1` | `1` = USDPreviewSurface（跨 viewer 通用）；改 `2` 通常代表 OmniPBR / MDL，視 Kit 版本而定 |
| `useMaterials` | `true` | 是否輸出材質 |
| `useNormals` | `true` | 是否輸出 vertex normal |
| `convertHidden` | `false` | 隱藏的 IFC element 是否轉出。除錯時可暫時改 `true` |
| `tessLOD` | `2` | Tessellation LOD（0–3 越高越細）。模型過大時降到 `1` 換載入速度 |
| `upAxis` / `iUpAxis` | `0` | `0` = Y-up，`1` = Z-up。IFC 通常是 Z-up，但本 repo viewer 預期 Y-up，因此預設 `0` 由 converter 做軸轉換 |
| `dMetersPerUnit` | `0.0` | `0.0` 代表沿用 IFC 原始單位。模型尺度錯時改成具體值（例如 `0.001` 把 mm 轉 m） |
| `bOptimize` | `true` | 啟用 optimizer |
| `sOptimizeConfig` | `""` | optimizer 細部設定（空字串走預設） |
| `reportProgress` / `reportProgressFreq` | `true` / `4` | 控制 converter 進度輸出頻率，影響 log 詳細度 |

調整時優先改這份 default config；若針對特定模型需要不同設定，**不要** 改預設檔，請另存一份並用 `-ConfigPath <json-path>` 指向它。

### 2.6 轉檔 script 自我測試

`scripts/tests/test-convert-ifc-to-usdc.ps1` 驗證 `convert-ifc-to-usdc.ps1` 的計畫階段（不真的跑 Kit）：

- 用 `-PlanOnly -Json` 跑一次，確認 `_test_ifc_data\*.ifc` 在輸入 + `{source-file-name}.usdc` 規則下，會對應到 `bim-models\<同名>.usdc`。
- 確認 plan 結果的 `Status` 與當前 IFC / USDC 時間戳一致（`missing` / `stale` / `ready`）。
- 驗證 `-OutputNamne` typo alias 與 `-OutputName` 解析結果一致。

何時應該跑：
- 修改 `convert-ifc-to-usdc.ps1` 的 input glob、輸出名稱規則、`{source-file-name}` token 解析、或 `-OutputName` / `-OutputNamne` alias 處理時。
- 改 `_test_ifc_data` 內測試 IFC 名稱時。
- 升級 PowerShell / `Set-StrictMode` 規則時。

執行：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\scripts\tests\test-convert-ifc-to-usdc.ps1
```

預期最後輸出：

```text
convert-ifc-to-usdc tests passed
```

## 3. 模型放置與版控

- 路徑：`./bim-models/`，位於 repo root。
- `.gitignore` 已加入：
  - `/bim-models/*` 排除模型資料夾內檔案
  - 例外保留 `.gitkeep` 與 `README.md`
  - 全域 `*.usd` / `*.usda` / `*.usdc` / `*.usdz` 排除，避免誤 commit USD 模型
  - `/source/apps/**` / `/source/extensions/**` / `/templates/**` 內的 USD 例外保留，不擋 NVIDIA template 範例
- 跨機 / 團隊共享請走 Nucleus 或外部物件儲存，**不要把大型 USD 模型 commit 到本 repo**。

驗證 ignore 規則：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
git check-ignore -v bim-models/dummy.usd
git check-ignore -v bim-models/.gitkeep
git check-ignore -v source/apps/whatever.usd
```

預期：

- `bim-models/dummy.usd` 被忽略。
- `bim-models/.gitkeep` 不被忽略。
- `source/apps/whatever.usd` 不被全域 USD ignore 規則阻擋。

## 4. 手動啟動 streaming server 載入 USD

啟動 server 前先跑 IFC → USDC 轉檔：

```powershell
.\scripts\convert-ifc-to-usdc.ps1 -IfcPath .\_test_ifc_data\*.ifc -OutputName "{source-file-name}.usdc" -OutputDir .\bim-models
```

只有當此 script 成功完成，才進入 server 啟動步驟。

若已有人工從 USD Composer 匯出的 `.usd`，可先略過轉檔，將檔案放入 `bim-models/` 後直接啟動 server。建議使用啟動腳本，因為它會先檢查 `nvidia-smi`、49100/47998 port 與 USD 路徑：

```powershell
.\scripts\start-streaming-server.ps1 `
  -UsdPath .\bim-models\許良宇圖書館建築_2026.usd
```

`start-streaming-server.ps1` 提供的參數：

| 參數 | 預設 | 說明 |
| --- | --- | --- |
| `-UsdPath` | `.\bim-models\許良宇圖書館建築_2026.usd` | 要載入的 USD 路徑，相對路徑會以 repo root 解析；最終會改成 forward slash 並透過 `--/app/auto_load_usd=` 傳入 Kit |
| `-NoWindow` | `$true` | 是否帶 `--no-window`。維持 headless 是這條路線的正式解；除非排查需要才關掉 |
| `-SkipGpuCheck` | `$false` | 跳過 `nvidia-smi` preflight；只在沒有 NVIDIA GPU 但仍要做純 build / extension 測試時用 |
| `-PreflightOnly` | `$false` | 只跑 preflight 不啟動 server，方便先驗證環境 |

Preflight 內容：

1. 解析並確認 `-UsdPath` 指向實際存在的檔案（不存在直接 throw）。
2. 確認 `_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat` 已 build 完（沒 build 過會提示先跑 `.\repo.bat build`）。
3. 用 `netstat` 確認 49100 / 47998 都沒被占用。
4. 跑 `nvidia-smi` 並檢查 exit code，失敗就 throw 完整 stdout/stderr。

若 preflight 顯示 `nvidia-smi` 失敗，或 log 出現 `D3D12CreateDevice failed` / `Failed to create any GPU devices`，代表目前啟動 session 無法初始化 NVIDIA GPU。請改從一般互動桌面 Windows Terminal 執行，不要從 sandbox、service、非互動 task runner 啟動。

使用人工轉出的 `.usdc` 絕對路徑啟動：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window --/app/auto_load_usd=C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/<file>.usdc
```

注意事項：

- `auto_load_usd` 建議使用絕對路徑。
- Windows 路徑傳給 Kit setting 時建議使用 forward slash（`/`）。
- 一律加 `--no-window`：headless 路徑可避免 `FrameGrabFailed` / 視窗高度漂移，理由詳見 [`docs/issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md`](./issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md)。
- `auto_load_usd` 走 `source/extensions/ezplus.bim_review_stream.setup/ezplus/bim_review_stream/setup/setup.py` 的 `__open_stage`，會先 resolve token，再 fallback `Path.exists()`。
- 相對路徑在 `auto_load_usd` 不如絕對路徑穩定，先避免使用。

啟動成功 log 應包含：

```text
Started primary stream server on signal port 49100 and stream port 47998
app ready
Sending message to client that stage has loaded: <url>
```

若沒看到 stage loaded log，可加 `--info` 或 `--/app/printConfig=true` 重跑：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window --/app/auto_load_usd=C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/<file>.usdc --/app/printConfig=true --info
```

## 5. Web client 連線

對應 client repo：`C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample`

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
npm run dev -- --host 127.0.0.1
```

`stream.config.json` 維持：

```json
{
  "source": "local",
  "local": { "server": "127.0.0.1", "signalingPort": 49100, "mediaPort": null }
}
```

開啟瀏覽器 `http://127.0.0.1:5173/`，選 `UI for default streaming USD Viewer app`，按 `Next`。

預期：

- Server log：`Client connected to WebRTC server`
- Browser：`video.readyState=4`、`videoWidth/Height>0`、`currentTime` 持續推進
- Console 無 `FrameGrabFailed` / `NoVideoPacketsReceivedEver`
- Client 端不要寫死 `width` / `height`；`omni.kit.livestream.webrtc` 會透過 `streamInfo` 自動協商

## 6. 動態切換模型（不重啟 server）

Server 已具備 `openStageRequest` event handler：`source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py`。

Client 透過 livestream messaging API 送：

```json
{
  "event_type": "openStageRequest",
  "payload": { "url": "<url>" }
}
```

建議使用絕對路徑或 Nucleus URL：

| 寫法 | 說明 |
|---|---|
| `C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/<file>.usdc` | 本機絕對路徑，最穩定 |
| `omniverse://<server>/<path>/<file>.usd` | Nucleus URL，適合團隊共享 |
| `./samples/<file>.usd` | 內建範例專用 |

避免使用 `./bim-models/...`：目前 `stage_loading.py` 的 relative path 會推到 `${app}/..`，實際落在 `_build` 目錄附近，不是 repo root 的 `bim-models/`。

Server 收到後會回送：

- `openedStageResult`：`{ "url": "...", "result": "success" | "error", "error": "..." }`
- 載入過程中的 `updateProgressAmount` / `updateProgressActivity`

## 7. 驗證 checklist

啟動後逐項確認：

- [x] `.\scripts\convert-ifc-to-usdc.ps1 -IfcPath .\_test_ifc_data\*.ifc -OutputName "{source-file-name}.usdc" -OutputDir .\bim-models` 成功完成。
- [x] 輸出的 `.usd` / `.usdc` 可載入並看到正確幾何。（2026-04-28 USD API 檢查：`stage_open=1 prims=10872 meshes=543`；仍需人工視覺確認材質 / 空間方向。）
- [x] `git status` 在 `bim-models/` 內不顯示新放入的 USD 模型。
- [x] `git check-ignore -v bim-models/<file>.usdc` 命中 ignore 規則。
- [x] Streaming server log 出現 `Started primary stream server on signal port 49100 and stream port 47998` 與 `app ready`。
- [x] Stage 開啟 log 出現 `Sending message to client that stage has loaded: <url>`。
- [x] Browser 視訊：`video.readyState=4`、`videoWidth>0`、`videoHeight>0`、`currentTime` 推進。
  - 驗證標準：server log 出現 `Client connected to WebRTC server`；browser console 不再反覆出現 `0xC0F22226` / `disconnected` / `failed` 重試訊息；`document.querySelector('video')` 量到 `readyState===4` 且 `videoWidth>0`、`videoHeight>0`、`currentTime` 持續推進。
  - 目前狀態：2026-04-28 user 提供 web viewer 截圖與人工互動確認；主視窗已渲染 BIM USDC，右側 USD Asset 已選中 `BIM: 許良宇圖書館建築 2026`。DevTools video metrics 未直接抄錄，但 runtime smoke 已通過。
- [x] Console / server log 無 `FrameGrabFailed` / `NoVideoPacketsReceivedEver` / `Cannot stream video frame with resolution`。
- [x] 透過 `openStageRequest` 切換到第二份 `.usd` / `.usdc` 成功。
  - 驗證標準：server log 出現 `Received message to load <url>`，最終 `openedStageResult` 回 `result=success`；browser 視訊未中斷（`currentTime` 仍持續推進，無 `0xC0F22226` 重試）。
  - 目前狀態：2026-04-28 已使用 web viewer asset picker 載入 `BIM: 許良宇圖書館建築 2026`，browser 畫面可見 BIM 模型並可互動。

## 8. Troubleshooting

| 現象 | 處理 |
|---|---|
| 黑畫面 / `FrameGrabFailed` | 確認啟動有加 `--no-window`；client 不寫死高度。詳見 [issue 文件](./issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md) |
| `auto_load_usd` 沒生效 | 加 `--/app/printConfig=true --info` 重跑，確認 setting 真的被解析；改成絕對路徑 |
| IFC 太大 / 載入慢 | 優先輸出 `.usdc`；評估 tessellation / decimation |
| IFC 單位不對 | 調整 converter 設定；或在轉檔後於 USD 修正 metadata |
| 模型出現但材質黑掉 | 檢查 IFC material 是否成功映射為 USDPreviewSurface / OmniPBR；必要時手動補材質 |
| `Failed to start the primary stream server` | 先檢查 Windows `Hardware-accelerated GPU scheduling` 設定（同 issue 文件 §Windows GPU Scheduling 前置條件） |
| Browser 停在 `Waiting for stream to begin`，server log 反覆 `Processing 12 signaling headers` 但**沒有** `Client connected to WebRTC server` | WebSocket signaling 通，但 WebRTC ICE / SDP 沒能升起。依 §0「下一步建議」順序處理：清乾淨 process → 還原 client codec query → 用 demo scene baseline → 檢查 firewall → 才回頭處理 IFC USD 載入時序 |
| Browser console 反覆出現 `No displayable error message found for error code 0xC0F22226. N retries left.` | NVST 的 generic disconnect。多半是 ICE candidate 沒交換成功；同上條處理。獨立發生時優先檢查 `kit.exe` 對應的 inbound TCP 49100 / inbound UDP 47998 / ephemeral UDP 是否被 firewall / VPN / AV 擋 |
| Stage 切換失敗 | 看 server log 中 `openedStageResult` 的 `error` 欄位；常見是 URL 解析後檔案不存在 |

## 9. 後續可評估（不在本次範圍）

- Nucleus 整合：模型統一放 Nucleus，URL 改 `omniverse://<server>/<path>/<file>.usd`，團隊端無需各自下載 USD。
- IFC metadata 補強：若需要完整 BIM property 查詢，評估轉檔後補寫 `ifc:guid` / property set 到 USD。

## 10. 下次驗證 protocol（建議照順序執行）

依 §0「下一步建議」整理成可逐步執行的命令清單。一次只動一個變因；每步通過再進下一步。

### 10.1 清理殘留 process / port

```powershell
Get-Process kit -ErrorAction SilentlyContinue | `
  Where-Object { $_.Path -like 'C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_build\*kit.exe' } | `
  Select-Object Id, Path, StartTime
```

對輸出列出的 PID 逐一 `Stop-Process -Id <PID>`（仍不退出才加 `-Force`）。**不要** 直接 `Stop-Process -Name kit -Force`，避免誤殺其他 Omniverse / Kit app。

接著確認 client / port：

```powershell
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, Path, StartTime
netstat -ano | Select-String ':49100|:47998|:5173'
```

殘留的 Vite `node.exe` 與測試 Chrome instance 一併關掉，確認 49100 / 47998 / 5173 都沒被占用後才進下一步。

### 10.2 還原 client baseline

於 sibling repo `web-viewer-sample`：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
git status
git diff -- stream.config.json src
```

確認 `stream.config.json` 為：

```json
{
  "source": "local",
  "local": { "server": "127.0.0.1", "signalingPort": 49100, "mediaPort": null }
}
```

確認 source 內無 `codeclist=H264` / `av1=false` / 強制 H264 字樣。如有，先 revert 回 04-27 16:47 成功時的版本（可比對 `git log -- stream.config.json` 找到當時 commit）。重新啟動：

```powershell
npm run dev -- --host 127.0.0.1
```

### 10.3 demo scene baseline

不帶 `auto_load_usd`，純走 04-27 16:47 成功路徑：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

Browser 開 `http://127.0.0.1:5173/`，選 `UI for default streaming USD Viewer app`，按 `Next`。

通過判定：

- Server log 出現 `Started primary stream server on signal port 49100 and stream port 47998` → `app ready` → **`Client connected to WebRTC server`**。
- Browser 顯示 NVIDIA Web Viewer demo scene（球、方塊、圓錐），`document.querySelector('video')` 量到 `readyState===4`，`videoWidth>0`，`videoHeight>0`，`currentTime` 持續推進。

未通過則停在這步，往 §10.4 firewall 排查；不要進下一步。

### 10.4 firewall / network

確認以下三條規則允許 `kit.exe`：

- inbound TCP 49100（signaling）
- inbound UDP 47998（media）
- inbound UDP ephemeral range（ICE candidate）

```powershell
Get-NetFirewallRule -Direction Inbound | `
  Where-Object { $_.DisplayName -match 'kit|omniverse|webrtc' } | `
  Select-Object DisplayName, Enabled, Action, Profile
```

同機 `127.0.0.1` 一般不受 firewall 影響，但仍要確認沒有第三方 VPN / Anti-virus / Endpoint Protection 對 host loopback UDP 做 hook。

### 10.5 IFC USD 載入時序

§10.3 baseline 通過後才執行：

```powershell
.\scripts\convert-ifc-to-usdc.ps1 -IfcPath .\_test_ifc_data\*.ifc -OutputName "{source-file-name}.usdc" -OutputDir .\bim-models
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window --/app/auto_load_usd=C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/<file>.usdc
```

**等到 server log 出現 `Sending message to client that stage has loaded`** 才開 browser client。

通過判定：

- Server log 出現 `Client connected to WebRTC server`。
- Browser 看到 IFC 模型，`currentTime` 持續推進。

仍卡住則改用動態載入規避 first-frame 競賽：

1. server 不帶 `auto_load_usd` 啟動。
2. 等 client `Client connected to WebRTC server` 出現。
3. 從 client 送 `openStageRequest`（payload 為 `bim-models/<file>.usdc` 絕對路徑）。

或縮小 USD（用較粗 tessellation 的 `-ConfigPath` 重轉一份）做對照組。

### 10.6 紀錄

每一步通過或卡住的證據（server log 行號、browser console error code、video 量測值）回寫到本文件 §0「執行進度」與 [`issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md`](./issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md)，避免下一輪又把已驗證的步驟重做一遍。

## 11. 官方參考

- [NVIDIA-Omniverse/kit-app-template](https://github.com/NVIDIA-Omniverse/kit-app-template)
- [Application Streaming](https://docs.omniverse.nvidia.com/kit/docs/kit-app-template/latest/docs/streaming.html)
- [Kit Kernel Command Line Options](https://docs.omniverse.nvidia.com/kit/docs/carbonite/latest/docs/Kernel/CommandLineOptions.html)
- [Kit Manual: Configuration](https://docs.omniverse.nvidia.com/kit/docs/kit-manual/latest/guide/configuring.html)
- [CAD Converter](https://docs.omniverse.nvidia.com/kit/docs/omni.kit.converter.cad/latest/Overview.html)

## 相關文件

- [README.md](../README.md)
- [BUILD.md](../BUILD.md)
- [issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md](./issue-webrtc-framegrabfailed-resolution-mismatch-2026-04-27.md)
- [todo-webrtc-server-reboot-checklist-2026-04-24.md](./todo-webrtc-server-reboot-checklist-2026-04-24.md)
