# BIM Review Coordinator

Local review-session control plane for the AI-BIM governance workspace.

## Demo 故事位置

| | |
|---|---|
| **步驟** | ③ 建立會議 (Meeting) |
| **Demo URL** | <http://127.0.0.1:8004/ui> （Demo console） |
| **客戶看到的內容** | 「建立示範審查會議」按鈕、本場會議資訊（會議識別碼 / 模型狀態 / 視訊連線位置）、即時審查事件 feed（中文白話） |
| **設計守則** | [`docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md`](../docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md) |

## Responsibilities

- Create and persist local review sessions.
- Return the fixed local Kit/WebRTC endpoint for development.
- Proxy artifact and issue bootstrap data from `_bim-control`.
- Broadcast review-room events over Socket.IO namespace `/review`.
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

## Dev Console

```txt
GET /ui
GET /dev-console
GET /dev-console-assets/dev-console.js
```

The dev console can manually trigger every coordinator HTTP API listed above and can connect to Socket.IO namespace `/review` to emit `joinSession`, `leaveSession`, `highlightRequest`, `selectionUpdate`, `annotationCreate`, and `heartbeat`.
