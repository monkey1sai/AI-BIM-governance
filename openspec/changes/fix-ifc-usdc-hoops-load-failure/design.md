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

## Risks

- 大 IFC fallback 可能耗時較久；先以 correctness gate 優先，不把 performance optimization 混進本 change。
- IfcOpenShell 產生的 mesh fidelity 可能不同於 HOOPS；本 change 的成功標準是可開啟 USD/USDC 與 renderable geometry，不宣稱與 HOOPS 視覺完全一致。
- 若使用者 IFC 的部分元素無法 tessellate，fallback 可產生 partial mapping，但不得假造完整 coverage。
