## REMOVED Requirements

### Requirement: `_bim-control` provides fake Revit/RVT intake without running Revit

**Reason**: B 方案下 `_bim-control` 已自 repo 刪除（非降級）。Revit/RVT intake 屬**外部公司雲端 control-plane**（外部既有平台），不再是本 repo 產品能力。本 repo 收斂為客戶落地端 data-plane：對外入口 = `bim-review-coordinator` `POST /api/external/ifc-ready`（caller = 落地端 IFC Worker），公司雲端只透過 metadata-only callback 接收結果。僅 `tests/fakes/cloud_bim_control_api` + 契約模擬。

### Requirement: RVT intake is idempotent and traceable

**Reason**: RVT intake 不再在本 repo。等價的 idempotency / correlation 保證改在 coordinator 對外 intake（`idempotency_key`/`correlation_id`，spec `local-coordinator-ifc-ready-intake-boundary` / `conversion-webhook-lifecycle`）與雲端 callback outbox（spec `external-cloud-callback-lifecycle`）承接。
