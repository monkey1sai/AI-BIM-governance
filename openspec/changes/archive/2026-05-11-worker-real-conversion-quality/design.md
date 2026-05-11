## Context

目前 `_worker/app/store.py` 的 `complete_conversion_job()` 會直接寫入 placeholder `model.usdc`，並產生只有一筆 fake mapping 的 `element_mapping.json`。這讓 `_worker`、`_bim-control`、coordinator、viewer 的 API 閉環可以成立，但不能證明真實 IFC 幾何已轉成 Omniverse / USD runtime 可用的資料。

roadmap 將此列為 `worker-real-conversion-quality` P0 候選：優先解除 IFC→USDC placeholder blocker，並把 mapping coverage 從約 0.7% 的示範狀態提升成可支撐 issue → prim highlight 的品質基線。

## Goals / Non-Goals

**Goals:**

- `_worker` 對 IFC source artifact 產生真實、可開啟的 `model.usdc`。
- `_worker` 產生由真實 source / USD stage 推導的 `ifc_index.json`、`usd_index.json`、`element_mapping.json`，且 mapping schema 第一版支援 one IFC GUID 對多個 USD prim path。
- conversion result 回報 quality metrics，例如 source IFC element count、USD prim count、mapped count、coverage ratio、unmapped counts、converter identity、duration。
- artifact group readiness 必須受 real conversion 與 hard quality gate 約束；失敗時誠實保留 failed / not ready 狀態。
- P0 採 measure-first policy：coverage 必須輸出 report，但不因 coverage 未達門檻而 fail CI；baseline 穩定後再鎖最低門檻。
- 驗證分層：unit/API tests 先保護 contract，再用 opt-in real converter smoke，最後才宣稱 single Kit render evidence。

**Non-Goals:**

- 不把 `_worker` 變成 project / issue / annotation 資料權威。
- 不把 `bim-streaming-server` 納入 `_worker` runtime dependency；Kit 可以用於驗證，但 conversion ownership 仍在 `_worker`。
- 不改 `bim-review-coordinator` 的 session lifecycle 或 `web-viewer-sample` 的 UI contract。
- 不在此 change 處理 OVAS、multi-Kit scheduling、tenant RBAC、billing、production storage migration。
- 不保證 Revit / RVT / DWG 轉檔；本 change 的主軸是 IFC→USDC。
- 不把 Omniverse / HOOPS / CAD Converter 安裝納入 repo-local install；這些工具只作 external prerequisite 與 smoke fallback。

## Decisions

### 1. 先定義 converter adapter contract，再選實際 converter

`_worker` 應新增內部 converter adapter 邊界，輸入為 source IFC object path 與 job context，輸出為 USDC、IFC index、USD index、element mapping、quality metrics 與 warnings。第一版正式 converter 選型採 adapter contract 優先；Omniverse / HOOPS / CAD Converter 不納入 repo-local install，只定位為 external prerequisite + smoke fallback。實作階段可比較 IfcOpenShell、既有 Kit/HOOPS smoke、Speckle 或其他候選，但不得讓產品 contract 綁死某個本機腳本路徑。

替代方案：直接從 `_worker` 呼叫 `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`。這可作為 smoke / spike，但不適合作為長期 contract，因為它會把 worker 的 conversion ownership 綁到 Kit repo 與本機 GPU/SDK 條件。

### 2. `ready` 只能代表真實 artifact 可用

當 converter 無法執行或 USDC 無法被 USD stage 開啟時，conversion job 必須標為 `failed` 或 artifact group 保持非 ready。`_worker` 不得建立看似成功的 placeholder artifact 來讓後續流程誤判。P0 階段 mapping coverage 是必填 report，不是 hard gate；coverage 低時仍可讓 real conversion artifact 通過 API / render smoke，但不得宣稱 issue-to-prim highlight coverage 已達 production baseline。

替代方案：保留 placeholder 作為 fallback。這會污染 runtime verification evidence，且會讓 issue highlight / mapping coverage 的風險延後暴露，因此只允許在單元測試 fixture 或明確標記的 mock mode 中使用。

### 3. Mapping coverage 採 measure-first policy

第一版必須記錄 coverage ratio，而不是宣稱 100% IFC GUID ↔ USD prim path 對映。P0 不以 coverage fail CI，但每次 real conversion smoke 必須輸出 coverage report。baseline 穩定後，才把最低門檻寫入 tests / evidence，並讓門檻成為正式 quality gate。

替代方案：不設門檻，只輸出 mapping 檔。這會讓 demo 仍可能在 issue → real prim highlight 時失敗，因此不採用。

### 4. Mapping schema 第一版支援 one-to-many

`element_mapping.json` 第一版即支援 one IFC GUID 對多個 USD prim path。每筆 mapping 應提供 `ifc_guid`、`usd_prim_path`、`primary_usd_prim_path`、`usd_prim_paths`、`mapping_method`、`mapping_confidence` 與可選 diagnostics。`primary_usd_prim_path` 是 canonical UI / highlight / focus 主路徑；`usd_prim_path` 是目前 viewer-compatible alias，避免在不改 `web-viewer-sample` UI contract 的情況下破壞現有 DataChannel command；`usd_prim_paths` 保留完整映射，供後續 multi-part highlight、debug 與 coverage 分析使用。

PR review follow-up: mapping coverage must count only prims that can be traced
back to a real source IFC `GlobalId` present in the source index. Converter-side
fallback ids such as `shape_123` may be used for USD prim path uniqueness or
diagnostics, but they are not reliable IFC GUIDs and must not increment
`mapped_count`, `coverage_ratio`, or real mapping readiness.

替代方案：第一版只輸出單一 `usd_prim_path`。這會讓牆、樓板、族群或被 converter 拆分的 IFC 元件遺失完整映射，後續再補會破壞 schema 相容性，因此不採用。

### 5. Evidence 不跨越 repo 邊界

`runtime-verification-evidence` 只描述如何證明 `_worker` 產物能被 Kit/browser 使用。它不要求 `bim-streaming-server` 產生檔案，也不要求 viewer 決定轉檔成敗。檔案本體與 conversion result 仍由 `_worker` 負責，review metadata 仍由 `_bim-control` 負責，streaming/runtime 操作仍由 `bim-streaming-server` 負責。

## Risks / Trade-offs

- [Converter dependency risk] 新增 IfcOpenShell / USD / Kit converter 可能帶來安裝、license、Windows 路徑與版本風險。緩解：先做 adapter spike，記錄 license 與 external prerequisite；Omniverse / HOOPS / CAD Converter 不納入 repo-local install。
- [Performance risk] 89 MB 到 500 MB IFC 可能造成高 RAM / disk 峰值。緩解：quality evidence 必須記錄 duration、fixture size、process / memory observation when available。
- [Coverage drift risk] P0 不用 coverage fail CI 可能讓低 coverage 暫時通過。緩解：每次 smoke 必須輸出 coverage report，baseline 穩定後再鎖最低門檻。
- [Mapping correctness risk] IFC GUID 可能在轉檔後遺失、被拆成多個 prim、或 converter shape 缺少可回溯的 source `GlobalId`。緩解：mapping schema 第一版即支援 `usd_prim_path` alias、`primary_usd_prim_path` + `usd_prim_paths`，並保留 confidence、unmapped reason 與 diagnostics；fallback / synthetic ids 不得計入 real mapping coverage。
- [Environment risk] Kit/GPU 不一定在所有環境可用。緩解：unit/API tests 不依賴 GPU；real converter smoke 與 browser viewport evidence 可用 opt-in 或 blocked 記錄。

## Migration Plan

1. 保留既有 API paths：`POST /api/conversions`、`GET /api/conversions/{id}`、`GET /api/conversions/{id}/result`。
2. 在 result payload additive 增加 quality metrics / converter metadata；既有 consumer 可忽略新欄位。
3. 實作期間允許 mock / placeholder test fixtures，但 production conversion path 不得把 placeholder 標成 ready。
4. 若 converter 選型不可行，回滾方式是保留現有 API contract，將 real conversion requirement 標為 blocked，並在 evidence 中記錄缺少的 external prerequisite / license / runtime prerequisite。

## Resolved Questions

- 第一版正式 converter 選型採 adapter contract 優先；Omniverse / HOOPS / CAD Converter 僅作 external prerequisite + smoke fallback，不納入 repo-local install。
- 89 MB repo-local IFC fixture 的 mapping coverage 初期採 measure-first policy；P0 不以 coverage fail CI，但必須輸出 coverage report。
- baseline 穩定後再鎖最低 coverage 門檻，並把門檻提升成正式 quality gate。
- `element_mapping.json` 第一版即支援 one IFC GUID → many USD prim paths。
- `primary_usd_prim_path` 作為 canonical UI / highlight / focus 主路徑，`usd_prim_path` 保留為 current viewer-compatible alias，`usd_prim_paths` 保留完整映射。
- fallback / synthetic shape id 不得當成 source IFC `GlobalId`，也不得計入 real mapping coverage。
