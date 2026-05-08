## Why

`_worker` 在收到 source artifact 時，會用 `SAFE_FILENAME_RE` 把非 ASCII 字元（中文、空格、括號、連字符）全部換成 `_`，再 `.strip("._")` 把開頭/結尾的底線清掉。對於常見的中文檔名 `許良宇圖書館建築_2026.ifc`，落地檔名變成 `54d77fe1_2026.ifc`（只剩 sha256 prefix + `2026.ifc`），原始檔名完全消失。

更嚴重的是 `_worker` 寫入 source artifact `metadata.json` 時、寫入 `_index/source_artifacts.json` 時、以及 callback 給 `_bim-control` 的 conversion-result payload 中，**都不包含原檔名欄位**。也就是說：sanitize 之後再也找不回「這個 artifact 對應的原始 IFC 檔本來叫什麼」。

`_bim-control` 在 `_update_artifacts_from_conversion` 中接收 callback 時，artifact 的 `name` 欄位寫死成「原始 IFC」/「已轉換 USDC」，不會反映實際檔名。

實機驗證：13 個 89 MB 的中文檔名 IFC 副本（`許良宇圖書館建築_2026 - 複製 (N).ifc`）跑進 `_worker` 後，所有 disk 落地檔名都會變成形如 `<sha8>_<某個 ASCII 殘片>.ifc`，從 disk 與 `_bim-control` 都無法分辨哪個 artifact 對應原檔的第幾份副本。

這次 change 在 metadata 層補上 `original_filename` 欄位，讓檔名 traceability 不會因為 sanitize 而斷裂；disk 檔名仍然 sanitize（保留 path 安全），但語意層保留原檔名。

## What Changes

- 在 `_worker` source artifact `metadata.json` 加入 `original_filename` 欄位，保留 `ArtifactIntakeRequest.filename` 的 raw 值（未 sanitize）。
- 在 `_worker/data/objects/_index/source_artifacts.json` 每筆 entry 中也加入 `original_filename`，方便不開啟 metadata.json 也能查。
- `POST /api/artifacts` response 多回 `original_filename`。
- `POST /api/dev/ifc-sources/{source_id}/conversions` response 多回 `original_filename`（從 dev source 直接帶上原 `relative_path` 對應的檔名）。
- `_worker` 完成轉檔後產出的 `result` payload（給 `GET /api/conversions/{id}/result`，以及 callback 給 `_bim-control`）多回 `original_filename`。
- `_bim-control._update_artifacts_from_conversion` 收到 `original_filename` 時，將 source IFC artifact 的 `name` 欄位設為原檔名（沒帶就保留原本寫死的 fallback，向前相容）。
- 既有 metadata.json / source_artifacts.json 沒有 `original_filename` 欄位的舊資料仍可正常讀取（讀取端用 `.get(...)` 容錯）。
- 非目標：不改 disk 檔名 sanitize 邏輯、不改 `source_id` 計算公式、不改 path traversal 防護、不改 artifact ID schema、不做 disk 既有檔案的改名／移轉。

## Capabilities

### Modified Capabilities

- `worker-artifact-pipeline`: 新增 Requirement「Worker preserves original filename in source metadata」，要求 source artifact metadata、`_index` 條目與 callback payload 都帶 `original_filename`。
- `worker-dev-ifc-source-selection`: 修改 Requirement「Start Conversion From Selected Source」，把 selected-source conversion response 與後續 result／callback 都納入「必含 `original_filename`」的 scenario。

### New Capabilities

- 無。

## Impact

- `_worker`: 修改 [_worker/app/store.py](_worker/app/store.py) 的 `create_source_artifact` 與 `complete_conversion_job`：metadata dict 新增 `original_filename`、result payload 帶 `original_filename`、`_index/source_artifacts.json` 條目加欄位。修改 [_worker/app/main.py](_worker/app/main.py) 的兩個 conversion endpoint response 形狀。callback `_post_bim_control_result` 不需改（payload 已是 result dict）。新增 / 擴充 `_worker/tests/test_worker_api.py` 對應測試。
- `_bim-control`: 修改 [_bim-control/app/main.py](_bim-control/app/main.py) `_update_artifacts_from_conversion`：當 result 包含 `original_filename` 時，設定 source IFC artifact 的 `name` 欄位為原檔名。新增 / 擴充 `_bim-control/tests/test_conversion_results_api.py` 對應測試。
- `web-viewer-sample` / `bim-review-coordinator` / `bim-streaming-server`: 不需修改。`original_filename` 是 metadata 層的純加欄位，下游消費端可選擇是否使用。
- 文件: `docs/contracts/worker-api.md`（如存在）需補上 `original_filename` 欄位說明。
- 向前相容: 既有測試 fixture、archived spec、已落地的 `_worker/data/objects/...` 檔案結構不需改動。新欄位是 additive。
