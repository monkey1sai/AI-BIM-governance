# BIM Review Coordinator

Local review-session control plane for the AI-BIM governance workspace.

## Demo 故事位置

| | |
|---|---|
| **步驟** | ③ 建立會議 (Meeting) |
| **Demo URL** | <http://127.0.0.1:8004/ui> （Demo console） |
| **客戶看到的內容** | 「建立示範審查會議」按鈕、本場會議資訊（會議識別碼 / 模型狀態 / 視訊連線位置）、即時審查事件 feed（中文白話） |
| **設計守則** | [`docs/plans` 入口](../docs/plans/docs-plans-README.md) → [`TARGET-shell.md`](../docs/plans/TARGET-shell.md) |

## Responsibilities

- Create and persist local review sessions.
- Return the configured local Kit/WebRTC endpoint pool for development.
- Accept external IFC-ready intake and dispatch internal streaming conversion.
- Maintain metadata-only callback outbox for the external company cloud.
- Return session / stream config data to the viewer.
- Broadcast basic session presence over Socket.IO namespace `/review`.
- Persist short-lived session events as JSONL files under `data/events`.

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

## Local Kit Endpoint Pool

By default the coordinator exposes one local Kit endpoint:

```txt
KIT_STREAM_SERVER=127.0.0.1
KIT_SIGNALING_PORT=49100
KIT_MEDIA_SERVER=127.0.0.1
KIT_MEDIA_PORT=47998
```

For `routing_policy=dedicated_instance`, configure a real endpoint pool so each
Kit binding has distinct WebRTC ports:

```powershell
$env:KIT_INSTANCE_ENDPOINTS='[{"id":"kit_local_001","signalingServer":"127.0.0.1","signalingPort":49100,"mediaServer":"127.0.0.1","mediaPort":47998},{"id":"kit_local_002","signalingServer":"127.0.0.1","signalingPort":49110,"mediaServer":"127.0.0.1","mediaPort":48008}]'
```

If the requested dedicated bindings exceed the configured endpoint count, the
session request stays `queued_for_instance` instead of reusing the same stream
endpoint.

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
POST /api/external/ifc-ready
GET  /api/external/ifc-ready/{job_id}
POST /api/internal/conversion-result
POST /api/internal/callback-outbox/deliver
POST /api/local-web-view/sessions
```

Socket.IO namespace:

```txt
/review
```

## Dev Console

```txt
GET /ui
GET /dev-console
GET /dev-console-assets/dev-console.js
```

The dev console exposes current session, stream, intake, and compatibility event-log controls. The live `/review` namespace accepts only `joinSession`, `leaveSession`, and `heartbeat`, and broadcasts `presenceUpdated`; retired selection / annotation handlers must not be treated as current behavior.
