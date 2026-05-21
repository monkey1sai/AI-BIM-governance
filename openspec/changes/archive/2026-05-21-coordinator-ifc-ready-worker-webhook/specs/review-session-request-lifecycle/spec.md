## MODIFIED Requirements

### Requirement: Coordinator session is bound back to the request

After artifact readiness is confirmed, a review session SHALL be created through `bim-review-coordinator` `POST /api/review-sessions` (or the equivalent internal session-creation path that reuses the same `SessionStore` and Kit-binding logic). When a `_bim-control` runtime is present, `_bim-control` or an approved service adapter SHALL be the caller. When the B-scheme runtime has retired `_bim-control` / `_worker`, `bim-review-coordinator` SHALL itself trigger session creation/activation from its own conversion-ready ingestion (the terminal `ready` outcome of the internal conversion-result / pull-ingest path) so the worker-webhook-driven loop reaches a session-first viewer without a `_bim-control` runtime. The resulting `session_id`, stream config reference, artifact bindings, and Kit instance bindings MUST be patched back to the review session request when a request store exists, or persisted as the coordinator's local minimal shadow metadata when `_bim-control` is retired. Coordinator-triggered creation SHALL be control-plane only: it MUST NOT start or control Kit processes, open USD stages, or render; 3D runtime remains `bim-streaming-server`-owned and viewer runtime commands still flow through the DataChannel.

#### Scenario: Coordinator allocates a session

- **WHEN** coordinator creates a review session and allocates at least one Kit instance binding
- **THEN** `_bim-control` stores the `session_id`, binding data, and request status for later lookup

#### Scenario: GPU capacity is unavailable

- **WHEN** coordinator cannot allocate a Kit instance because capacity is unavailable
- **THEN** the review request records `status=queued_for_instance` without losing the original review intent

#### Scenario: Conversion-ready ingestion auto-creates a review session under retired `_bim-control`

- **WHEN** `bim-review-coordinator` conversion ingestion reaches terminal `ready` for a correlated IFC-ready job and no `_bim-control` runtime is available to call `POST /api/review-sessions`
- **THEN** the coordinator itself creates or activates a review session that binds the streaming-owned ready USDC artifact and at least one Kit instance binding
- **AND** it persists `session_id`, stream config reference, artifact bindings, and Kit instance bindings as local minimal shadow metadata
- **AND** the session is discoverable by a session-first `web-viewer-sample` without requiring a `_bim-control` runtime

#### Scenario: Duplicate conversion-ready does not create duplicate sessions

- **WHEN** the same `correlation_id` / `external_model_version_id` reaches terminal `ready` again through re-poll or retry
- **THEN** the coordinator returns or keeps the existing review session for that correlation
- **AND** it does not create a duplicate active session for the same converted model version unless explicitly forced

#### Scenario: Non-ready conversion does not create a streamable session

- **WHEN** conversion ingestion is `failed` or not yet terminal for the correlated job
- **THEN** the coordinator MUST NOT create an active streamable review session
- **AND** it MUST NOT claim model readiness without streaming-owned conversion evidence

#### Scenario: Coordinator-triggered creation stays control-plane only

- **WHEN** the coordinator auto-creates a review session from conversion-ready ingestion
- **THEN** it only writes session, stream config, and Kit instance binding metadata
- **AND** it does not launch, command, or control Kit processes, open USD stages, or render
