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
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window
```

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

## Smoke Checks

```powershell
.\scripts\dev-health-check.ps1
.\scripts\smoke-review-session.ps1
.\_conversion-service\scripts\smoke_conversion.ps1
```

`smoke-review-session.ps1` verifies fake storage, fake BIM control, coordinator session creation, stream-config, issue discovery, annotation persistence, and coordinator event logging.
