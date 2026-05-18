## REMOVED Requirements

> **共同理由**：B 方案（cloud-edge separation）下 `_worker` 已自 repo 刪除（非降級，BREAKING）。「`_worker` 作為 artifact + conversion facade」整體不再是本 repo 的核心 runtime / 產品能力：原始模型檔與重量資料屬**外部客戶落地端**；IFC→USDC 轉檔權威收斂於 `bim-streaming-server`（internal-only，spec `streaming-ifc-usdc-conversion-authority`）；對外入口收斂於 `bim-review-coordinator` `POST /api/external/ifc-ready`（spec `local-coordinator-ifc-ready-intake-boundary`）；本地僅保留最小 shadow metadata（spec `local-artifact-shadow-metadata`），artifact 結果以 metadata-only callback 回拋公司雲端（spec `external-cloud-callback-lifecycle`）。`_worker` 行為僅由 `tests/fakes` + `tests/contracts` 模擬（design D4：test fixture，非 runtime profile）。下列每條 requirement 均依此理由移除。

### Requirement: Worker accepts source artifacts
**Reason**: `_worker` 已刪除；source artifact intake 屬外部落地端 IFC Worker，本 repo 對外入口為 coordinator `POST /api/external/ifc-ready`。

### Requirement: Worker manages conversion jobs
**Reason**: conversion job 權威收斂至 `bim-streaming-server`（internal-only，由 coordinator internal request 觸發）。

### Requirement: Worker publishes derived artifact results
**Reason**: 衍生 artifact 結果改由 streaming 產出、coordinator 以 metadata-only callback 回拋公司雲端（outbox）。

### Requirement: Worker uses versioned object layout
**Reason**: `_worker` object layer 已刪除；重量檔案儲存屬外部客戶落地端，不在本 repo 範圍。

### Requirement: Worker reports metadata without taking BIM authority
**Reason**: metadata 權威切分改為公司雲端 control-plane / 本 repo data-plane（最小 shadow），不再經 `_worker`→`_bim-control`。

### Requirement: Worker preserves original filename in source metadata
**Reason**: source 檔案 metadata 屬外部 IFC Worker / 公司雲端 control-plane；本地僅保留 `source_ifc_ref`/`source_ifc_etag` 最小 shadow。

### Requirement: Worker produces real IFC conversion artifacts
**Reason**: 真實 IFC→USDC 轉檔由 `bim-streaming-server` internal conversion 承接，不再屬 `_worker`。

### Requirement: Worker derives indices and mapping from real conversion output
**Reason**: index / element_mapping 由 streaming 轉檔核心產出（不重寫），非 `_worker`。

### Requirement: Worker reports conversion quality before enforcing coverage gates
**Reason**: 轉檔品質把關屬 `bim-streaming-server`（`_assert_publishable_outputs` 等），不再屬 `_worker`。

### Requirement: Worker optimizes non-renderable entity materialization for canonical IFC fixtures
**Reason**: 轉檔最佳化屬 streaming 轉檔核心；`_worker` 已刪除。

### Requirement: Worker exposes artifact lineage graph API
**Reason**: lineage 由 streaming 轉檔結果 + coordinator shadow / callback 關聯承接；`_worker` API 已刪除。

### Requirement: Worker supports storage IFC batch quality verification
**Reason**: batch 驗證屬外部落地端 / 後續獨立改善；非本 repo 核心 runtime（`_worker` 已刪除）。

### Requirement: Worker optimizes source entity enumeration for canonical IFC fixtures
**Reason**: 轉檔最佳化屬 streaming 轉檔核心；`_worker` 已刪除。

### Requirement: Worker artifact pipeline separates RVT→IFC bridge from streaming-owned IFC→USDC conversion
**Reason**: RVT→IFC 屬外部 IFC Worker；IFC→USDC 屬 `bim-streaming-server` internal-only。此分離語意改由 `local-coordinator-ifc-ready-intake-boundary` / `streaming-ifc-usdc-conversion-authority` 承接。

### Requirement: Worker quantifies full canonical batch outcome distribution under sidecar carrier
**Reason**: canonical batch 量化屬外部落地端 / 後續獨立改善；`_worker` 已刪除。

### Requirement: Worker drives canonical storage batch verification via a resumable queue manifest
**Reason**: resumable queue 屬 `_worker` 內部機制，已隨服務刪除；不在本 repo 核心 runtime。

### Requirement: Worker applies post-coverage artifact retention to canonical-verification scratch only
**Reason**: artifact retention 屬 `_worker` 內部機制，已隨服務刪除。
