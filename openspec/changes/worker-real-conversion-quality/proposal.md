## Why

`_worker` 目前的 conversion job 會產出 `# worker adapter USDC placeholder` 與 fake `element_mapping.json`，因此既有 review session 雖可走完 API 閉環，仍不能證明 IFC 真的可轉成 Kit 可載入的 USDC。roadmap 已把這點標為 Phase 1 紅星 blocker；若不先解除，後續 multi-Kit、OVAS、viewer highlight 與 SaaS 能力都會建立在 placeholder evidence 上。

## What Changes

- 將 `_worker` 的 IFC→USDC conversion 從 placeholder output 升級為可驗證的真實 conversion pipeline。
- 要求 conversion result 的 `model.usdc` 必須可被 USD/Kit stage 開啟，不能只是文字 placeholder 或空檔。
- 要求 `ifc_index.json`、`usd_index.json`、`element_mapping.json` 由真實 source IFC 與轉檔後 USD stage 推導，並帶 mapping coverage report / quality metrics。
- `element_mapping.json` 第一版即支援 one IFC GUID 對多個 USD prim path；`primary_usd_prim_path` 作為 canonical UI / highlight / focus 主路徑，`usd_prim_path` 保留為 current viewer-compatible alias，`usd_prim_paths` 保留完整映射。
- P0 採 measure-first policy：mapping coverage 必須輸出 report，但不因 coverage 未達門檻而 fail CI；baseline 穩定後再鎖最低門檻。
- 要求 conversion job 在 converter 不可用、conversion 失敗、或 USDC 無法開啟時誠實標為 `failed` 或非 ready，不得發布 ready placeholder artifact group。
- 建立 large IFC / mapping coverage report / single Kit render evidence 的驗證紀錄，讓 runtime evidence 能區分「API flow 成功」與「真實幾何可渲染」。
- 非目標：不新增 viewer UI、不改 coordinator session lifecycle、不改 `_bim-control` 資料權威、不處理 OVAS / K8s / multi-tenant / billing。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `worker-artifact-pipeline`: conversion result 必須由真實 IFC→USDC pipeline 產出，並記錄真實 mapping coverage 與 quality metrics。
- `runtime-verification-evidence`: single Kit / large IFC evidence 必須納入真實 conversion output、USD stage 可開啟性與 mapping coverage，不得把 placeholder artifact 當成 render evidence。

## Impact

- `_worker`: 主要影響 `complete_conversion_job()` 所在的 conversion pipeline、derived artifact 寫入、quality metadata、failure reporting、以及對應 tests。
- `bim-streaming-server`: 不作為 conversion authority；只在驗證階段用於開啟 `_worker` 產出的 USDC 並提供 browser/Kit evidence。
- `_bim-control`: 不保存檔案本體，不接管 conversion；只接收 `_worker` 發布的 artifact metadata / conversion result metadata。
- `bim-review-coordinator` / `web-viewer-sample`: 本 change 不改 session 或 UI contract；後續只消費既有 artifact URLs。
- 依賴風險：Omniverse / HOOPS / CAD Converter 不納入 repo-local install；其定位是 external prerequisite + smoke fallback。實作階段必須先評估 converter 選型、license、Windows 可用性、RAM / disk footprint，任何新增 production dependency 都要在實作 PR 中明確說明。
