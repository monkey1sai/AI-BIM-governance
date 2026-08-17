# Conversion service CI wiring bootstrap

- `stack_kind`: `self_referential_bootstrap`
- PR: `#566`
- trusted base: `d33049c`（origin/main）
- ledger entry: `conversion-service-ci-wiring`
- verification contract: `conversion-service-ci-wiring/v1`

## Why bootstrap evidence is required

本 PR 修改 required CI workflow（streaming job 新增三步：pinned Python、最小依賴安裝、執行 `bim-streaming-server/tests/test_host_native_conversion_service.py`——issue #516 的 open debt：130 個含 process-tree containment 迴歸的測試此前從未進任何 workflow）。Merge 之前 GitHub 只能以 base workflow 作為既定機制執行；該機制無法證明新步驟會以 mainline 行為執行該套件。本分支記錄 bounded bootstrap evidence；不是部署證據，也不關閉 ledger entry。Merge 後必須自 main 重跑精確 verification contract，並以 ledger-only fixpoint PR 關帳。

依 gate 的 entry-claim 規則，entry 的 mechanism paths 僅登記本 PR 實際改動的 surface（ci.yml／ledger）；測試檔與被測模組未在本 PR 改動，`test-host-native-conversion-service` 命令 id 為 immutable command map 既有鍵（linux-test-deploy-verifier-hardening 契約引入），無 map 變更。

## Intended invariant

- CI streaming job 內固定存在執行 host-native conversion service 套件的步驟；該套件（converter 逾時 containment、`_safe_id` sanitize、fail-closed provability 等迴歸）失敗即使 required `streaming stage-loading contract` context 變紅。
- 依賴安裝為最小集（pytest／fastapi／httpx），不引入 usd-core／ifcopenshell 等重依賴（模組層 import 實測不需要）。
- 未修改 scope classifier、其他 job 或任何 gate step 行為。

No credential, private topology, production metadata, or external runtime identifier is recorded.
