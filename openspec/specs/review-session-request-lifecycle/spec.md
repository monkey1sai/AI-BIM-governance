# review-session-request-lifecycle Specification

## Purpose
Define the review intent and session lifecycle contract across `_bim-control`
and `bim-review-coordinator`. `_bim-control` records review session requests and
artifact readiness, the coordinator creates and manages explicit session states,
and close/release semantics remain auditable without making either service a
file store or Kit renderer.
## Requirements
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

After artifact readiness is confirmed, a review session SHALL be created through `bim-review-coordinator` `POST /api/review-sessions` (or the equivalent internal session-creation path that reuses the same `SessionStore` and Kit-binding logic). When a `_bim-control` runtime is present, `_bim-control` or an approved service adapter SHALL be the caller. When the B-scheme runtime has retired `_bim-control` / `_worker`, `bim-review-coordinator` SHALL itself trigger session creation/activation from its own conversion-ready ingestion (the terminal `ready` outcome of the internal conversion-result / pull-ingest path) so the worker-webhook-driven loop reaches a session-first viewer without a `_bim-control` runtime. The resulting `session_id`, stream config reference, artifact bindings, and Kit instance bindings MUST be patched back to the review session request when a request store exists, or persisted as the coordinator's local minimal shadow metadata when `_bim-control` is retired. Coordinator-triggered creation SHALL be control-plane only: it MUST NOT start or control Kit processes, open USD stages, or render; 3D runtime remains `bim-streaming-server`-owned and viewer runtime commands still flow through the DataChannel.

> **Implementation status (2026-05-21)**: this requirement was ratified by archive `2026-05-21-coordinator-ifc-ready-worker-webhook` but `ingestConversionReport` (`bim-review-coordinator/src/app.ts:566-628`) never wired the ready branch into `SessionStore.create` / `allocateKitInstanceBindings` / `chooseReadyUsdc` (retro-audit commit `a32fcd6`). Change `backfill-coordinator-webhook-and-auto-session` backfills the implementation through an `autoCreateOrActivateSession` helper that reuses the existing `POST /api/review-sessions` internal path. See its `tasks.md` for the scenario-to-test mapping.

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

### Requirement: Closing and instance release are separate

Closing a review session MUST stop new participant joins and persist final annotation or snapshot events before marking the session `closed`. A session MUST NOT be treated as fully released until all `kit_instance_bindings[]` have `status=released`.

#### Scenario: Session closes before release

- **WHEN** a close request is accepted
- **THEN** coordinator moves the session to `closing`, saves final events, then moves it to `closed`

#### Scenario: Kit release completes

- **WHEN** every Kit instance binding for a closed session has been released
- **THEN** the system records instance release completion separately from session closure

### Requirement: Coordinator exposes lifecycle event audit log

The coordinator SHALL expose `GET /api/review-sessions/{session_id}/lifecycle-events` for review session lifecycle audit events. The response MUST contain an `items` array sorted by append order and `sequence`. This endpoint MUST return lifecycle audit events only and MUST NOT include generic collaboration events such as `highlightRequest`, `selectionUpdate`, `annotationCreated`, or `finalReviewEvent`.

The lifecycle event audit log MUST include at least these lifecycle event types when the corresponding transition occurs: `sessionCreated`, `sessionActive`, `sessionClosing`, `sessionClosed`, and `kitInstanceReleased`.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `remove-conflict-review-from-fast-mvp` removed the coordinator `highlightRequest` / `selectionUpdate` / `annotationCreate` Socket.IO event handlers (in `bim-review-coordinator/src/socket/reviewNamespace.ts`) and the viewer `IssuePanel` / `EventLogPanel` / `bimControlClient.getReviewIssues` / `coordinatorClient.getReviewBootstrap` paths. New generic collaboration events of those types are no longer produced. The exclusion wording covering `highlightRequest`, `selectionUpdate`, `annotationCreated`, and `finalReviewEvent` from lifecycle audit is preserved for archive / historical compatibility — existing event logs may still contain those event types from earlier runs, and the lifecycle endpoint MUST still exclude them. The companion `compose.host-kit.yml` change pinned `viewer.ports` to `127.0.0.1:5173:5173` so the viewer is no longer addressable from LAN, aligning with the Kit-1:1 boundary that excludes broadcast collaboration. If conflict review is re-introduced under a future OpenSpec change, that change SHALL add back the corresponding collaboration ADD requirements and viewer slots.

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

### Requirement: Review sessions reference streaming-owned conversion readiness

Review session lifecycle SHALL support model readiness data whose conversion authority is `bim-streaming-server`. Session creation MAY proceed with model status `missing`, `converting`, `ready`, `failed`, or `blocked`, but it MUST NOT claim model readiness unless streaming-owned conversion evidence exists.

#### Scenario: Session created while streaming conversion is running

- **WHEN** a review session is created for a model version whose streaming conversion job is `queued` or `running`
- **THEN** session lifecycle MAY be `created` or `active`
- **AND** stream config reports `model.status="converting"` and `conversion_authority="bim-streaming-server"`

#### Scenario: Session created after streaming conversion passed

- **WHEN** `bim-streaming-server` reports conversion result ready and `_bim-control` metadata has the ready artifact
- **THEN** stream config includes `model.status="ready"`, `conversion_job_id`, artifact URL, mapping URL, and quality summary when available

#### Scenario: Streaming conversion failed

- **WHEN** streaming-owned conversion job failed
- **THEN** session lifecycle MUST NOT hide the failure
- **AND** stream config reports `model.status="failed"` with failure code or diagnostic reference


### Requirement: Operator 結束 session controlled action（重用 close 路由 + 模式 3 audit）

協調器 SHALL 對 review session 提供 operator 可在 `#sessions` 觸發的「結束 session」controlled action，沿用 IX 模式 3（intent→confirm→audited）。本動作**重用既有 `POST /api/review-sessions/:sessionId/close`**（不開新 `/terminate` 路由）：operator terminate 在語意上是 cooperative close 的超集（drain→`releaseKitBindings` + append 終結事件）。close 路由 additive 接受 optional `reason`（經 `.trim()`，空白/空字串視同無 reason）並把 `reason`/`actor`（caller header best-effort 或 `local-operator`）寫進既有 `sessionClosing`/`sessionClosed` 事件 payload 作 audit；`reason` 不外溢回傳 body。既有 cooperative close 呼叫端（帶 `final_events`、不帶 `reason`）行為零退化。audit「who」為 best-effort（B 方案 LAN、無 RBAC），不偽造身分。本動作只釋放 coordinator 端 session/binding，**不殺 GPU 上的 Kit 行程**（Kit lifecycle 屬 kit-manager-api）。

#### Scenario: operator 結束 active session（帶 reason）

- **WHEN** operator 對 `status==="active"` 的 session 點 per-row「結束 session」鈕、於 `IntentDialog` 確認（可選填 reason）→ `POST /api/review-sessions/:id/close {reason}`
- **THEN** session 經 `closing`→`closed` 狀態機釋放 Kit binding（`releaseKitBindings`），`sessionClosing`/`sessionClosed` 事件 payload 含 `reason`/`actor`，回 200 並回傳 `closed` session 物件（`reason` 不在 body）

#### Scenario: 既有 cooperative close 零退化（不帶 reason）

- **WHEN** 既有 viewer 呼叫端帶 `final_events`、不帶 `reason` 觸發 close
- **THEN** 行為與本變更前一致：`reason`/`actor` 不入 payload（形狀不變）、`final_events` 照常 append、`releaseKitBindings` 照常、冪等（已 closed 回傳）/safe-id 400/不存在 404 零改動

#### Scenario: reason 經 trim、空白不污染 audit

- **WHEN** close 帶 `reason:"   "`（純空白）或 `reason:""`（空字串）
- **THEN** 後端 `.trim()||undefined` 視同無 reason，`sessionClosing`/`sessionClosed` payload 不含 `reason`/`actor`，cooperative payload 形狀不退化

#### Scenario: close 路由刻意不加 IP allowlist 守門（使用者裁定 A）

- **WHEN** 評估是否對 close 路由比照 sibling controlled-action（prioritize/retry/watch）補 `rejectIfIpNotAllowed`
- **THEN** close 路由刻意**不加** IP 守門——因同端點同時服務 browser-originated cooperative close 與 operator terminate，兩者無 header/body 欄位可區分，加門控會讓既有 cooperative 呼叫端在 IP 不在 allowlist 時吃 403（違反零退化）；路由頂端以註解記錄此刻意缺席避免日後誤補

#### Scenario: 前端 #sessions per-row 結束鈕與灰列因果

- **WHEN** `#sessions` 表渲染 sessions（`active` / `closing` / `closed` 混合）
- **THEN** 僅 `status==="active"` 的列顯示「結束 session」鈕（`closing`/`closed` 顯狀態文字、不給假按鈕）；點按為非樂觀（POST 成功後 `load()` 重抓真 `runtime/status`），成功後該列轉灰（`ec-row-muted`）60s 再從可見列移除（timer 以 `useEffect` cleanup 清除防 leak）；失敗（400/404/5xx）顯誠實錯誤、不改狀態、不關 dialog
