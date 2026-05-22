# conversion-webhook-lifecycle — Spec Delta (streaming-server-prefer-local-ifc-path)

> Delta against `openspec/specs/conversion-webhook-lifecycle/spec.md`(本檔僅含本 change 的差異)。本 change 補實 `fast-ifc-link-demo-loop`(archive PR #93)宣告但 streaming-server 端未實作的 consumer 行為:streaming-server SHALL 從 dispatch payload 的 `host_local_path` / `local_path` 讀 IFC,僅在無法讀取時 fallback 既有 url 路徑解析。

## ADDED Requirements

### Requirement: Streaming-server consumes shared-volume local IFC path before url fetch

`bim-streaming-server` SHALL, when receiving a conversion dispatch whose `ifc_artifact` carries `host_local_path` or `local_path`, resolve the IFC source from that local path before falling back to url-based resolution. The resolution order MUST be:

1. `host_local_path`(streaming-server 為 host-native runtime,直接讀 host fs)
2. `local_path`(coordinator 與 streaming-server 共享 fs 時生效,fast MVP host-native streaming-server 場景通常與 `host_local_path` 同值)
3. existing `url` / `file_url` / `signed_upload_reference` parsing(`file://` / `edge-local://` 既有 scheme 不變)

Resolved paths MUST be constrained inside `STORAGE_ROOT`(env,default streaming-server cwd);path 解析後 escape `STORAGE_ROOT` 範圍 MUST raise `invalid_ifc_input` 而不靜默 fallback。Path 在 `STORAGE_ROOT` 之內但檔案不存在 MUST soft fallback 至下一順位來源(不 raise),允許 race condition 期間用 url 重試。Legacy url-only 來源(無 `local_path` / `host_local_path`)MUST 保持 backward compatible。

#### Scenario: Streaming-server prefers host_local_path inside storage_root

- **WHEN** coordinator dispatches `POST /api/conversions` with `ifc_artifact.host_local_path` 指向 `${STORAGE_ROOT}/ifc-cache/<jobId>/source.ifc` 且檔案存在可讀
- **THEN** `bim-streaming-server` opens the host-local file directly
- **AND** does NOT attempt to fetch `ifc_artifact.url`
- **AND** the resolved path passes a `relative_to(STORAGE_ROOT)` security check

#### Scenario: Streaming-server falls back to url when local paths missing or unreadable

- **WHEN** dispatch carries `ifc_artifact` without `host_local_path` / `local_path`, or both point to files inside `STORAGE_ROOT` that do not yet exist
- **THEN** `bim-streaming-server` falls back to existing url parsing(`file://` / `edge-local://`)
- **AND** existing fixtures and test doubles that only supply `url` continue to work without behaviour change

#### Scenario: Streaming-server rejects local path outside storage_root

- **WHEN** dispatch carries `ifc_artifact.host_local_path = "/etc/passwd"`(or any resolved path outside `STORAGE_ROOT`)
- **THEN** `bim-streaming-server` raises `invalid_ifc_input` with diagnostic "local IFC path is outside storage_root"
- **AND** the conversion job is NOT started
- **AND** the failure is observable in the conversion result for retry / debug
