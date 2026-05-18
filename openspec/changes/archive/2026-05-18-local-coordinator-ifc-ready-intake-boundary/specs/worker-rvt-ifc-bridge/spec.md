## REMOVED Requirements

### Requirement: `_worker` exports RVT to IFC and does not own USDC conversion jobs

**Reason**: B 方案（cloud-edge separation）下 `_worker` 已自 repo 刪除（非降級）。RVT→IFC 產出屬**外部客戶落地端 IFC Worker**（外部既有平台），不再是本 repo 的產品能力；本 repo 對外入口收斂於 `bim-review-coordinator` `POST /api/external/ifc-ready`，內部 IFC→USDC 由 `bim-streaming-server` internal-only 承接。僅 `tests/fakes` + `tests/contracts` 模擬外部 IFC Worker，非 runtime profile。

### Requirement: `_worker` fake fixture mode is explicit

**Reason**: `_worker` 服務已刪除，無 runtime fixture mode。外部 IFC Worker 行為改由 test-only double `tests/fakes/external_ifc_worker_client` + 凍結契約 `tests/contracts/ifc_ready_payload.json` 模擬（design D4：test fixture，非 runtime profile）。

## ADDED Requirements

### Requirement: worker-rvt-ifc-bridge capability is removed from product runtime

The `worker-rvt-ifc-bridge` capability SHALL be treated as removed from product runtime under B 方案（`local-coordinator-ifc-ready-intake-boundary`）：`_worker` 已自 repo 刪除（非降級、非 offline fake runtime profile）。RVT→IFC 產出屬**外部客戶落地端 IFC Worker**（外部既有平台），不再是本 repo 產品能力；對外入口收斂於 `bim-review-coordinator` `POST /api/external/ifc-ready`，內部 IFC→USDC 由 `bim-streaming-server` internal-only 承接。此 capability MUST NOT 作為 runtime / startup / health / smoke / review-session 依賴，僅 `tests/fakes` + `tests/contracts` 模擬。

#### Scenario: RVT→IFC bridge is simulated only by test fixtures

- **WHEN** 任何流程需要 RVT→IFC 產出
- **THEN** 它由外部客戶落地端 IFC Worker 完成，或在測試中由 `tests/fakes/external_ifc_worker_client` + `tests/contracts/ifc_ready_payload.json` 模擬
- **AND** 本 repo MUST NOT 重新引入 `_worker` 服務或把此 capability 當 runtime profile
