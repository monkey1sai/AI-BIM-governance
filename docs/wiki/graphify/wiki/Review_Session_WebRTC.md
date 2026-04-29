# Review Session WebRTC

> 12 nodes · cohesion 0.18

## Key Concepts

- **WebRTC Stream Config** (5 connections) — `contracts/review-session-api.md`
- **Review Session Bootstrap Flow** (4 connections) — `plans/BIM_REVIEW_COORDINATOR_WEB_VIEWER_EXECUTION_PLAN.md`
- **127.0.0.1:49100 WebRTC Signaling** (4 connections) — `contracts/review-session-api.md`
- **bim-review-coordinator** (4 connections) — `plans/BIM_REVIEW_COORDINATOR_WEB_VIEWER_EXECUTION_PLAN.md`
- **GET /api/review-sessions/{session_id}/stream-config** (3 connections) — `contracts/review-session-api.md`
- **POST /api/review-sessions** (3 connections) — `contracts/review-session-api.md`
- **Review Session State** (3 connections) — `contracts/review-session-api.md`
- **localhost:8004 Review Coordinator** (2 connections) — `contracts/review-session-api.md`
- **Socket.IO joinSession** (2 connections) — `contracts/coordinator-socket-events.md`
- **GET /api/model-versions/{model_version_id}/review-bootstrap** (1 connections) — `contracts/review-session-api.md`
- **WebRTC Server Not Running** (1 connections) — `plans/BIM_REVIEW_COORDINATOR_WEB_VIEWER_EXECUTION_PLAN.md`
- **Socket.IO presenceUpdated** (1 connections) — `contracts/coordinator-socket-events.md`

## Relationships

- No strong cross-community connections detected

## Source Files

- `contracts/coordinator-socket-events.md`
- `contracts/review-session-api.md`
- `plans/BIM_REVIEW_COORDINATOR_WEB_VIEWER_EXECUTION_PLAN.md`

## Audit Trail

- EXTRACTED: 33 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*