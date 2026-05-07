## Context

現有文件已定義 `_bim-control` 是 fake BIM metadata / review data authority、`_s3_storage` 是 fake file storage、`_conversion-service` 是 IFC -> USDC conversion API、`bim-review-coordinator` 是 session / collaboration control plane、`bim-streaming-server` 是 Kit / USD runtime、`web-viewer-sample` 是 browser client。新的架構圖要求把檔案本體與轉檔責任收斂成 `_worker`，同時把 review session 建立流程改成從 `_bim-control` 的 review intent 開始，再由 coordinator 分配 Kit instance 並回寫 binding。

這是跨 repo / folder 的控制面調整，不應一次把所有既有 demo endpoint 切掉。最小安全路徑是先建立 `_worker` 對外 contract 與 adapter / alias，保留既有 `_s3_storage` 與 `_conversion-service` 可運行能力，再逐步讓 `_bim-control`、coordinator、viewer 轉向新 contract。

### Source of Truth

| Data / state | Owner | Notes |
|---|---|---|
| 原始 IFC/RVT/DWG bytes | `_worker` object layer | 初期可由既有 `_s3_storage` 實作，但對外由 `_worker` contract 承擔 |
| 衍生 USDC、index、mapping files | `_worker` object layer | 包含 `model.usdc`、`ifc_index.json`、`usd_index.json`、`element_mapping.json` |
| artifact metadata / artifact group metadata | `_bim-control` | `_worker` 可回報結果，但不成為 BIM metadata authority |
| review intent / request status | `_bim-control` | `ReviewSessionRequest` 是 session 建立前的可追蹤入口 |
| review session lifecycle / bindings | `bim-review-coordinator` + `_bim-control` mirror | coordinator 控制 runtime session；`_bim-control` 保存 request binding 與審查資料關聯 |
| Kit instance lease / pool state | `bim-review-coordinator` | GPU / Kit allocation 不落到 web viewer 或 `_bim-control` |
| USD runtime state / viewport / selection execution | `bim-streaming-server` | 只處理當前 runtime，不保存業務資料 |
| browser UI state | `web-viewer-sample` | 不保存資料權威，不硬編模型路徑 |

## Goals / Non-Goals

**Goals:**

- 建立 `_worker` contract：artifact upload、conversion job、object URL、conversion lineage 與 versioned object layout。
- 在 `_bim-control` 新增 review-session-request intent，讓「我要開審查 session」成為可保存、可查詢、可回寫的資料模型。
- 在 coordinator 新增 session lifecycle、artifact bindings、Kit instance bindings 與 KitInstancePool allocation / release flow。
- 支援同一 review session 綁定多個 artifact group，並依 routing policy 使用同一 Kit instance、dedicated instance 或多 instance。
- 讓 web viewer 以 review request / session 啟動，而不是直接依本地模型 URL 或固定 stream config 啟動。
- 保持 `_worker`、metadata、session、runtime、UI 邊界分離，並保留可分階段驗證路徑。

**Non-Goals:**

- 不把 `_bim-control` 改成檔案儲存或轉檔服務。
- 不把 `bim-review-coordinator` 改成 USD stage loader 或 renderer。
- 不把 `bim-streaming-server` 改成 project / artifact / annotation 資料庫。
- 不要求本階段完成真實雲端 storage、真實 GPU autoscaling、SSO、租戶計費、正式 BIM platform 權限模型。
- 不要求一次移除既有 `_s3_storage`、`_conversion-service` demo endpoint；初期應保留 adapter / alias。

## Decisions

### 1. Introduce `_worker` as the external file + conversion boundary

`_worker` 對外承擔 `POST /api/artifacts`、`POST /api/conversions`、conversion result 與 `GET /objects/*`。初期可以包裝或搬入既有 `_s3_storage` 與 `_conversion-service` 程式能力，但呼叫端只應依賴 `_worker` contract。

Alternative considered: 只把 `_conversion-service` 接到 `_s3_storage`。這會延續「file bytes 與轉檔 job 分散」的 PoC 邊界，難以追蹤 artifact lineage 與版本化 object layout。

### 2. Keep `_bim-control` as metadata authority, not file authority

`_bim-control` 保存 artifact metadata、artifact group metadata、review intent、session binding 與 lifecycle event reference。`_worker` 成功或失敗時回報 metadata / URL / lineage；大型 bytes 與 derived files 不進 `_bim-control`。

Alternative considered: 由 `_worker` 直接建立 review session。這會讓轉檔 worker 越界成 BIM review workflow authority。

### 3. Add ReviewSessionRequest before coordinator session creation

使用者或 portal 先呼叫 `_bim-control` 的 `POST /api/review-session-requests`，保存 `model_version_id`、`artifact_group_ids`、`selected_artifact_ids`、`startup_policy` 與 `kit_profile`。之後 `_bim-control` 或 worker/coordinator adapter 檢查 artifacts 是否 ready，再呼叫 coordinator `POST /api/review-sessions`。

Alternative considered: web viewer 直接呼叫 coordinator 建 session。這缺少 review intent 的可追蹤資料，也難以在 artifact missing、conversion blocked、GPU queued 等狀態下回寫原因。

### 4. Model session lifecycle explicitly

Review session status 使用 `created | active | closing | closed | failed`。Kit instance binding 使用 `allocated | starting | ready | draining | released`。`closed` 不代表 GPU 已釋放；必須等所有 `kit_instance_bindings[].status=released` 才算 instance released。

Alternative considered: 保留 `active | closed`。這不足以描述等待 Kit、關閉中、保存 annotation/snapshot、釋放 GPU slot 等中間狀態。

### 5. Treat session as collaboration space, not a single Kit instance

`artifact_bindings[]` 描述 session 要載入哪些 artifact group 與 load order；`kit_instance_bindings[]` 描述它們被配置到哪些 Kit instance。Routing policy 初期支援 `same_instance` 與 `dedicated_instance`，並保留 `shared_state` 作為跨 instance selection / issue focus 同步語意。

Alternative considered: 一個 session 固定一台 Kit。這對小模型成本低，但無法支援大型模型、租戶隔離或多 GPU 拓撲。

### 6. Preserve DataChannel runtime honesty

`bim-streaming-server` 可以擴充 `openStageRequest` 或新增 optional `loadArtifactGroupRequest` 支援 load order / overlay，但結果必須回報 `missing_paths`、`fallback_paths`、`applied_mode`。Runtime fallback 只能證明串流通，不可被當成 mapping correctness。

Alternative considered: viewer 自行推測或吞掉 missing prim。這會讓 review issue 視覺化與 mapping correctness 失真。

## Risks / Trade-offs

- `_worker` 名稱與既有 `_conversion-service` / `_s3_storage` 並存期間容易混淆 -> 文件與 API contract 先宣告 `_worker` 是新對外邊界，舊服務只作 adapter / compatibility layer。
- 多 repo 一次落地風險高 -> 分 phase 實作：worker API-only、metadata intent、coordinator lifecycle、viewer/runtime。
- GPU / Kit 在部分環境無法跑 -> API-only 與 coordinator tests 可先完成；streaming multi-artifact 驗證標記為需要 Windows + NVIDIA GPU + Kit SDK。
- Session lifecycle 與 request status 可能重複 -> request status 表達 business intent progress，session lifecycle 表達 runtime collaboration room progress，兩者以 binding event 關聯。
- 多 instance collaboration 會增加 Socket.IO 狀態同步複雜度 -> 初期只同步 presence、selection、issue focus、annotation event，不同步 video frame 或 USD internal state。

## Migration Plan

1. Phase 1: 建立 `_worker` adapter contract，先包住既有 `_s3_storage` 與 `_conversion-service` 能力，保留舊 demo endpoint 與 URL 形狀。
2. Phase 2: `_bim-control` 新增 `ReviewSessionRequest`、artifact group metadata、request status / binding persistence，並以 `_worker` result 更新 artifact metadata。
3. Phase 3: `bim-review-coordinator` 新增 lifecycle transition API、`artifact_bindings[]`、`kit_instance_bindings[]`、KitInstancePool allocation / release。
4. Phase 4: `web-viewer-sample` 改成 session-first bootstrap；`bim-streaming-server` 支援 artifact load order / overlay contract。
5. Rollback: 保留既有 `POST /api/conversions`、static object URL 與 current review session flow adapter；若新流程失敗，demo 可以退回舊 session bootstrap 與單 artifact stream config。

## Open Questions

- `_worker` 是否直接取代 `_s3_storage` / `_conversion-service` folder，或先新增 `_worker` facade 並保留兩者作內部 modules？
- `ReviewSessionRequest` 由 `_bim-control` 主動呼叫 coordinator，還是由 coordinator 拉取 request 建 session？
- `artifact_group_id` 的生成規則要由 `_bim-control` 決定，還是由 `_worker` 建立後 callback？
- 多 instance 的 stream config 回傳 shape 是單一 primary stream 加 bindings，還是每個 binding 都有獨立 stream endpoint？
- 真實 SaaS 階段的 tenant isolation / GPU quota 是否需要在本 change 之外另開 OpenSpec？
