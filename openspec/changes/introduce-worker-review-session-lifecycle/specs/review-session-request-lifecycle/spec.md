## ADDED Requirements

### Requirement: BIM control stores review session requests

`_bim-control` SHALL expose `POST /api/review-session-requests` to store review intent before a coordinator session exists. The request MUST capture `review_request_id`, `requested_by`, `tenant_id`, `model_version_id`, `artifact_group_ids` or `selected_artifact_ids`, `startup_policy`, and `kit_profile`.

#### Scenario: Review intent is created

- **WHEN** a user requests a review session for a model version and artifact group
- **THEN** `_bim-control` creates a review session request with `status=created`

#### Scenario: Required intent fields are missing

- **WHEN** a client creates a review session request without `model_version_id`
- **THEN** `_bim-control` rejects the request and does not create a coordinator session

### Requirement: Review request checks artifact readiness

`_bim-control` SHALL check `_worker` artifact group readiness before marking a review request ready for session creation. If required source, derived, or mapping artifacts are missing, the request MUST move to a blocked state that identifies conversion readiness as the blocker.

#### Scenario: Artifact group is ready

- **WHEN** the requested artifact group has ready source, derived USDC, and mapping artifacts
- **THEN** `_bim-control` allows session creation to proceed

#### Scenario: Artifact group is not ready

- **WHEN** the requested artifact group is missing derived USDC or mapping artifacts
- **THEN** `_bim-control` sets the request status to `blocked_conversion`

### Requirement: Coordinator session is bound back to the request

After artifact readiness is confirmed, `_bim-control` or an approved service adapter SHALL call `bim-review-coordinator` `POST /api/review-sessions`. The resulting `session_id`, stream config reference, artifact bindings, and Kit instance bindings MUST be patched back to the review session request.

#### Scenario: Coordinator allocates a session

- **WHEN** coordinator creates a review session and allocates at least one Kit instance binding
- **THEN** `_bim-control` stores the `session_id`, binding data, and request status for later lookup

#### Scenario: GPU capacity is unavailable

- **WHEN** coordinator cannot allocate a Kit instance because capacity is unavailable
- **THEN** the review request records `status=queued_for_instance` without losing the original review intent

### Requirement: Session lifecycle is explicit

The coordinator SHALL represent review session lifecycle with `created`, `active`, `closing`, `closed`, and `failed`. `_bim-control` SHALL store lifecycle events or request binding updates sufficient to audit the transition from review intent to active or failed session.

#### Scenario: Session becomes active

- **WHEN** at least one required Kit instance is ready and required artifacts are loaded or loadable
- **THEN** the review session transitions to `active`

#### Scenario: Session creation fails

- **WHEN** coordinator cannot create the session or open required artifacts
- **THEN** the review request and session record a failed status with an error reference

### Requirement: Closing and instance release are separate

Closing a review session MUST stop new participant joins and persist final annotation or snapshot events before marking the session `closed`. A session MUST NOT be treated as fully released until all `kit_instance_bindings[]` have `status=released`.

#### Scenario: Session closes before release

- **WHEN** a close request is accepted
- **THEN** coordinator moves the session to `closing`, saves final events, then moves it to `closed`

#### Scenario: Kit release completes

- **WHEN** every Kit instance binding for a closed session has been released
- **THEN** the system records instance release completion separately from session closure
