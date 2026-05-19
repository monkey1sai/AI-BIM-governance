## REMOVED Requirements

### Requirement: `_bim-control` provides fake Revit/RVT intake without running Revit

**Reason**: B 方案下 `_bim-control` 已自 repo 刪除（非降級）。Revit/RVT intake 屬**外部公司雲端 control-plane**（外部既有平台），不再是本 repo 產品能力。本 repo 收斂為客戶落地端 data-plane：對外入口 = `bim-review-coordinator` `POST /api/external/ifc-ready`（caller = 落地端 IFC Worker），公司雲端只透過 metadata-only callback 接收結果。僅 `tests/fakes/cloud_bim_control_api` + 契約模擬。

### Requirement: RVT intake is idempotent and traceable

**Reason**: RVT intake 不再在本 repo。等價的 idempotency / correlation 保證改在 coordinator 對外 intake（`idempotency_key`/`correlation_id`，spec `local-coordinator-ifc-ready-intake-boundary` / `conversion-webhook-lifecycle`）與雲端 callback outbox（spec `external-cloud-callback-lifecycle`）承接。

## ADDED Requirements

### Requirement: bim-control-revit-intake-facade capability is removed from product runtime

The `bim-control-revit-intake-facade` capability SHALL be treated as removed from product runtime under B 方案：`_bim-control` 已自 repo 刪除（非降級、非 offline fake runtime profile）。Revit/RVT intake 與 BIM 資料權威屬**外部公司雲端 control-plane**（外部既有平台），不再是本 repo 產品能力；本 repo 為客戶落地端 data-plane，公司雲端僅透過 metadata-only callback 接收結果。此 capability MUST NOT 作為 runtime / startup / health / smoke / review-session 依賴，僅 `tests/fakes/cloud_bim_control_api` + `tests/contracts` 模擬。

#### Scenario: Revit/RVT intake is owned by the external company cloud

- **WHEN** 需要 Revit/RVT intake 或 BIM 資料權威
- **THEN** 由外部公司雲端 `bim-control`（control-plane）承接，本地僅以 `external_model_version_id` 參照、保留最小 shadow metadata
- **AND** 本 repo MUST NOT 重新引入 `_bim-control` 服務或把此 capability 當 runtime profile
