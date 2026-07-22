# Local Development Runbook

Run commands from the `AI-BIM-governance` repo root:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
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

### Runtime authority wiring

The root golden path is:

```powershell
.\scripts\deploy.ps1
```

It derives `COORDINATOR_INTERNAL_API_BASE` from `COORDINATOR_PORT` as an
origin-only loopback URL and passes the same private
`INTERNAL_API_AUTH_TOKEN` to the Docker coordinator and host-native Kit process.
The tracked `.env.web-plane.host-kit.example` keeps both placeholders empty;
put a real shared value only in the private `.env.web-plane.host-kit`. The
local development fallback is lab-only and is not production identity or
credential-hygiene evidence. Never put either bearer value in a command line,
URL, screenshot, log summary, or PR body.

For a manual Kit launch, set the two process env values in the same terminal
before `start-streaming-server.ps1`. The internal base must remain loopback;
LAN/public coordinator URLs and URLs with credentials, path, query, or fragment
are rejected. Each production mutator fails closed if authority is unavailable;
read-only scene queries and video remain available.

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
→ viewer claims an authenticated primary lease and preauthorizes ordered artifact IDs
→ coordinator returns a pending authorization, revision, and exact ready stage composition
→ Kit atomically authorizes, mutates, observes the stage, and confirms completion
→ coordinator marks the same revision active; otherwise viewer remains unproven and blocks handoff
```

The Mapping 驗證 panel is intentionally honest: if `element_mapping.json` has
`items=[]`, it reports that there is no verifiable `ifc_guid -> usd_prim_path`
item instead of treating `/World` fallback as a real mapping validation.

## Smoke Checks

```powershell
.\scripts\smoke-bscheme-intake.ps1 -SkipKitLauncher
python -m pytest tests -q -p no:cacheprovider
python -m pytest tests/test_runtime_command_contracts.py -q -p no:cacheprovider
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

## Rollback and completion boundary

Coordinator, Kit, and viewer use one breaking wire contract and must roll
forward or back together. For rollback, stop new viewer producers, restore all
three service versions, restart coordinator and Kit to discard process-local
pending/executing transactions, then claim a fresh lease and authorization.
Do not replay an in-flight stage transaction or treat coordinator last-good
evidence as a command that restores GPU state.

A4/Ornith credential revocation/rotation remains an external gate. Until the
credential owner confirms it, this runbook supports local-dev lab validation
only: credential hygiene, production full, and overall A4 completion remain
failed/open regardless of CPU test results.
