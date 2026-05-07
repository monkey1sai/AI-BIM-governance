# Local Development Runbook

Run commands from `C:\Repos\active\iot\AI-BIM-governance`.

The current local demo path uses `_worker` as the only file and conversion
boundary. Ports `8002` and `8003` are retired from the current runtime path.

## 1. Fake BIM Control

```powershell
cd _bim-control
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

## 2. Worker Facade

```powershell
cd _worker
python -m uvicorn app.main:app --host 127.0.0.1 --port 8005 --reload
```

Place demo IFC files under the workspace `storage/` folder. `_worker` defaults
`WORKER_DEV_STORAGE_ROOT` to `../storage` from the `_worker` service directory,
lists available `.ifc` files in the demo UI, and triggers conversion jobs for
the selected file.

## 3. Review Coordinator

```powershell
cd bim-review-coordinator
npm install
npm run dev
```

## 4. Streaming Server

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

## 5. Web Viewer

```powershell
cd web-viewer-sample
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:5173
```

## Demo UI Consoles

```txt
http://127.0.0.1:8005     _worker IFC source selection + conversion
http://127.0.0.1:8004/ui  coordinator review session and Socket.IO console
http://127.0.0.1:5173     web viewer with Demo 操作面板
http://127.0.0.1:8001/ui  _bim-control metadata / issues / annotations
```

Open all demo consoles:

```powershell
.\scripts\open-demo-consoles.ps1
```

Check health and UI endpoints:

```powershell
.\scripts\demo-health-check.ps1
```

## Manual Demo Path

```txt
_worker UI lists .\storage\*.ifc
→ selected IFC triggers a worker conversion job
→ _worker produces USDC + mapping URLs and publishes metadata to _bim-control
→ _bim-control creates a review-session request with artifact bindings
→ coordinator creates a session from artifact bindings / Kit profile
→ web viewer opens with review_request_id or session_id and then connects WebRTC
→ streaming runtime loads every ready artifact binding by load_order
```

The Mapping 驗證 panel is intentionally honest: if `element_mapping.json` has
`items=[]`, it reports that there is no verifiable `ifc_guid -> usd_prim_path`
item instead of treating `/World` fallback as a real mapping validation.

## Smoke Checks

```powershell
.\scripts\dev-health-check.ps1
.\scripts\smoke-worker-review-request.ps1
.\scripts\smoke-review-session.ps1
.\scripts\smoke-review-socket.ps1
.\bim-streaming-server\scripts\tests\test-stage-loading-contract.ps1
```

`smoke-worker-review-request.ps1` verifies the API-only flow:
`_worker -> _bim-control -> bim-review-coordinator`. It does not require Kit,
GPU, browser automation, or WebRTC.

`bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1` is a
non-GPU DataChannel contract smoke for the multi-artifact load-order payload.

`smoke-review-session.ps1` verifies worker object URLs, fake BIM control,
coordinator session creation, stream-config, issue discovery, annotation
persistence, and coordinator event logging.
