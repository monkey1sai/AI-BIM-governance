## REMOVED Requirements

### Requirement: `_worker` exports RVT to IFC and does not own USDC conversion jobs

**Reason**: B 方案（cloud-edge separation）下 `_worker` 已自 repo 刪除（非降級）。RVT→IFC 產出屬**外部客戶落地端 IFC Worker**（外部既有平台），不再是本 repo 的產品能力；本 repo 對外入口收斂於 `bim-review-coordinator` `POST /api/external/ifc-ready`，內部 IFC→USDC 由 `bim-streaming-server` internal-only 承接。僅 `tests/fakes` + `tests/contracts` 模擬外部 IFC Worker，非 runtime profile。

### Requirement: `_worker` fake fixture mode is explicit

**Reason**: `_worker` 服務已刪除，無 runtime fixture mode。外部 IFC Worker 行為改由 test-only double `tests/fakes/external_ifc_worker_client` + 凍結契約 `tests/contracts/ifc_ready_payload.json` 模擬（design D4：test fixture，非 runtime profile）。
