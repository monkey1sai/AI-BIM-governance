# worker-artifact-pipeline Specification

## Purpose
Define `_worker` as the artifact and conversion facade for source model files,
derived USDC artifacts, indices, mapping files, versioned object layout,
conversion lineage, original filename traceability, real IFC conversion output,
and conversion quality reporting. `_worker` owns file bytes and derived
artifact bodies while publishing metadata only to `_bim-control`.
## Requirements
### Requirement: worker-artifact-pipeline capability is removed from product runtime

The `worker-artifact-pipeline` capability SHALL be treated as removed from product runtime under B 方案：`_worker` 已自 repo 刪除（非降級、非 offline fake runtime profile）。原始模型檔與重量資料屬**外部客戶落地端**；IFC→USDC 轉檔權威收斂於 `bim-streaming-server`（internal-only，spec `streaming-ifc-usdc-conversion-authority`）；對外入口收斂於 `bim-review-coordinator` `POST /api/external/ifc-ready`；本地僅保留最小 shadow metadata（spec `local-artifact-shadow-metadata`），artifact 結果以 metadata-only callback 回拋公司雲端（spec `external-cloud-callback-lifecycle`）。此 capability MUST NOT 作為 runtime / startup / health / smoke / review-session 依賴，僅 `tests/fakes` + `tests/contracts` 模擬。

#### Scenario: Artifact + conversion facade is no longer a repo capability

- **WHEN** 需要 source artifact intake / conversion job / 衍生 artifact / lineage
- **THEN** 對外入口為 coordinator intake、轉檔權威為 `bim-streaming-server` internal-only、結果回拋走 metadata-only callback outbox、本地僅最小 shadow
- **AND** 本 repo MUST NOT 重新引入 `_worker` 服務或把此 capability 當 runtime profile
