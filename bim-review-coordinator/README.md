# BIM Review Coordinator

Local review-session control plane for the AI-BIM governance workspace.

## Demo 故事位置

| | |
|---|---|
| **步驟** | ③ 建立會議 (Meeting) |
| **Demo URL** | <http://127.0.0.1:8004/ui> （Demo console） |
| **客戶看到的內容** | 「建立示範審查會議」按鈕、本場會議資訊（會議識別碼 / 模型狀態 / 視訊連線位置）、即時審查事件 feed（中文白話） |
| **設計守則** | [`docs/plans` 入口](../docs/plans/docs-plans-README.md) → `AI-BIM 前後端設計文件.dc.html` §01 服務邊界＋§04 API 契約 |

## Responsibilities

- Create and persist local review sessions.
- Return the configured local Kit/WebRTC endpoint pool for development.
- Accept external IFC-ready intake and dispatch internal streaming conversion.
- Maintain metadata-only callback outbox for the external company cloud.
- Return session / stream config data to the viewer.
- Authenticate viewer lease claims and issue narrow runtime-command decisions.
- Maintain bounded stage-binding transactions and Kit-confirmed active/last-good evidence.
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
POST /api/review-sessions/{session_id}/a4-handoffs
POST /api/review-sessions/{session_id}/a4-handoffs/{handoff_id}/consume
POST /api/external/ifc-ready
GET  /api/external/ifc-ready/{job_id}
POST /api/internal/conversion-result
POST /api/internal/callback-outbox/deliver
POST /api/local-web-view/sessions
POST /api/review-sessions/{session_id}/viewer-leases/claim
GET  /api/review-sessions/{session_id}/viewer-leases/status
POST /api/review-sessions/{session_id}/stage-binding
POST /api/internal/review-sessions/{session_id}/runtime-command-authorizations
POST /api/internal/review-sessions/{session_id}/stage-binding-authorization-rollbacks
POST /api/internal/review-sessions/{session_id}/stage-binding-confirmations
```

The A4 handoff endpoints accept governance-signed row proofs, re-resolve the
authenticated primary-session binding, and store only a bounded, one-shot
opaque intent. `A4_HANDOFF_TTL_SECONDS` defaults to 60 seconds and is capped at
300 seconds; the effective expiry is the earlier of that TTL and the earliest
proof expiry. Production remains fail-closed until the shared authentic
principal/lease resolver, governance proof authority, and trusted hybrid
transport/token plumbing are available.

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

## Runtime Authority Evidence Boundary

The coordinator is the policy authority for session-scoped runtime mutation,
not the 3D executor. Public claim, status, and stage-binding routes require the
current user identity carrier; internal authorization and confirmation routes
require the existing private internal token. A stage binding moves
`pending -> executing -> active|failed`, and only a Kit-observed success that
the coordinator confirms may update active/last-good evidence.
If Kit cannot validate the authorization response before mutation, it submits
the same exact tuple to the rollback endpoint; the coordinator closes a matching
pending/executing attempt as failed so response loss cannot occupy the long
executing TTL. This rollback is best-effort when the coordinator itself is
unreachable, and it never changes GPU runtime state.

That evidence is process-local control-plane shadow state. It does not mean the
coordinator owns the USD stage, GPU process, viewport, selection, camera, or
materials. Actual runtime state remains owned by `bim-streaming-server`.
Tokens, credentials, authorization headers, and raw upstream responses must not
enter public responses, events, audit payloads, or logs.

This is an atomic coordinator + Kit + viewer wire change. To roll it back,
deploy the previous versions of all three services together, restart the
coordinator and Kit to discard process-local pending/executing transactions,
and require a fresh lease and stage authorization. Never reuse an in-flight
authorization, treat last-good evidence as a GPU rollback command, or keep a
new producer with an old consumer.
