## Context

本次失敗鏈路已重現並具備可觀察證據：

- `POST /api/external/ifc-ready` 成功，`download_status="downloaded"`，IFC 落在 `storage/ifc-cache/<ifc_ready_job_id>/source.ifc`。
- coordinator 成功派工到 host-native conversion service，取得 `conversion_job_id`。
- streaming result 顯示 `status="failed"`，Kit/HOOPS stderr 為 `A3D_LOAD_CANNOT_LOAD_MODEL`。
- 下載檔不是 HTML / 錯誤頁；檔案有 `ISO-10303-21` header 與 `END-ISO-10303-21` footer。
- IfcOpenShell 可解析同一檔案：schema `IFC4`、約 4.7M entities，geometry iterator 能產出 shape / vertices / faces。

因此根因不是 intake / download / dispatch 失敗，也不是 Kit extension 缺失；失敗集中在 HOOPS 對這個 IFC 的 import 支援。最小可驗證修復是讓 host-native adapter 在此類 HOOPS import failure 後走一條真實 geometry fallback，而不是讓 coordinator 或 viewer 繞過 conversion authority。

## Approach

### D1. 保持既有 conversion authority 與 API shape

不改 `bim-review-coordinator` 的外部 intake contract，也不新增 viewer path。`bim-streaming-server` 的 host-native conversion adapter 仍是唯一轉檔執行點：

```txt
coordinator POST /api/external/ifc-ready
→ streaming POST /api/conversions/ifc-to-usdc
→ Ifc2UsdcPowershellConverterAdapter.convert()
→ HOOPS primary converter
→ IfcOpenShell/OpenUSD fallback when primary fails on parseable IFC
→ existing StreamingConversionStore success gates
```

### D2. fallback trigger

fallback 只在下列條件成立時啟動：

- HOOPS / PowerShell conversion path 已實際嘗試且失敗；
- error 訊息或 log tail 顯示 `A3D_LOAD_CANNOT_LOAD_MODEL`、`Failed to import model` 或等價 import failure；
- source IFC local path 可讀；
- IfcOpenShell 能開檔且 geometry iterator 能初始化。

其他錯誤（timeout、missing Kit executable、missing ps1、path traversal、output validation failure）仍依既有 non-ready failure 處理，不進 fallback。

### D3. fallback output

新增一個小型 adapter helper，從 IfcOpenShell geometry iterator 讀取 renderable shape，使用 OpenUSD `Usd.Stage.CreateNew` / `UsdGeom.Mesh` 寫出 `model.usdc`。

每個 mesh prim 至少寫入：

- `points`
- `faceVertexCounts`
- `faceVertexIndices`
- `extent`
- custom data 或 attributes 保存 `ifc_guid` / IFC class / IFC name（可取得時）

sidecars 由 fallback 同步產生：

- `element_mapping.json`: `mock=false`，以 IFC GUID 對應 fallback 生成 prim path；無法產幾何或無 GUID 的項目不得假造 mapping。
- `entity_index.json`: 記錄產生的 prim/entity list，以及 source schema / counts。
- `metadata.json`: 記錄 fallback converter identity、source IFC path/size/schema、shape/mesh/vertex/face counts、primary converter failure 摘要。
- quality metrics: `materialization_strategy="ifcopenshell_openusd_fallback"`，`hard_quality_gates.usdc_openable=true`、`has_renderable_prims=true`、`placeholder_output=false`。

### D4. validation gates

fallback 完成後必須重新打開產出的 `model.usdc`，確認：

- `Usd.Stage.Open(model.usdc)` 成功；
- stage 至少包含一個 `UsdGeom.Mesh`；
- `model.usdc` 不是 placeholder marker；
- required sidecars 皆存在；
- existing `StreamingConversionStore._assert_publishable_outputs` 仍會檢查並發布 ready result。

### D5. performance guard

使用者當前 IFC 約 341MB / 4.7M entities；fallback 可能比 HOOPS 慢。MVP 不做全域 job queue 重寫，但 helper 應保留明確計數與 duration metrics。若 geometry 產生耗時，仍應透過現有 conversion job 狀態與 timeout 管控，不阻塞 live WebRTC runtime。

### D6. dependency policy

不在本 change 引入新的 production package manager 依賴。fallback import `ifcopenshell` 與 `pxr` 採 lazy import：

- 如果 host-native runtime 已有兩者，fallback 可執行。
- 任一缺失時，conversion job 仍 failed/non-ready，error code/message 指向缺少 fallback prerequisite。

### D7. archive gate

本 change 不得因 unit tests pass 就 archive。archive 前必須留下真實 runtime evidence：

- 用使用者當前外部 IFC URL 或等價本地 cached IFC 建立新 conversion job。
- `GET /api/external/ifc-ready/<job>` 顯示 `conversion_status="ready"`。
- `GET /api/conversions/<conversion_job_id>/result` 顯示 `status="succeeded"` 或 allowed warning status、`ready=true`、`model.status="ready"`。
- `artifacts.model_usdc.url` 存在，且 artifact dir 內 `model.usdc` 可由 USD runtime 開啟。
- coordinator 建立 local web view session 或產生 `viewer_url`；若 WebRTC/Kit viewer runtime 另有 blocker，必須分層記錄，不能否定 conversion ready。
- Chrome E2E 必須證明 viewer 透過 DataChannel 讓 Kit 載入本次 conversion artifact。只有 `viewer_url` HTTP 200、React 畫面顯示 model URL、或 coordinator stream-config 指到 artifact 都不再足夠。

### D8. 新證據修正：conversion ready 不是 viewer success

使用者後續人工驗證指出畫面仍看到 `許良宇圖書館建築_2026.usdc`，並且 viewer 看數秒後會斷線。重新盤點後，現況分層如下：

```txt
IFC download                    pass
conversion artifact ready        pass
coordinator session binding      pass
viewer metadata display          partial
DataChannel openStage to target  not proven
Kit loaded target stage          not proven
WebRTC session stability         failing / unstable
```

Kit log 中沒有找到 `stream_conv_20260522080140_dfa11d33` 的 stage-load 證據；反而存在舊 demo path `bim-models/許良宇圖書館建築_2026.usdc` 的 opened successfully 訊息。Kit log 也反覆出現：

```txt
NVST_R_BUSY, dropping frame
Client disconnected from WebRTC server
```

這代表本 change 的剩餘閉環目標不是再修 conversion fallback，而是補足 runtime observability 與 stage-load truth gate。

### D9. `/ui` runtime dashboard

`bim-review-coordinator` `/ui` 應從「三張 demo 卡 + dev console」收斂成 operator 可讀的 closed-loop dashboard。頁面首屏必須直接顯示：

```txt
POST ifc-ready job
  -> download_status / local_path / host_local_path
  -> conversion_job_id / conversion_status
  -> artifact_manifest_ref / model_usdc / mapping_url
  -> review_session_id / viewer_url
  -> Kit endpoint / WebRTC connection evidence / viewer count
```

UI 不應把舊 `/api/assets` demo picker 狀態當成本次 session 的主模型。任何舊 demo asset 只可出現在 debug 區或 dropdown，不可被 dashboard 判為 current model。

### D10. Read-only runtime status API

為了讓 `/ui` 不再靠人工拼 log，可新增 additive read-only endpoints：

- `GET /api/external/ifc-ready`：列出最近 IFC-ready jobs，含 download/conversion/viewer 欄位。
- `GET /api/runtime/status`：回傳 coordinator 可觀測的 runtime summary：
  - coordinator uptime / service status
  - configured Kit endpoints
  - review sessions / participants count
  - known `kit_instance_bindings`
  - optional host observations（ports/listeners/log tail）若可安全取得
- `GET /api/runtime/kit-log-tail` 或等價整合欄位：只回傳最近 runtime evidence 摘要，不回傳模型 bytes 或 secrets。

這些 API 只做觀測，不新增 coordinator 對 USD/USDC 的 render 或 parse 責任。

### D11. Viewer stage-load truth gate

`web-viewer-sample` 對 session-first viewer 必須建立以下 invariant：

```txt
expectedStageUrl = stream_config.stage_composition.primary.url
```

當 viewer 開啟 session 時：

1. 顯示 expected stage URL、conversion job、session id。
2. WebRTC started 後送 `openStageRequest(expectedStageUrl)`。
3. 收到 `openedStageResult` 或 `loadingStateResponse` 後，檢查 Kit 回報 URL 是否等於 expected stage URL（允許 Kit 端 HTTP cache 轉為本機 cache path 時仍保留 requested URL echo）。
4. 若 Kit 回報舊 demo path、空 URL、或未知 URL，畫面標示 `stale_stage_or_mismatch`，不得宣稱 viewer ready。
5. 若 WebRTC `onStop` / `onTerminate` 觸發，畫面標示 `webrtc_disconnected`，並提供重新連線/重建 stream component 的路徑；不得只 `console.log`。

### D12. WebRTC disconnect diagnosis

斷線不應只顯示「看不到畫面」。dashboard 和 viewer 必須分層顯示：

- browser video readiness：`readyState`、`videoWidth`、`videoHeight`、`srcObject`
- AppStreamer lifecycle：started / stopped / terminated / failed
- Kit log evidence：最近 `Client connected`、`Client disconnected`、`NVST_R_BUSY`
- active connection summary：49100/47998/5173/8004/49101 listener 與連線數（若由本機 API 或 smoke script 提供）

當連線數殘留或 Kit 長時間運行導致狀態混濁時，dashboard 應明確建議 operator 重啟 Kit/WebRTC runtime，而不是要求關掉所有 Chrome 才恢復。

### D13. Chrome human-like E2E

archive 前 E2E 必須使用 Chrome/Chromium browser automation 模擬人類路徑：

```txt
1. 打開 http://192.168.10.105:8004/ui
2. 在 /ui 送出或選取 ifc-ready job
3. 觀察 download_status 從 pending/downloading 到 downloaded
4. 觀察 conversion_job_id 建立並到 ready/succeeded
5. 點開 viewer
6. 等待 WebRTC started
7. 等待 DataChannel stage-load result
8. 驗證 loaded stage URL == current conversion model.usdc URL
9. 驗證 video 有非零 dimensions 且截圖不是舊圖書館 stage
10. 觸發 reload/reconnect，驗證不需要關閉整個 Chrome 才能恢復，或將 blocker 精確顯示為 WebRTC/Kit runtime limitation
```

每次 E2E 必須保存 artifact：HAR / screenshot / console log summary / coordinator runtime snapshot / Kit log line references。若任一環節失敗，OpenSpec task 不可勾選 archive gate。

## Risks

- 大 IFC fallback 可能耗時較久；先以 correctness gate 優先，不把 performance optimization 混進本 change。
- IfcOpenShell 產生的 mesh fidelity 可能不同於 HOOPS；本 change 的成功標準是可開啟 USD/USDC 與 renderable geometry，不宣稱與 HOOPS 視覺完全一致。
- 若使用者 IFC 的部分元素無法 tessellate，fallback 可產生 partial mapping，但不得假造完整 coverage。
