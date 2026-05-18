## MODIFIED Requirements

### Requirement: Single Kit render evidence uses streaming-owned conversion artifacts

Single Kit render evidence MUST 使用 `bim-streaming-server` internal-only 轉檔產出的 artifacts 來驗證從 IFC source 到 browser viewport 的 review-session path（B 方案：`_worker` 已自 repo 刪除，對外入口為 `bim-review-coordinator` `POST /api/external/ifc-ready`，轉檔權威為 `bim-streaming-server`）。Evidence 必須包含 `conversion_job_id` 與 `external_model_version_id` binding，讓 rendered stage 可追溯回 source IFC（`source_ifc_ref`/`source_ifc_etag`）。

Visual preview step 必須使用既有 `web-viewer-sample` + `bim-review-coordinator` + `bim-streaming-server` path 載入 streaming-produced `model.usdc`；不得要求任何已刪除的 `_worker`/`_bim-control` 服務，也不得要求 `bim-review-coordinator` 在本地 parse 或 render USD/USDC。重量模型檔只在客戶落地端流動；雲端僅收 metadata-only callback。

#### Scenario: Streaming-owned artifact 在 browser render

- **WHEN** valid IFC 經外部落地端 IFC Worker → `bim-review-coordinator` `POST /api/external/ifc-ready` intake → `bim-streaming-server` internal conversion 產出、經 coordinator routing、由 `bim-streaming-server` 載入，並顯示在 `web-viewer-sample`
- **THEN** evidence 記錄 source IFC identity（`source_ifc_ref`/`etag`）、`conversion_job_id`、`external_model_version_id`、`model.usdc` 參照、mapping 參照、`openedStageResult`、非零 video dimensions，以及 viewport screenshot 或等效 visual proof
- **AND** evidence 記錄 `conversion_authority="bim-streaming-server"`，且不得宣稱任何 `_worker`-hosted artifact

#### Scenario: Kit 或 GPU prerequisite 不可用

- **WHEN** internal conversion 成功，但目前環境無法執行 Kit/GPU/browser verification（含 runtime image Linux Kit launcher 的 NVIDIA graphics/Vulkan/GPU/Kit license 阻塞）
- **THEN** evidence 分別記錄 conversion success，並將 single Kit render evidence 標為 `blocked` 或 `deferred`，同時列出 missing runtime prerequisite
- **AND** `deferred` MUST NOT 被報為 `passed`，且 host-local Kit MUST NOT 充當 substitute pass

#### Scenario: Conversion passed 但 visual preview blocked

- **WHEN** internal conversion 成功，但 `web-viewer-sample`、coordinator、Kit runtime、WebRTC、GPU 或 browser automation 不可用
- **THEN** evidence 將 conversion result 與 visual preview 分層記錄，將 visual preview 標為 `blocked`，且不得宣稱 converted USDC 已在 web UI 被 visually inspected

#### Scenario: Cloud callback delivery is layered separately

- **WHEN** internal conversion 成功並產出 metadata，但公司雲端 callback endpoint 不可達（OQ1 pending）
- **THEN** evidence 將 `cloud_callback_outbox` 與 conversion / render 分層記錄，記 retry / `dead_letter` 狀態，且 conversion / render evidence 不因 callback 未送達而被否定
