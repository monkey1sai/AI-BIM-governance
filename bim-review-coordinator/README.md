# BIM Review Coordinator

Local review-session control plane for the AI-BIM governance workspace.

## Responsibilities

- Create and persist local review sessions.
- Return the fixed local Kit/WebRTC endpoint for development.
- Proxy artifact and issue bootstrap data from `_bim-control`.
- Broadcast review-room events over Socket.IO namespace `/review`.
- Persist short-lived session events as JSON files.

## Run

```powershell
npm install
npm run build
npm test
npm run dev
```

Default service URL:

```txt
http://127.0.0.1:8004
```

## Key Endpoints

```txt
GET  /health
POST /api/review-sessions
GET  /api/review-sessions/{session_id}
POST /api/review-sessions/{session_id}/join
POST /api/review-sessions/{session_id}/leave
GET  /api/review-sessions/{session_id}/stream-config
GET  /api/review-sessions/{session_id}/events
POST /api/review-sessions/{session_id}/events
GET  /api/model-versions/{model_version_id}/review-bootstrap
```

Socket.IO namespace:

```txt
/review
```
