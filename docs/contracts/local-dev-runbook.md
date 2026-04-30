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
.\scripts\start-streaming-server.ps1 -UsdPath .\bim-models\許良宇圖書館建築_2026.usd
```

The wrapper keeps NvStreamer ETW traces under `bim-streaming-server/logs/nvstreamer/`.

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

Each fake API service and the coordinator expose a browser UI for manual demo triggers:

```txt
http://127.0.0.1:8001/ui  _bim-control metadata, issues, annotations
http://127.0.0.1:8002/ui  _s3_storage static file browser
http://127.0.0.1:8003/ui  _conversion-service conversion job console
http://127.0.0.1:8004/ui  coordinator review session and Socket.IO console
http://127.0.0.1:5173     web viewer with Demo Controls panel
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
```

## Smoke Checks

```powershell
.\scripts\dev-health-check.ps1
.\scripts\smoke-review-session.ps1
.\_conversion-service\scripts\smoke_conversion.ps1
```

`smoke-review-session.ps1` verifies fake storage, fake BIM control, coordinator session creation, stream-config, issue discovery, annotation persistence, and coordinator event logging.
