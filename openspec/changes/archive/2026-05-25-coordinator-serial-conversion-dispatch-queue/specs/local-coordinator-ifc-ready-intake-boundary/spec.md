# local-coordinator-ifc-ready-intake-boundary — Spec Delta (coordinator-serial-conversion-dispatch-queue)

> Delta against `openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md`。
> 本 change 在 coordinator IFC-ready intake 路徑加入 in-memory FIFO,序列化對
> `bim-streaming-server` 的 conversion dispatch。

## ADDED Requirements

### Requirement: Coordinator serializes concurrent IFC-ready dispatch with in-memory FIFO

`bim-review-coordinator` SHALL serialize the dispatch step (the synchronous
`POST /api/conversions/ifc-to-usdc` call to `bim-streaming-server`) for
`POST /api/external/ifc-ready` jobs using an in-memory FIFO queue. At any point
in time at most one job MAY be `in-flight` to streaming-server. Additional jobs
that have completed their local IFC download but are waiting for the dispatch
slot SHALL be reported with lifecycle status `queued_for_conversion` and an
integer `queue_position` (1-based). The HTTP `POST /api/external/ifc-ready`
response SHALL NOT block on the queue; it SHALL still return `202 Accepted`
immediately after the local intake / download stage.

This requirement is additive and MUST preserve the existing single-job happy
path: when only one job is being processed, behavior MUST be equivalent to the
pre-queue flow (no observable `queued_for_conversion` from the consumer's
perspective is required, though the store MAY transition through it briefly).

#### Scenario: Two concurrent ifc-ready POSTs serialize dispatch

- **WHEN** two `POST /api/external/ifc-ready` requests arrive while
  `bim-streaming-server` is intentionally slow to respond to the first
  `POST /api/conversions/ifc-to-usdc`
- **THEN** the first job SHALL be observable as `status="dispatched"` (or
  transitional `status` reflecting in-flight dispatch) and SHALL NOT carry a
  positive `queue_position`
- **AND** the second job SHALL be observable with `status="queued_for_conversion"`
  and `queue_position >= 1` while the first dispatch is still in-flight
- **AND** the second job's `queue_position` MUST be 1 (only one job ahead)

#### Scenario: Queued job dispatches after in-flight completes

- **WHEN** the streaming-server returns a response for the first job's dispatch
  (success or failure)
- **THEN** the queue worker SHALL pick up the next queued job and dispatch it
- **AND** that previously queued job SHALL transition from
  `queued_for_conversion` to `dispatched` (on success) or `dispatch_failed` (on
  dispatch error)
- **AND** the dispatched job's `queue_position` SHALL be cleared (`null`)

#### Scenario: In-flight dispatch failure does not block queued items

- **WHEN** the first job's streaming-server dispatch fails (network error,
  non-2xx response, exception)
- **THEN** the first job SHALL transition to `status="dispatch_failed"`
- **AND** the queue worker SHALL proceed to dispatch the next queued job
  regardless of the first job's outcome
- **AND** the queue worker MUST NOT remain stuck on a failed in-flight slot

#### Scenario: Coordinator restart drops queued jobs

- **WHEN** the coordinator process is restarted (or the queue is explicitly
  drained for test / shutdown purposes)
- **THEN** every job that was in `queued_for_conversion` state SHALL be marked
  `status="dropped_on_restart"`
- **AND** subsequent `GET /api/external/ifc-ready/:jobId` responses SHALL show
  this `dropped_on_restart` lifecycle
- **AND** operators SHALL be expected to re-submit those IFC-ready POSTs
  (documented in the runbook)
- **AND** in-flight jobs (mid-dispatch) MAY still complete naturally; this
  scenario only covers the queued-but-not-yet-dispatched set

#### Scenario: Single-job happy path is unchanged

- **WHEN** a single `POST /api/external/ifc-ready` arrives with no other jobs
  in flight or queued
- **THEN** the resulting end state SHALL match the pre-queue behavior:
  `status="dispatched"` with a `conversion_job_id`, optional
  `conversion_status` from streaming-server, and no positive `queue_position`
- **AND** existing happy-path smoke (e.g. `scripts/smoke-bscheme-intake.ps1`)
  SHALL continue to pass without modification

#### Scenario: Queue does not delay HTTP response

- **WHEN** any `POST /api/external/ifc-ready` is enqueued for dispatch
- **THEN** the HTTP response SHALL still return `202 Accepted` immediately
  after the local IFC download stage completes
- **AND** the response MUST NOT block on the streaming-server dispatch
- **AND** `GET /api/external/ifc-ready/:jobId` SHALL be the supported way for
  clients to observe the eventual queue / dispatch progression
