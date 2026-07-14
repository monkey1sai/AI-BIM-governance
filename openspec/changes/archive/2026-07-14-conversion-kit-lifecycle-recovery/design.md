## Overview

本 change 將「IFC 檔案 ready → conversion job → artifact ready → review session → Kit open → viewer first frame」拆成可驗證的生命週期段。每段都有單一權威與獨立 status，避免任一上游成功被誤宣告成下游成功。

```txt
MinIO / IFC Worker
  -> coordinator ifc-ready intake
  -> streaming conversion authority
  -> artifact truth validation
  -> coordinator session/control-plane
  -> kit-manager / streaming openStageRequest
  -> viewer WebRTC + DataChannel evidence
```

## Data Ownership

- `bim-streaming-server`
  - Owns `conversion_job_id`, persisted job/result JSON, artifact files under conversion work dir, artifact serving truth, quality metrics, subprocess diagnostic paths.
  - SHALL downgrade or annotate jobs whose persisted metadata points at missing artifact files.
- `bim-review-coordinator`
  - Owns ifc-ready job shadow metadata, conversion lifecycle summary, review session identity, Kit binding intent, viewer handoff URL, callback outbox metadata.
  - SHALL expose recovery actions honestly: dispatch retry for dispatch failures; re-ingest/re-trigger for converter terminal failures.
- `services/kit-manager-api`
  - Owns current Kit instance command state (`open`, `close`, command sent/blocked/recorded), selected artifact IDs, and generated `openStageRequest` payload.
- `web-viewer-sample`
  - Owns browser-visible lifecycle presentation and WebRTC/DataChannel evidence display.

## Control Flow

### 1. Conversion truth

When streaming loads a persisted conversion job:

1. If result says ready/succeeded, verify required artifact files exist and are serveable from the conversion authority.
2. If any required artifact is missing, return a non-ready status/anomaly in list/detail/result.
3. Keep the original converter status in diagnostics so operators can distinguish "converter succeeded but artifact missing" from "converter failed".

### 2. Terminal failure recovery

For ifc-ready jobs:

- `dispatch_failed` / `dropped_on_restart` remain eligible for dispatch retry.
- `conversion_status=failed` with an assigned `conversion_job_id` is not dispatch retryable; recovery is re-ingest/re-trigger from source IFC.
- If the original downloaded source IFC no longer exists, the API must say re-trigger from source is required.
- The new re-trigger should create a new conversion job/correlation trail rather than mutating the old terminal conversion job into ready.

### 3. Kit/GPU open lifecycle

Session creation may allocate a Kit binding intent, but that is not stage-open proof.

Required visible states:

- `kit_binding_status`: capacity/binding intent (`allocated`, `queued_for_instance`, `released`, etc.).
- `stage_open_status`: runtime command state (`not_requested`, `requested`, `sent`, `blocked`, `opened`, `failed`).
- `viewer_first_frame_status`: visual evidence (`not_observed`, `observed`).

Kit open must flow through `services/kit-manager-api` or streaming runtime control, producing an `openStageRequest` with the target artifact runtime URI(s). UI can present "Open in Kit" / "Retry open" actions only when a ready, serveable artifact exists.

## Validation Strategy

- Unit tests for conversion persisted ready-but-missing-file downgrade.
- Coordinator route tests for terminal converter failure recovery action labeling.
- Kit manager/coordinator tests proving metadata binding does not imply `stage_open_status=opened`.
- OpenSpec strict validation.
- GitNexus detect_changes for blast radius.

## Known Limits

- Without deployment rebuild and browser E2E, this change cannot prove real GPU/WebRTC first frame.
- A single host RTX/Kit setup remains `local_fixed`; multi-GPU scheduler is out of scope.
- Existing active MinIO trigger change may supply the manual key trigger implementation; this change only requires terminal converter failures to surface a re-trigger path instead of dispatch retry.
