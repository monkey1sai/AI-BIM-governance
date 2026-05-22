## Why

fast-ifc-link-demo-loop(PR #92,archived 2026-05-21)宣告 coordinator → streaming-server dispatch payload 加 `local_path` / `host_local_path`,並寫進 spec delta(`openspec/changes/archive/2026-05-21-fast-ifc-link-demo-loop/specs/conversion-webhook-lifecycle/spec.md`):**`bim-streaming-server` SHALL prefer `host_local_path` when present, fall back to translating `local_path`...**。

但 streaming-server 端 **完全沒實作這個 consumer 行為**:

- `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py` 的 `_ifc_artifact`(line 560-576)只解 `url` / `file_url` / `signed_upload_reference`,完全忽略 dispatch payload 的 `local_path` / `host_local_path`
- `ifc2usdc_powershell_adapter.py` 的 `_resolve_local_ifc`(line 159-178)從 `artifact.url` 解析,經 `_url_to_local_path`(line 180-194)只接 `""` / `file://` / `edge-local://` scheme;HTTP scheme 直接 return None → raise `invalid_ifc_input`

結果:即使 PR #92 + #94 + #95 已修好 coordinator 端的 ENOTDIR + compose env + shared volume mount,fast-mvp happy path 仍 **卡在 streaming-server 階段**(2026-05-22 重跑驗證:`conversion_status: queued`,`viewer_url: null`)。

本 change 把 streaming-server 端的 spec drift 補完,實作 fast-ifc-link-demo-loop 已宣告但未實作的 consumer 行為。

## What Changes

### 修改 — `bim-streaming-server` conversion authority

- `conversion_authority._ifc_artifact`:return dict 加 `local_path: str | None` 與 `host_local_path: str | None`(從 raw 直接 propagate,不驗證)
- `ifc2usdc_powershell_adapter._resolve_local_ifc`:新解析順序
  1. `artifact['host_local_path']` 若存在且可讀(absolute / 相對 `storage_root` 解析後在 `storage_root` 之內)→ 用它
  2. `artifact['local_path']` 同樣規則 → 用它(streaming-server 與 coordinator 共享 fs 時有效;host-native 場景通常 same value as host_local_path)
  3. fallback 既有 `_url_to_local_path`(file://、edge-local://)
- `Ifc2UsdcPowerShellAdapter`:加 `storage_root: Path | None` constructor 參數(env `STORAGE_ROOT`,default cwd resolve);用來解析 relative local path + sandbox absolute path
- Security:`host_local_path` / `local_path` resolve 後 **必須在 `storage_root` 之內**(防 path traversal);超出範圍 raise `ConversionAuthorityError("invalid_ifc_input", ...)`,**不**靜默 fallback

### 修改 — `bim-streaming-server` tests

- `tests/test_conversion_authority_api.py` 加 case:
  - `host_local_path` 優先,跳過 url 解析
  - `host_local_path` 不可讀 → fallback `local_path`
  - 兩者都不可讀 → fallback `url`(既有 file:// / edge-local:// path)
  - `host_local_path` 在 `storage_root` 外 → raise `invalid_ifc_input`
- 既有 file:// / edge-local:// test 不破

### OpenSpec deltas finalize

- `openspec/changes/streaming-server-prefer-local-ifc-path/specs/conversion-webhook-lifecycle/spec.md`:`## ADDED Requirements` 加 `Streaming-server consumes shared-volume local IFC path before url fetch`,3 個 Scenario

### 明確排除(本 change 不做)

- 不改 coordinator dispatch schema(已對齊,PR #92/#95 完成)
- 不引入 streaming-server 端 HTTP fetch(本 change 不接 url HTTP download)
- 不解 streaming-server docker deployment 的 dual-fs 議題(本 change scope = 現行 host-native fast MVP only)
- 不把 fast-ifc-link-demo-loop archive 的 dispatch-schema requirement 補進 main spec body(archive sync incomplete 是另一個 housekeeping issue)
- 不動 _anchor 對 url-derived path 的既有 work_dir sandboxing 行為

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `conversion-webhook-lifecycle`:ADD 1 個 requirement(streaming-server consumer 行為),補實 fast-ifc-link-demo-loop spec drift

### Removed Capabilities

- None.

## Impact

- Owner repo/folder:`bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/`、`bim-streaming-server/tests/`
- API:streaming-server `POST /api/conversions` 行為改變(對 dispatch payload 有 `local_path` / `host_local_path` 時優先用,不打 url HTTP fetch);response schema 不變
- Data structure:`_ifc_artifact` 回傳 dict 加 `local_path` / `host_local_path` 兩個欄位(下游 `job["ifc_artifact"]` 與 result lineage 透傳)
- Affected integration:coordinator dispatch payload schema 已有 `local_path` / `host_local_path`(PR #92 完成);本 change 補消費端
- Affected symbols(apply 前需 GitNexus impact analysis):`_ifc_artifact`、`_resolve_local_ifc`、`_url_to_local_path`、`Ifc2UsdcPowerShellAdapter.__init__`、`_anchor`
- Tests/contracts:streaming-server pytest 加 3 case;既有 11 + 168 coordinator tests 不破(因 coordinator side 不動)
- Dependencies:無新 prod dependency
- Predecessor/Successor:predecessor `fast-ifc-link-demo-loop` (archived PR #93) + hotfix PR #94 + #95;本 change 直接從 main 開
- Acceptance verification:L1 streaming-server pytest / L1 coordinator npm run verify regression / L4 真實 docker rebuild + 重跑 Postman → 確認 `conversion_status: ready` + `viewer_url` 出現
- Brainstorming source-of-truth:本次對話的 explore Round 1 / Round 2 與 fast-ifc-link-demo-loop archive 的 spec delta
