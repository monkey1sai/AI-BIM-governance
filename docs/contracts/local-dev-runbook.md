# Local Development Runbook

Run commands from the repo root:

```powershell
C:\Users\IOT\.codex\worktrees\c3de\AI-BIM-governance
```

Phase B current local demo path no longer starts `_worker` or `_bim-control`.
Those names are historical/test-only references. The runnable local path is:

```txt
[external] customer-edge IFC Worker test double
→ POST /api/external/ifc-ready
→ bim-review-coordinator (:8004)
→ bim-streaming-server internal conversion authority (:49101 / WebRTC :49100)
→ metadata-only callback outbox
→ web-viewer-sample (:5173)
```

Ports `8001`, `8002`, `8003`, and `8005` are retired from the current demo
startup path.

## 1. Review Coordinator

```powershell
cd bim-review-coordinator
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:8004/dev-console
```

The coordinator owns the external IFC-ready intake, local session state,
collaboration events, and metadata-only callback outbox. It does not store
large model file bytes.

## 2. Streaming Server

```powershell
cd bim-streaming-server
.\scripts\start-streaming-server.ps1 -SkipAutoLoad
```

The wrapper keeps NvStreamer ETW traces under `bim-streaming-server/logs/nvstreamer/`.
For the MVP demo, `-SkipAutoLoad` is preferred so the browser client owns the
`openStageRequest` timing and avoids `UsdContext busy` during Kit startup.

If the browser reaches signaling but the video stays at `readyState=0`, use:

```powershell
.\scripts\start-demo-streaming-server.ps1 -SkipGpuCheck
```

GPU/Kit runtime may be unavailable in cloud or CPU-only environments. In that
case, run the contract and coordinator smoke checks without claiming WebRTC
video readiness.

## 3. Web Viewer

```powershell
cd web-viewer-sample
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:5173
```

## Demo Consoles

```txt
http://127.0.0.1:8004/dev-console  coordinator B-scheme intake/session console
http://127.0.0.1:5173              web viewer with Demo 操作面板
```

Open demo consoles:

```powershell
.\scripts\open-demo-consoles.ps1
```

Check health and UI endpoints:

```powershell
.\scripts\demo-health-check.ps1
```

## Manual Demo Path

```txt
external IFC Worker test double posts ifc-ready metadata
→ coordinator validates auth/idempotency and creates a local conversion job
→ coordinator calls streaming conversion authority internally
→ streaming produces model/mapping/manifest artifact URLs
→ coordinator records minimal shadow metadata and callback outbox state
→ web viewer opens with review_request_id or session_id and connects WebRTC
→ streaming runtime loads ready artifact bindings by load_order
```

The Mapping 驗證 panel is intentionally honest: if `element_mapping.json` has
`items=[]`, it reports that there is no verifiable `ifc_guid -> usd_prim_path`
item instead of treating `/World` fallback as a real mapping validation.

## Smoke Checks

```powershell
.\scripts\smoke-bscheme-intake.ps1 -SkipKitLauncher
python -m pytest tests -q -p no:cacheprovider
cd bim-review-coordinator; npm run verify
cd ..\web-viewer-sample; npm run verify
cd ..\bim-streaming-server; python -m pytest tests/test_conversion_authority_api.py -q
```

`smoke-bscheme-intake.ps1` verifies the current Phase B API-only flow:
external IFC-ready payload fixtures, coordinator intake, streaming-owned
conversion authority contract, and metadata-only callback outbox. It does not
require browser automation, GPU video, or the retired `_worker` / `_bim-control`
runtime services.

`bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1` remains a
non-GPU DataChannel contract smoke for the multi-artifact load-order payload.
