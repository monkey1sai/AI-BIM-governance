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
- Resolve session-scoped A4 search authority without accepting browser host paths.
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
POST /api/governance/search/model/for-session/{session_id}
POST /api/governance/search/model/for-session/{session_id}/partial-confirmation
POST /api/governance/search/model/for-ifc-ready/{job_id}
POST /api/governance/issues/from-a4-search/for-session/{session_id}
```

The canonical A4 search route authenticates the caller first, requires the
caller's active primary viewer lease, and resolves the active session's IFC,
mapping, model, artifact, and stage revision from coordinator-owned state. The
browser may send only `query`, bounded `limit`, `interpret_mode`, and optional
`retry_of_query_id`; host paths, trusted context, actor, and lease authority are
rejected. The generic `POST /api/governance/search/model` browser route is
disabled in every profile. `for-ifc-ready` remains an authenticated,
lab-only `ifc_ready_table_only` compatibility route until user auth carries
tenant/project authorization; it never forwards a mapping or session proof
context.

The scoped A4 Issue route accepts one confirmed row/draft per request. It
reauthenticates the current session principal and primary lease, requires the
exact production model/artifact/binding and verified mapping capability, then
adds non-overridable trusted context before forwarding. Browser actor/source,
session, lease, proof-digest, and trusted-context fields are rejected. The
currently mounted local-dev lease remains `lab_unverified`, so mutation stays
fail-closed until an authentic shared lease capability is available.

Trusted A4 forwarding requires a 16–4096 character printable-ASCII server-only
`A4_INTERNAL_CONTEXT_TOKEN` shared with governance-service and either an exact
loopback `GOVERNANCE_API_BASE` or an exact origin listed by
`A4_TRUSTED_GOVERNANCE_ORIGINS`. The host-kit deployment injects only its
configured `HOST_GOVERNANCE_API_BASE`, passes the shared token through env, and
mounts host conversion artifacts read-only at `A4_CONVERSION_ARTIFACTS_ROOT`.
Because governance remains host-native, canonical deploy also injects the same
tree's absolute host path as `A4_CONVERSION_ARTIFACTS_HOST_ROOT`; coordinator
validates the container-visible file and forwards only the identical
`<job>/element_mapping.json` suffix in the host namespace.
Redirects, oversized/non-JSON responses, and responses containing server paths
or credential-shaped fields fail closed.
The current `local-dev` identity/lease seam is labelled `lab` internally and
cannot mint proof, Issue, or 3D authority; production with pending SSO binding
is rejected.

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

The dev console exposes current session, stream, intake, and compatibility event-log controls. The live `/review` namespace accepts `joinSession`, `leaveSession`, connectivity-only `heartbeat`, trace-bound `streamReadiness`, and trace-bound `userActivity`; only `streamReadiness.ready=true` starts idle tracking for a qualifying WebRTC peer, while `ready=false`, leave, or disconnect stops it. It broadcasts `presenceUpdated` plus the session idle countdown/cancelled/closed lifecycle events. Retired selection / annotation handlers must not be treated as current behavior. Inactivity reclaim remains disabled until `SESSION_IDLE_TIMEOUT_MS` is explicitly set from measured deployment evidence. Operators can inspect or live-override the effective process policy through `GET` / authenticated `PUT /api/runtime/session-idle-policy`; the override is revision- and process-epoch-checked, rate-limited, audit-reasoned, rejects the source-code default token, never writes `.env`, restarts ready-session clocks at the apply boundary, and is replaced by the deployment environment value after coordinator restart. Browser mutation requires HTTPS or exact loopback HTTP.

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
