## MODIFIED Requirements

### Requirement: Session lifecycle is explicit

The coordinator SHALL represent review session lifecycle with `created`, `active`, `closing`, `closed`, and `failed`. The coordinator SHALL persist lifecycle transitions as append-only lifecycle audit events with stable event schema. `_bim-control` SHALL store review request lifecycle events or request binding updates sufficient to correlate review intent with the coordinator session audit trail.

Lifecycle audit events MUST include `event_id`, `session_id`, `type`, `sequence`, `created_at`, and `payload`. When a session is created from a review request, lifecycle events MUST preserve `review_request_id` in payload or equivalent correlation data.

#### Scenario: Session becomes active

- **WHEN** at least one required Kit instance is ready and required artifacts are loaded or loadable
- **THEN** the review session transitions to `active`
- **AND** the coordinator appends `sessionCreated` and `sessionActive` lifecycle audit events with increasing `sequence` values

#### Scenario: Session creation fails

- **WHEN** coordinator cannot create the session or open required artifacts
- **THEN** the review request and session record a failed status with an error reference
- **AND** any coordinator-side lifecycle audit event for the failure includes `type=failed` or failure details in `payload`

#### Scenario: Review request is correlated with coordinator session

- **WHEN** `_bim-control` stores a review request and the coordinator creates a session for that request
- **THEN** `_bim-control` records review request lifecycle events such as `reviewRequestCreated` and `sessionBound`
- **AND** coordinator lifecycle audit events include correlation data that lets clients connect the review request with the session audit trail

## ADDED Requirements

### Requirement: Coordinator exposes lifecycle event audit log

The coordinator SHALL expose `GET /api/review-sessions/{session_id}/lifecycle-events` for review session lifecycle audit events. The response MUST contain an `items` array sorted by append order and `sequence`. This endpoint MUST return lifecycle audit events only and MUST NOT include generic collaboration events such as `highlightRequest`, `selectionUpdate`, `annotationCreated`, or `finalReviewEvent`.

The lifecycle event audit log MUST include at least these lifecycle event types when the corresponding transition occurs: `sessionCreated`, `sessionActive`, `sessionClosing`, `sessionClosed`, and `kitInstanceReleased`.

#### Scenario: Lifecycle audit events are returned in append order

- **WHEN** a client requests `GET /api/review-sessions/{session_id}/lifecycle-events` for an existing review session
- **THEN** the coordinator returns lifecycle audit events sorted by increasing `sequence`
- **AND** every item includes `event_id`, `session_id`, `type`, `sequence`, `created_at`, and `payload`

#### Scenario: Closing a session records lifecycle events

- **WHEN** a close request is accepted for an active review session
- **THEN** the coordinator appends `sessionClosing`, `sessionClosed`, and `kitInstanceReleased` lifecycle audit events
- **AND** the `kitInstanceReleased` payload identifies released `kit_instance_bindings`

#### Scenario: Collaboration events are excluded from lifecycle audit

- **WHEN** a session contains generic events such as highlight, selection, annotation, or final review events
- **THEN** `GET /api/review-sessions/{session_id}/events` can continue to return those generic events
- **AND** `GET /api/review-sessions/{session_id}/lifecycle-events` excludes those generic events

#### Scenario: Unknown session lifecycle events are not returned

- **WHEN** a client requests lifecycle events for an unknown or invalid review session id
- **THEN** the coordinator returns the same not-found or validation behavior used by the review session event APIs
