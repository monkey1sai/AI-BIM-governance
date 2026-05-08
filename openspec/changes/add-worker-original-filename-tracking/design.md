## Context

`_worker` 目前會把 source artifact 的 on-disk filename 透過 `safe_filename()` sanitize，以避免路徑安全問題；但 metadata、source index、conversion result 與 callback payload 都沒有保留 raw filename。當檔名包含中文、空格或括號時，sanitize 後的 disk object key 無法可靠還原使用者原始檔名。

這次變更跨 `_worker` 與 `_bim-control`。`_worker` 仍是檔案本體與轉檔結果的 source of truth，`_bim-control` 仍是 fake BIM artifact metadata 的 authority。新增欄位只在 metadata / API payload 層流動，不改 disk path、防護邏輯、artifact id 或轉檔流程。

## Goals / Non-Goals

**Goals:**

- 在 `_worker` source artifact metadata、source index、API response、conversion result 與 `_bim-control` callback payload 中保留 raw `original_filename`。
- 讓 `_bim-control` 在 callback 帶有 `original_filename` 時，把 source IFC artifact `name` 顯示為原始檔名。
- 保持向前相容：舊 metadata / callback payload 沒有 `original_filename` 時仍可讀取並保留既有 fallback。

**Non-Goals:**

- 不修改 `safe_filename()` 與 on-disk object key 命名規則。
- 不更動 `source_id`、artifact id、artifact group id 或 conversion job id 的計算方式。
- 不搬移或重新命名既有落地檔案。
- 不要求 `web-viewer-sample`、`bim-review-coordinator` 或 `bim-streaming-server` 同步改 UI / runtime 行為。

## Decisions

- **保留 raw filename 作為 additive metadata 欄位。**
  選擇在 `metadata.json`、`_index/source_artifacts.json`、API response 與 conversion result 中加入 `original_filename`，而不是改 disk filename。這讓 traceability 回來，同時不降低 path safety。

- **由 `_worker` result payload 自然承載 callback 欄位。**
  `_post_bim_control_result()` 已直接 post conversion result dict，因此不新增 callback 專用轉換層，避免讓 `_worker` 產生第二份 payload contract。

- **`_bim-control` 只在欄位存在時使用原檔名。**
  Source IFC artifact `name` 使用 `result.get("original_filename") or "原始 IFC"`，保留舊 callback 與 legacy fixture 的 fallback 行為。USDC artifact name 維持「已轉換 USDC」，因為它是 worker 產生的衍生 artifact，不代表原始上傳檔名。

## Risks / Trade-offs

- **[Risk] Payload 多一個欄位造成下游 shape 差異。**
  Mitigation: 這是 additive 欄位，既有 consumer 若忽略未知欄位仍能運作；`_bim-control` callback endpoint 以 `dict[str, Any]` 接收。

- **[Risk] Legacy source index 沒有 `original_filename`。**
  Mitigation: 讀取端使用 `.get("original_filename")`；缺欄位時 conversion result 會保留 `None` / fallback，不拒絕舊 artifact。

- **[Risk] 原檔名可能包含特殊字元。**
  Mitigation: 原檔名只存 metadata 與 JSON response，不用來組合 filesystem path；disk object key 仍使用 sanitized filename。

- **[Risk] 把 worker adapter smoke 誤認為真實 IFC -> USDC 轉檔驗證。**
  Mitigation: `_worker` 預設 adapter 產物只驗證 metadata pipeline，不視為 Kit-ready USDC。真實轉檔驗證必須呼叫 `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1` 的 Kit/HOOPS converter，並用 `inspect-usd-stage-and-quit.py` 檢查輸出的 `.usdc` 可由 USD stage 開啟且 `prim_count > 0`。

## Migration Plan

這是 additive metadata 變更，不需要 migration。新 artifact 會開始寫入 `original_filename`；舊 artifact 沒有此欄位時照原本 fallback 行為運作。

Rollback 時可移除 `_worker` 寫入 / 回傳 `original_filename` 的變更與 `_bim-control` name mapping 變更；已寫入的額外 JSON 欄位可被舊程式忽略。

## Open Questions

- PR 建立時需在描述中明確列出向前相容性：既有 metadata 與 callback payload 未帶 `original_filename` 時仍可運作。
