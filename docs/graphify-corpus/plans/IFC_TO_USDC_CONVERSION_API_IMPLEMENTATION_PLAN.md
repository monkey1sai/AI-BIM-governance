# IFC → USDC Conversion API 實作計畫 v0.1

> 給 Codex 執行用。
> 目標：在 `AI-BIM-governance` workspace 內，把 IFC → USDC 轉換流程包成可呼叫的 API，並在同一個 conversion job 中產生最小可用的 `element_mapping.json`。
> 本文件只規劃轉檔 API 與 mapping 的第一階段落地，不處理完整法規、碳排、HVAC、多人協作、正式雲端部署。

---

## 0. 核心目標

第一階段要完成這條閉環：

```txt
IFC file
  → _conversion-service POST /api/conversions
  → 呼叫 bim-streaming-server 既有 Kit headless converter
  → 產生 .usdc
  → 產生 ifc_index.json
  → 產生 usd_index.json
  → 產生 element_mapping.json
  → 將結果放到 _s3_storage
  → _bim-control 可查到 conversion result
  → web-viewer-sample / bim-streaming-server 可用 usdc_url 開啟模型
```

最小驗收重點：

```txt
1. 有可呼叫 API
2. 有 USDC 輸出
3. 有 mapping 輸出
4. mapping 不造假；無法對應的元素要明確列為 unmapped
5. web-viewer-sample 可以取得 usdc_url 後送 openStageRequest
```

---

## 1. Repo 邊界

### 1.1 `_conversion-service`

定位：

```txt
轉檔 API / conversion job manager / mapping builder
```

允許做：

```txt
- 提供 FastAPI endpoint
- 接收 conversion job
- 呼叫 bim-streaming-server 裡的既有轉檔 script
- 產生 ifc_index.json
- 產生 usd_index.json
- 產生 element_mapping.json
- 將輸出複製或上傳到 _s3_storage
- 通知或回寫 _bim-control fake API
```

不應做：

```txt
- WebRTC streaming
- Omniverse viewport rendering
- long-term business data authority
- 法規正式判斷
- 碳排正式計算
```

---

### 1.2 `bim-streaming-server`

定位：

```txt
Omniverse Kit runtime + 既有 Kit headless converter 工具來源
```

允許做：

```txt
- 保留既有 IFC → USDC converter .kit / script
- 提供 inspect USD 的 Kit Python script
- 提供可由 _conversion-service 呼叫的 PowerShell wrapper
```

不應做：

```txt
- 對外提供 conversion REST API
- 管 conversion job database
- 管 _bim-control artifact 狀態
```

---

### 1.3 `_s3_storage`

定位：

```txt
fake object storage / local file server
```

允許做：

```txt
- 存 IFC 原檔
- 存 USDC 衍生檔
- 存 ifc_index.json
- 存 usd_index.json
- 存 element_mapping.json
- 提供 HTTP static URL
```

---

### 1.4 `_bim-control`

定位：

```txt
fake BIM data authority
```

允許做：

```txt
- 保存 project / model_version / artifact fake records
- 保存 conversion_status
- 保存 usdc_url
- 保存 mapping_url
```

---

### 1.5 `web-viewer-sample`

定位：

```txt
browser client / validation consumer
```

本階段只做驗證，不主動新增大量功能。
驗證目標是確認它可以用 conversion result 中的 `usdc_url` 送出 `openStageRequest`。

---

## 2. 工作前置檢查

Codex 開始前先執行：

```powershell
cd AI-BIM-governance
git status --short
```

如果 root 是 git repo，確認工作區是否乾淨。

再分別檢查可能被修改的 folder 是否為獨立 git repo：

```powershell
cd _conversion-service
git rev-parse --show-toplevel

cd ..\bim-streaming-server
git rev-parse --show-toplevel

cd ..\_bim-control
git rev-parse --show-toplevel

cd ..\_s3_storage
git rev-parse --show-toplevel
```

若任何 repo 有未提交變更：

```txt
1. 不要覆蓋
2. 先列出變更
3. 只修改與本任務相關且安全的檔案
4. 必要時建立備份 branch 或請使用者確認
```

---

## 3. Git 工作流程

### 3.1 建立 branch

在每個會被修改的 git repo 裡建立同名 branch：

```powershell
git checkout -b feature/ifc-usdc-conversion-api-v1
```

如果 branch 已存在：

```powershell
git checkout feature/ifc-usdc-conversion-api-v1
```

### 3.2 建議 commit 切分

至少切成 4 個 commit：

```txt
commit 1:
docs: add IFC to USDC conversion API plan

commit 2:
feat(conversion): add FastAPI conversion job API

commit 3:
feat(conversion): add IFC/USD indexing and element mapping output

commit 4:
test(conversion): add smoke tests and local validation scripts
```

如果需要修改 `bim-streaming-server`：

```txt
commit 5:
feat(streaming): add USD stage inspection helper for conversion mapping
```

### 3.3 每次 commit 前檢查

```powershell
git status --short
git diff --stat
```

如果是 Python service：

```powershell
python -m pytest -q
```

如果是 `bim-streaming-server`：

```powershell
.\repo.bat build
```

---

## 4. 第一階段實作總覽

本階段分成 8 個 Phase。

```txt
Phase 0: 掃描現有檔案與設定
Phase 1: 建立 _conversion-service FastAPI skeleton
Phase 2: 建立 conversion job model 與 job store
Phase 3: 包裝現有 Kit headless converter
Phase 4: 產生 ifc_index.json
Phase 5: 產生 usd_index.json
Phase 6: 產生 element_mapping.json
Phase 7: 整合 _s3_storage 與 _bim-control fake API
Phase 8: 驗證 openStageRequest 可使用產出的 USDC
```

---

## 5. Phase 0：掃描現況

### 5.1 檢查 `bim-streaming-server` 既有轉檔資源

確認以下檔案是否存在：

```txt
bim-streaming-server/source/apps/ezplus.bim_ifc_usd_converter.kit
bim-streaming-server/scripts/convert-ifc-to-usdc.ps1
bim-streaming-server/scripts/kit-cad-convert-and-quit.py
bim-streaming-server/config/ifc-hoops-converter.json
```

執行：

```powershell
cd bim-streaming-server
Test-Path .\source\apps\ezplus.bim_ifc_usd_converter.kit
Test-Path .\scripts\convert-ifc-to-usdc.ps1
Test-Path .\scripts\kit-cad-convert-and-quit.py
Test-Path .\config\ifc-hoops-converter.json
```

### 5.2 檢查 converter app 是否被 build 註冊

檢查 `premake5.lua` 是否包含：

```lua
define_app("ezplus.bim_ifc_usd_converter.kit")
```

如果沒有，加上。
注意：只加這一行，不要重構 premake。

驗證：

```powershell
.\repo.bat build
```

通過標準：

```txt
- build 完成
- 沒有因 converter app 缺少 define_app 造成 launch/package 不一致
```

---

## 6. Phase 1：建立 `_conversion-service` FastAPI skeleton

### 6.1 建議目錄

```txt
_conversion-service/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── models.py
│   ├── job_store.py
│   ├── storage_client.py
│   ├── platform_client.py
│   ├── converter_runner.py
│   ├── mapping_builder.py
│   └── indexers/
│       ├── __init__.py
│       ├── ifc_indexer.py
│       └── usd_indexer.py
├── tests/
│   ├── test_health.py
│   ├── test_conversion_api.py
│   └── test_mapping_builder.py
├── data/
│   ├── jobs/
│   ├── work/
│   └── logs/
├── requirements.txt
├── .env.example
└── README.md
```

### 6.2 requirements.txt

最小內容：

```txt
fastapi
uvicorn[standard]
pydantic
pydantic-settings
httpx
python-multipart
pytest
```

可選：

```txt
ifcopenshell
```

注意：`ifcopenshell` 安裝失敗時，不可讓整個 service 無法啟動。
`ifc_indexer.py` 必須有 fallback regex parser。

### 6.3 main.py 最小 endpoints

```txt
GET  /health
POST /api/conversions
GET  /api/conversions/{job_id}
GET  /api/conversions/{job_id}/result
```

---

## 7. Phase 2：Conversion Job Model

### 7.1 Request schema

```json
{
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_artifact_id": "artifact_ifc_demo_001",
  "source_url": "http://localhost:8002/static/models/sample.ifc",
  "target_format": "usdc",
  "options": {
    "force": false,
    "generate_mapping": true,
    "allow_fake_mapping": false
  }
}
```

### 7.2 Job response

```json
{
  "job_id": "conv_001",
  "status": "queued",
  "stage": "queued",
  "created_at": "2026-04-29T10:00:00+08:00"
}
```

### 7.3 Status enum

```txt
queued
running
succeeded
failed
cancelled
```

### 7.4 Stage enum

```txt
queued
downloading_source
indexing_ifc
converting_ifc_to_usdc
indexing_usd
building_mapping
publishing_outputs
updating_bim_control
done
failed
```

### 7.5 Job store

第一版用 JSON file store，不用資料庫。

```txt
_conversion-service/data/jobs/{job_id}.json
```

要求：

```txt
- job 狀態更新要寫入檔案
- crash 後至少能查到最後狀態
- 不需要做完整 queue worker，第一版可同步執行或 background task
```

建議第一版用 FastAPI `BackgroundTasks`。

---

## 8. Phase 3：包裝現有 Kit headless converter

### 8.1 converter_runner.py

實作一個 runner：

```python
run_ifc_to_usdc(
    ifc_path: Path,
    output_dir: Path,
    output_name: str,
    force: bool,
    timeout_seconds: int,
) -> ConversionProcessResult
```

內部呼叫：

```powershell
bim-streaming-server/scripts/convert-ifc-to-usdc.ps1
```

範例：

```powershell
.\scripts\convert-ifc-to-usdc.ps1 `
  -IfcPath "<local_ifc_path>" `
  -OutputName "{source-file-name}.usdc" `
  -OutputDir "<work_output_dir>" `
  -TimeoutSeconds 600
```

### 8.2 路徑設定

在 `.env.example` 放：

```txt
BIM_STREAMING_SERVER_ROOT=../bim-streaming-server
CONVERSION_WORK_DIR=./data/work
CONVERSION_OUTPUT_DIR=./data/work/outputs
FAKE_STORAGE_ROOT=../_s3_storage
FAKE_STORAGE_STATIC_URL=http://localhost:8002/static
FAKE_BIM_CONTROL_URL=http://localhost:8001
CONVERSION_TIMEOUT_SECONDS=900
```

### 8.3 PowerShell 呼叫注意

Windows 下 subprocess 建議：

```txt
executable: powershell.exe
args:
  -NoProfile
  -ExecutionPolicy Bypass
  -File <script>
```

要求：

```txt
- capture stdout
- capture stderr
- log 到 data/logs/{job_id}.log
- timeout 後標記 failed
- exit code 非 0 標記 failed
```

### 8.4 通過標準

```txt
- 手動 POST conversion job 後，可以在 work output folder 看到 .usdc
- job status 最終變成 succeeded
- failed 時可讀到錯誤 log
```

---

## 9. Phase 4：產生 ifc_index.json

### 9.1 ifc_indexer.py 策略

優先使用 `ifcopenshell`：

```txt
- GlobalId
- ifc_class
- Name
- ObjectType
- Tag
- PredefinedType
```

若 `ifcopenshell` 不可用，使用 regex fallback：

```txt
#123=IFCWALL('2VJ3...',#...
```

fallback 至少提取：

```txt
ifc_entity_id
ifc_class
ifc_guid
raw_line
```

### 9.2 ifc_index.json 格式

```json
{
  "source_file": "sample.ifc",
  "indexer": "ifcopenshell|regex",
  "total_items": 1,
  "items": [
    {
      "ifc_entity_id": "#123",
      "ifc_guid": "2VJ3sK9L000fake001",
      "ifc_class": "IfcWall",
      "name": "Basic Wall: 外牆 W1",
      "object_type": "Basic Wall",
      "tag": "123456"
    }
  ]
}
```

### 9.3 驗證

新增測試：

```txt
tests/fixtures/sample_minimal.ifc
tests/test_ifc_indexer.py
```

測試：

```txt
- 可以抓到至少 1 個 IFC rooted element
- ifc_guid 不為空
- ifc_class 不為空
- regex fallback 在沒有 ifcopenshell 時仍可運作
```

---

## 10. Phase 5：產生 usd_index.json

### 10.1 新增 `bim-streaming-server/scripts/inspect-usd-stage.py`

這支 script 應該用 Kit Python / USD Python 執行，不要求系統 Python 有 `pxr`。

用途：

```txt
輸入 .usdc path
輸出 usd_index.json
```

建議 CLI：

```powershell
kit.exe --no-window --exec scripts/inspect-usd-stage.py -- `
  --input "<model.usdc>" `
  --output "<usd_index.json>"
```

如果現有 Kit wrapper 需要特殊寫法，Codex 應依照 repo 既有 `kit-cad-convert-and-quit.py` 的風格實作。

### 10.2 usd_index.json 格式

```json
{
  "source_file": "sample.usdc",
  "total_prims": 1,
  "items": [
    {
      "usd_prim_path": "/World/IFCWALL/Wall_102/Mesh",
      "prim_type": "Mesh",
      "name": "Wall_102",
      "metadata": {},
      "custom_data": {},
      "attributes": {
        "primvars:displayColor": "..."
      },
      "guid_candidates": [
        "2VJ3sK9L000fake001"
      ]
    }
  ]
}
```

### 10.3 GUID candidate 掃描

對每個 prim 嘗試掃描：

```txt
- prim metadata
- customData
- attribute names / values
- prim path string
- prim name
```

找出可能是 IFC GlobalId 的字串。

候選 key 包含：

```txt
GlobalId
IfcGUID
ifc_guid
ifcGlobalId
sourceGlobalId
source_guid
externalId
revitElementId
```

注意：

```txt
- 不要把任何隨機字串硬當 GUID
- 如果不確定，放入 guid_candidates，但 mapping confidence 要低
```

### 10.4 驗證

用一個已知 USDC：

```powershell
cd bim-streaming-server
.\repo.bat build
# 使用 built kit 或 repo.bat launch 的可用方式執行 inspect script
```

通過標準：

```txt
- usd_index.json 存在
- items 非空
- 至少能列出 Mesh prim path
```

---

## 11. Phase 6：產生 element_mapping.json

### 11.1 mapping_builder.py

輸入：

```txt
ifc_index.json
usd_index.json
```

輸出：

```txt
element_mapping.json
```

### 11.2 mapping 方法

順序：

```txt
1. metadata_guid
   USD guid_candidates 與 IFC GlobalId 完全相同

2. metadata_revit_element_id
   USD metadata / customData 有 Revit ElementId，IFC tag 可對應

3. unique_name_class_match
   IFC name + class 與 USD path/name 唯一匹配
   第一版可以實作，但 confidence 要低，且只能唯一匹配時使用

4. no_match
   不產生假 mapping，列入 unmapped
```

### 11.3 confidence 規則

```txt
metadata_guid             0.95
metadata_revit_element_id 0.85
unique_name_class_match   0.50
no_match                  0.00
```

### 11.4 element_mapping.json 格式

```json
{
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_artifact_id": "artifact_ifc_demo_001",
  "usdc_artifact_id": "artifact_usdc_demo_001",
  "mapping_version": "v0.1",
  "summary": {
    "ifc_items": 100,
    "usd_items": 120,
    "mapped_items": 80,
    "unmapped_ifc_items": 20,
    "unmapped_usd_items": 40
  },
  "items": [
    {
      "ifc_guid": "2VJ3sK9L000fake001",
      "ifc_class": "IfcWall",
      "name": "Basic Wall: 外牆 W1",
      "revit_element_id": "123456",
      "usd_prim_path": "/World/IFCWALL/Wall_102/Mesh",
      "usd_prim_type": "Mesh",
      "mapping_confidence": 0.95,
      "mapping_method": "metadata_guid"
    }
  ],
  "unmapped_ifc_guids": [
    "1ABC..."
  ],
  "unmapped_usd_prims": [
    "/World/SomeMesh"
  ]
}
```

### 11.5 嚴格規則

```txt
- 不可為了讓測試過而捏造 ifc_guid ↔ usd_prim_path
- 如果 converter 沒保留 GUID，mapping 可以有大量 unmapped，這是有效結果
- fake mapping 只能在 options.allow_fake_mapping = true 時產生
- fake mapping 必須標示 mapping_method = "fake_for_smoke_test"
- production-like 預設 allow_fake_mapping = false
```

### 11.6 驗證

測試：

```txt
- exact GUID match 可產生 mapping
- no match 會進 unmapped
- fake mapping 預設不啟用
- allow_fake_mapping=true 時才可產生 fake mapping
```

---

## 12. Phase 7：整合 `_s3_storage` 與 `_bim-control`

### 12.1 發佈輸出

conversion job 成功後，將以下檔案放到 `_s3_storage`：

```txt
_s3_storage/static/projects/{project_id}/versions/{model_version_id}/source.ifc
_s3_storage/static/projects/{project_id}/versions/{model_version_id}/model.usdc
_s3_storage/static/projects/{project_id}/versions/{model_version_id}/ifc_index.json
_s3_storage/static/projects/{project_id}/versions/{model_version_id}/usd_index.json
_s3_storage/static/projects/{project_id}/versions/{model_version_id}/element_mapping.json
```

如果 `_s3_storage` 是 FastAPI server，就用 upload API。
如果尚未完成 upload API，第一版可直接 copy 檔案到 local static folder。

### 12.2 回傳 result

`GET /api/conversions/{job_id}/result`：

```json
{
  "job_id": "conv_001",
  "status": "succeeded",
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_artifact_id": "artifact_ifc_demo_001",
  "usdc_artifact_id": "artifact_usdc_demo_001",
  "source_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/source.ifc",
  "usdc_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc",
  "ifc_index_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/ifc_index.json",
  "usd_index_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/usd_index.json",
  "mapping_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/element_mapping.json"
}
```

### 12.3 更新 `_bim-control`

如果 `_bim-control` 有 API：

```txt
PATCH /api/model-versions/{model_version_id}/artifacts
```

或：

```txt
POST /api/model-versions/{model_version_id}/conversion-result
```

就回寫。

如果 `_bim-control` 尚無 API，先把 result JSON 存在：

```txt
_bim-control/data/conversion_results/{model_version_id}.json
```

但要在 README 註明這是 fallback。

---

## 13. Phase 8：端到端驗證

### 13.1 啟動 fake storage

```powershell
cd _s3_storage
python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

如果 `_s3_storage` 尚無 app，Codex 應先用簡單 static server 或 FastAPI StaticFiles 補齊。

### 13.2 啟動 fake bim-control

```powershell
cd _bim-control
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### 13.3 啟動 conversion service

```powershell
cd _conversion-service
python -m uvicorn app.main:app --host 127.0.0.1 --port 8003 --reload
```

### 13.4 建立 conversion job

```powershell
$body = @{
  project_id = "project_demo_001"
  model_version_id = "version_demo_001"
  source_artifact_id = "artifact_ifc_demo_001"
  source_url = "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/source.ifc"
  target_format = "usdc"
  options = @{
    force = $true
    generate_mapping = $true
    allow_fake_mapping = $false
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8003/api/conversions" `
  -ContentType "application/json" `
  -Body $body
```

### 13.5 查詢 job

```powershell
Invoke-RestMethod "http://localhost:8003/api/conversions/conv_001"
Invoke-RestMethod "http://localhost:8003/api/conversions/conv_001/result"
```

### 13.6 檢查輸出

確認：

```txt
- model.usdc exists
- ifc_index.json exists
- usd_index.json exists
- element_mapping.json exists
- result JSON 有 usdc_url
- result JSON 有 mapping_url
```

### 13.7 啟動 bim-streaming-server

```powershell
cd bim-streaming-server
.\repo.bat build
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

### 13.8 啟動 web-viewer-sample

```powershell
cd web-viewer-sample
npm install
npm run dev
```

### 13.9 手動 openStageRequest 驗證

在 web viewer 使用 conversion result 的：

```txt
usdc_url
```

送給 Kit：

```json
{
  "event_type": "openStageRequest",
  "payload": {
    "url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc"
  }
}
```

通過標準：

```txt
- Browser 看到 stream
- Kit 收到 openStageRequest
- Kit 回 openedStageResult
- 模型被載入
- getChildrenRequest 可以取得 stage tree
```

---

## 14. 測試規格

### 14.1 `_conversion-service` unit tests

必須新增：

```txt
tests/test_health.py
tests/test_conversion_api.py
tests/test_ifc_indexer.py
tests/test_mapping_builder.py
```

測試項目：

```txt
GET /health returns ok
POST /api/conversions returns job_id
GET /api/conversions/{job_id} returns status
mapping_builder exact GUID match works
mapping_builder no match does not invent mapping
```

### 14.2 integration smoke test

新增：

```txt
_conversion-service/scripts/smoke_conversion.ps1
```

內容：

```txt
1. call POST /api/conversions
2. poll job status
3. fetch result
4. assert usdc_url not empty
5. assert mapping_url not empty
6. download mapping_url
7. assert summary exists
```

### 14.3 manual streaming validation

新增文件：

```txt
_conversion-service/docs/manual-streaming-validation.md
```

包含：

```txt
- 如何啟動 fake services
- 如何啟動 conversion
- 如何啟動 bim-streaming-server
- 如何將 usdc_url 丟給 web-viewer-sample
```

---

## 15. 錯誤處理

### 15.1 conversion failed

job JSON 應包含：

```json
{
  "status": "failed",
  "stage": "converting_ifc_to_usdc",
  "error": {
    "code": "CONVERTER_PROCESS_FAILED",
    "message": "Kit converter exited with non-zero code",
    "details": {
      "exit_code": 1,
      "log_path": "data/logs/conv_001.log"
    }
  }
}
```

### 15.2 mapping failed

如果 USDC 成功但 mapping 失敗：

```txt
- 不要刪掉 USDC
- job 可標記 succeeded_with_warnings，或 status succeeded + warnings
- result 要包含 mapping_status = failed
```

第一版建議：

```json
{
  "status": "succeeded",
  "warnings": [
    {
      "code": "MAPPING_LOW_COVERAGE",
      "message": "Only 0 IFC elements matched USD prims. Check converter metadata preservation."
    }
  ]
}
```

### 15.3 storage publish failed

如果轉檔成功但發布到 `_s3_storage` 失敗：

```txt
status = failed
stage = publishing_outputs
```

---

## 16. 最小可接受結果

即使 mapping coverage 很低，第一版也可以通過，只要：

```txt
- .usdc 可以產生
- ifc_index.json 可以產生
- usd_index.json 可以產生
- element_mapping.json 可以產生
- mapping summary 誠實顯示 mapped_items / unmapped counts
- web viewer 可以載入 .usdc
```

不可接受：

```txt
- 沒有 USDC
- 沒有 mapping file
- mapping file 亂填假的 ifc_guid
- job failed 但 API 回 succeeded
- converter log 不可追蹤
```

---

## 17. Codex 執行順序總表

請 Codex 依序執行：

```txt
[x] 1. 讀取 root AGENTS.md，確認 repo 邊界
[x] 2. 檢查 git status，建立 feature branch
[x] 3. 檢查 bim-streaming-server 既有 converter script
[x] 4. 檢查 premake5.lua 是否註冊 converter app
[x] 5. 建立 _conversion-service FastAPI skeleton
[x] 6. 建立 conversion job model / job store
[x] 7. 建立 converter_runner.py，包裝 convert-ifc-to-usdc.ps1
[x] 8. 建立 ifc_indexer.py
[x] 9. 建立 bim-streaming-server/scripts/inspect-usd-stage.py
[x] 10. 建立 usd_indexer.py，透過 Kit 執行 inspect script
[x] 11. 建立 mapping_builder.py
[x] 12. 建立 result publishing 到 _s3_storage
[x] 13. 建立 optional 回寫 _bim-control 的 client
[x] 14. 新增 unit tests
[x] 15. 新增 smoke_conversion.ps1
[x] 16. 執行 pytest
[x] 17. 執行實際 conversion smoke test
[x] 18. 啟動 streaming server + web viewer 做 manual openStageRequest 驗證
[x] 19. 更新 README / docs
[x] 20. git diff 檢查
[x] 21. commit
```

2026-04-29 狀態註記：

```txt
- 第 2 項：本 workspace 已整併為 single root repo；本輪在 root main 工作樹檢查，不另建 feature branch。
- 第 9 項：實作檔名為 bim-streaming-server/scripts/inspect-usd-stage-and-quit.py，並由 _conversion-service/app/usd_indexer.py 呼叫。
- 第 18 項：已完成 streaming server build/test、headless runtime port 49100 smoke、web-viewer-sample build 與 dev server HTTP 200 smoke；並用真實 Chrome/Playwright browser session 手動切換 USD asset，確認 DataChannel 送出 `openStageRequest`。
- 第 21 項：本輪 review/session 對齊、browser E2E 驗證與文件驗收完成後，以 root repo commit 收斂。
```

---

## 18. 最後交付物

Codex 完成後應交付：

```txt
_conversion-service/
  app/*
  tests/*
  scripts/smoke_conversion.ps1
  docs/manual-streaming-validation.md
  README.md
  .env.example

bim-streaming-server/
  scripts/inspect-usd-stage.py
  scripts/inspect-usdc-to-json.ps1   # 若需要
  premake5.lua                       # 只有在缺 define_app 時修改

_s3_storage/
  static/projects/...                # smoke test fixture output，可選
  app/main.py                        # 若原本沒有 static file service

_bim-control/
  fake conversion result endpoint 或 data fallback

docs/contracts/conversion-api.md     # 若 root docs 存在
```

---

## 19. 最終驗收 Checklist

```txt
[x] GET http://localhost:8003/health 回 ok
[x] POST /api/conversions 可建立 job
[x] conversion job 可完成
[x] job log 可查看
[x] model.usdc 產出
[x] ifc_index.json 產出
[x] usd_index.json 產出
[x] element_mapping.json 產出
[x] mapping summary 正確
[x] _bim-control 可取得 usdc_url / mapping_url
[x] web-viewer-sample 可使用 usdc_url 發 openStageRequest
[x] bim-streaming-server 可載入該 USDC
[x] git status 乾淨或只剩使用者明確未提交檔案
```

2026-04-29 驗收證據：

```txt
- .\_conversion-service\scripts\smoke_conversion.ps1 -TimeoutSeconds 1800
  - job_id = conv_20260429082040_cc3bb971
  - status = succeeded, stage = done
  - model.usdc / ifc_index.json / usd_index.json / element_mapping.json 均可 HTTP HEAD 取得
  - mapping mapped_count = 0
  - mapping unmapped_ifc_count = 116934
  - mapping unmapped_usd_count = 10872
  - mapping fake_mapping_count = 0
- web-viewer-sample 已保留既有 openStageRequest flow，並新增 coordinator/_bim-control artifact bootstrap；npm run build 通過。
- bim-streaming-server 由 conversion smoke 的 USD indexer 透過 Kit 載入該 USDC；.\repo.bat build 與 .\repo.bat test 通過；headless streaming runtime 偵測到 49100 listening 且 app ready。
- 真實瀏覽器 E2E：Chrome/Playwright session 開啟 http://127.0.0.1:5173，建立 review session `review_session_b41fc1bb7047`，browser network 顯示 coordinator `POST /api/review-sessions`、`GET /stream-config`、`GET /review-bootstrap` 均為 200。
- 真實瀏覽器 DataChannel：console log 顯示手動切換 USD asset 後送出 `openStageRequest` 至 `C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/許良宇圖書館建築_2026.usdc`，再切回 conversion smoke 產出的 `http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/model.usdc`。
- 真實瀏覽器 highlight：點擊 issue button 後送出 `highlightPrimsRequest`，UI event log 顯示 `highlight requested: ISSUE-DEMO-001` 與 `highlight result: success`。
- 截圖證據：`output/playwright/browser-openstage-review-e2e.png`。
- git status 於本輪驗收 commit 後確認乾淨；`AGENTS.md` 已恢復 root 版，不保留簡化版。
```

---

## 20. 重要原則

```txt
轉檔 API 是 _conversion-service 的責任。
Kit converter 是 bim-streaming-server 提供的工具。
USDC 是 derived rendering artifact。
IFC 是 source of truth。
element_mapping 是後續法規、碳排、AI、3D highlight 的橋。
不要為了通過測試而製造假的 GUID mapping。
先做可驗證閉環，再做完整智能分析。
```
