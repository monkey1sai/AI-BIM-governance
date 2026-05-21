# conversion-webhook-lifecycle — Spec Delta (fast-ifc-link-demo-loop)

> Delta against `openspec/specs/conversion-webhook-lifecycle/spec.md`(本檔僅含本 change 的差異)。本 change 把 coordinator → streaming-server dispatch payload 加入 `local_path` / `host_local_path`,讓 host-native streaming-server 從同 shared volume 讀 IFC 而不必再 HTTP GET。

## ADDED Requirements

### Requirement: Coordinator dispatch payload carries local path references

`bim-review-coordinator` SHALL, when dispatching a conversion request to `bim-streaming-server` after a synchronous IFC download(see `local-coordinator-ifc-ready-intake-boundary` change `fast-ifc-link-demo-loop`),include both:

- `local_path`: container-view absolute path of the downloaded IFC inside coordinator's mounted shared volume(e.g. `/workspace/storage/ifc-cache/<ifc_ready_job_id>/source.ifc`)
- `host_local_path`: host-view absolute path of the same file(e.g. `C:\Repos\active\iot\AI-BIM-governance\storage\ifc-cache\<ifc_ready_job_id>\source.ifc`)

`bim-streaming-server` SHALL prefer `host_local_path` when present, fall back to translating `local_path` through `STORAGE_HOST_ROOT` env, and use the existing `source_ifc_ref`(URL form)only as a last-resort fallback. The legacy URL-only fallback MUST remain functional so that callers without the shared volume(test fakes, non-Docker setups)still work.

#### Scenario: Streaming-server reads from shared volume via host_local_path

- **WHEN** coordinator dispatches `POST /api/conversions` with `{ ifc_ready_job_id, local_path:"/workspace/storage/ifc-cache/<jobId>/source.ifc", host_local_path:"C:\\...\\storage\\ifc-cache\\<jobId>\\source.ifc", source_ifc_ref }`
- **THEN** `bim-streaming-server` opens the host-local file directly without performing an HTTP GET on `source_ifc_ref`

#### Scenario: Streaming-server falls back to URL when local paths unavailable

- **WHEN** coordinator dispatches a conversion without `local_path` / `host_local_path`(test fake, legacy caller)
- **THEN** `bim-streaming-server` falls back to fetching `source_ifc_ref` over HTTP as before
- **AND** no breaking change is exposed to legacy callers

#### Scenario: Streaming-server validates host path is inside STORAGE_HOST_ROOT

- **WHEN** coordinator dispatches a conversion whose `host_local_path` is outside the configured `STORAGE_HOST_ROOT`
- **THEN** `bim-streaming-server` rejects the request as `403 forbidden_path` and the conversion job is NOT started
- **AND** this protects against path traversal from a misconfigured coordinator

