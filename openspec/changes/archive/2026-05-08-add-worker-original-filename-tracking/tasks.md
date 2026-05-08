## 1. Preparation And Impact Review

- [x] 1.1 Re-read `_worker/app/store.py`、`_worker/app/main.py`、`_worker/app/models.py`、`_bim-control/app/main.py` 中跟 source artifact metadata、conversion result、callback 有關的程式碼，確認加欄位的最小改動面。
- [x] 1.2 Run GitNexus impact analysis for `create_source_artifact`、`complete_conversion_job`、`_post_bim_control_result`、`_update_artifacts_from_conversion`；確認 HIGH/CRITICAL 風險前回報。
- [x] 1.3 列出既有 `_worker/data/objects/_index/source_artifacts.json`、metadata.json fixture 是否含舊資料；確認向前相容讀取策略（`.get("original_filename", None)`）。
- [x] 1.4 確認 `ArtifactIntakeRequest.filename` 欄位本身已是 raw（未 sanitize），可以直接保存到 metadata 不需重做 decode。

## 2. Spec Deltas

- [x] 2.1 在 `openspec/changes/add-worker-original-filename-tracking/specs/worker-artifact-pipeline/spec.md` 新增 Requirement「Worker preserves original filename in source metadata」與其 scenarios。
- [x] 2.2 在 `openspec/changes/add-worker-original-filename-tracking/specs/worker-dev-ifc-source-selection/spec.md` 修改 Requirement「Start Conversion From Selected Source」，確保 response shape 必含 `original_filename`。
- [x] 2.3 Run `openspec validate add-worker-original-filename-tracking`。

## 3. `_worker` Source Artifact Metadata

- [x] 3.1 修改 `_worker/app/store.py` `create_source_artifact()` 的 metadata dict，加入 `original_filename: str = request.filename`（保留 raw，不經 `safe_filename`）。
- [x] 3.2 修改 `_worker/app/store.py` `_upsert_source_index()` 寫入 `_index/source_artifacts.json` 的 entry，加入 `original_filename`。
- [x] 3.3 修改 `_worker/app/store.py` `create_source_artifact()` 的 return dict，加入 `original_filename`。
- [x] 3.4 確認 `_worker/app/store.py` `complete_conversion_job()` 從 `source["metadata"]` 取得 `original_filename` 並寫進 result payload（給 callback 與 GET result 用）。

## 4. `_worker` API Response Shape

- [x] 4.1 修改 `_worker/app/main.py` `POST /api/artifacts` 的 response，確認 `original_filename` 在 response body（透過 `create_source_artifact` 的 return dict 自動帶出）。
- [x] 4.2 修改 `_worker/app/main.py` `POST /api/dev/ifc-sources/{source_id}/conversions` 的 response，加入 `original_filename`（從 `source_item["filename"]` 取，這是原 `relative_path` 對應的純檔名）。
- [x] 4.3 修改 `_worker/app/main.py` `GET /api/conversions/{id}/result` 透過 `complete_conversion_job` 自然帶出 `original_filename`，無需個別處理。

## 5. `_bim-control` Artifact Name Mapping

- [x] 5.1 修改 `_bim-control/app/main.py` `_update_artifacts_from_conversion()`：source IFC artifact upsert 時，`name` 欄位優先用 `result.get("original_filename")`，fallback 保留現有「原始 IFC」字串。
- [x] 5.2 USDC artifact 的 `name` 欄位保持現有「已轉換 USDC」（USDC 是 worker 自己生的衍生檔，不需要展示原檔名）。
- [x] 5.3 確認 `_bim-control` 沒有任何 schema validation 會擋掉 result payload 多帶的欄位（目前是 `dict[str, Any]` 接收，OK）。

## 6. Tests

- [x] 6.1 `_worker/tests/test_worker_api.py` 新增測試：上傳含中文檔名的 IFC，確認 metadata.json、`_index/source_artifacts.json`、API response 都含 `original_filename` 等於原檔名；disk filename 仍 sanitize。
- [x] 6.2 `_worker/tests/test_worker_api.py` 新增測試：selected-source conversion (dev IFC) 完成後，`GET /api/conversions/{id}/result` 包含 `original_filename`。
- [x] 6.3 `_worker/tests/test_worker_store.py` 補測 `create_source_artifact` 直接呼叫時 metadata 含 `original_filename`。
- [x] 6.4 `_bim-control/tests/test_conversion_results_api.py` 新增測試：POST conversion-result 含 `original_filename` 時，artifacts.json 的 source IFC entry `name` 欄位 = 原檔名；不含 `original_filename` 時 fallback 保持原行為。
- [x] 6.5 確認既有測試（無 `original_filename` 的舊 fixture）仍綠燈，驗證向前相容。
- [x] 6.6 `_worker/tests/test_worker_api.py` 新增真實 IFC bytes 的多筆 selected-source worker-adapter 測試：從 `C:\Repos\active\iot\AI-BIM-governance\storage` 複製至少兩筆 IFC 到測試 storage，確認每筆 conversion result 都保留 `original_filename` 且 source artifact / conversion job / object URL 彼此獨立。此測試驗證 worker metadata pipeline，不宣稱產物是 Kit-ready USDC。
- [x] 6.7 `_worker/tests/test_worker_api.py` 新增 opt-in 真實 Kit/HOOPS IFC -> USDC 多筆 smoke test：`WORKER_RUN_REAL_USDC_SMOKE=1` 時呼叫 `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`，並用 `inspect-usd-stage-and-quit.py` 驗證輸出的 `.usdc` 可由 USD stage 開啟且 `prim_count > 0`。

## 7. Documentation

- [x] 7.1 若 `docs/contracts/worker-api.md` 存在，補上 `original_filename` 欄位說明（位置：source artifact response、conversion result、callback payload）。
- [x] 7.2 `_worker/README.md` API 段落如有列 response 範例，補欄位（可選，不阻擋）。
- [x] 7.3 `_bim-control/README.md` 不需改（callback 接收端形狀不變，只是多接受一個欄位）。

## 8. Validation And Review

- [x] 8.1 `cd _worker && python -m pytest tests -q` 全綠。
- [x] 8.2 `cd _bim-control && python -m pytest tests -q` 全綠。
- [x] 8.3 Run `openspec validate add-worker-original-filename-tracking` 通過。
- [x] 8.4 GitNexus detect_changes 確認 affected scope 只在 `_worker` 與 `_bim-control` 範圍內。
- [x] 8.5 PR 描述列出向前相容性說明（既有資料 / 既有 callback 沒帶 `original_filename` 仍能運作）。
- [x] 8.6 Smoke：手動跑一次中文檔名 IFC 從 storage 進 worker、callback 到 `_bim-control` 的完整流程，確認 `_bim-control` artifact `name` 顯示原檔名。
- [x] 8.7 Real conversion smoke：手動跑兩筆真實 IFC 透過 Kit/HOOPS 轉成 Kit-openable USDC，輸出到 `C:\tmp\codex-real-usdc-smoke`，並用 `inspect-usd-stage-and-quit.py` 驗證兩筆 stage 皆可開啟且 `prim_count=10872`。
