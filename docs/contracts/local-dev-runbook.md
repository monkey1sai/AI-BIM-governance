# Local Development Runbook

Run commands from `C:\Repos\active\iot\AI-BIM-governance`.

## 1. Fake Storage

```powershell
cd _s3_storage
python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

## 2. Fake BIM Control

```powershell
cd _bim-control
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

## 3. Conversion Service

```powershell
cd _conversion-service
python -m uvicorn app.main:app --host 127.0.0.1 --port 8003 --reload
```

## 4. Review Coordinator

```powershell
cd bim-review-coordinator
npm install
npm run dev
```

## 5. Streaming Server

```powershell
cd bim-streaming-server
.\scripts\start-streaming-server.ps1 -SkipAutoLoad
```

The wrapper keeps NvStreamer ETW traces under `bim-streaming-server/logs/nvstreamer/`.
For the MVP demo, `-SkipAutoLoad` is preferred so the browser client owns the `openStageRequest` timing and avoids `UsdContext busy` during Kit startup.
If the browser reaches signaling but the video stays at `readyState=0`, use the demo recovery wrapper from the workspace root:

```powershell
.\scripts\start-demo-streaming-server.ps1 -SkipGpuCheck
```

This starts Kit with `-SkipAutoLoad -ResetUser -StreamSdkLogLevel info`, which clears stale Kit user state and enables StreamSDK diagnostics.

## 6. Web Viewer

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

Each fake API service and the coordinator expose a Traditional Chinese browser UI for manual demo triggers:

```txt
http://127.0.0.1:8001/ui  _bim-control metadata / issues / annotations
http://127.0.0.1:8002/ui  _s3_storage static file browser
http://127.0.0.1:8003/ui  _conversion-service conversion job console
http://127.0.0.1:8004/ui  coordinator review session and Socket.IO console
http://127.0.0.1:5173     web viewer with Demo 操作面板
```

Open all demo consoles:

```powershell
.\scripts\open-demo-consoles.ps1
```

Check health and UI endpoints:

```powershell
.\scripts\demo-health-check.ps1
```

The manual demo path is:

```txt
_s3_storage UI check files
→ _bim-control UI reset seed / confirm issue
→ _conversion-service UI create job or dev mock result
→ coordinator UI create session / get stream-config / connect Socket.IO
→ web viewer Demo Controls send openStageRequest / highlightPrimsRequest / annotationCreate
→ web viewer Mapping 驗證 load element_mapping.json / select mapping item / send highlightPrimsRequest
```

The Mapping 驗證 panel is intentionally honest: if `element_mapping.json` has `items=[]`, it reports that there is no verifiable `ifc_guid -> usd_prim_path` item instead of treating `/World` fallback as a real mapping validation.
If the mapping document is marked `mock=true`, `allow_fake_mapping=true`, has `summary.fake_mapping_count > 0`, or contains `mapping_method="fake_for_smoke_test"`, the panel disables formal mapping verification actions and treats the file as smoke-only.

## Smoke Checks

```powershell
.\scripts\dev-health-check.ps1
.\scripts\smoke-review-session.ps1
.\scripts\smoke-review-socket.ps1
.\_conversion-service\scripts\smoke_conversion.ps1
```

`smoke-review-session.ps1` verifies fake storage, fake BIM control, coordinator session creation, stream-config, issue discovery, annotation persistence, and coordinator event logging.

`smoke-review-socket.ps1` opens two Socket.IO clients in the same `/review` room and verifies concurrent `joinSession`, `presenceUpdated`, `highlightRequest`, `selectionUpdate`, `annotationCreate`, and `heartbeat` behavior.
