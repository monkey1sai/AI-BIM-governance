## MODIFIED Requirements

### Requirement: Terminal conversion-ready ingestion triggers local review session handoff

When `bim-review-coordinator` conversion ingestion reaches a terminal `ready` state for a correlated IFC-ready job, the coordinator SHALL trigger local review session creation or activation separately from, and in parallel with, the metadata-only callback outbox. Callback outbox delivery state and local session handoff state SHALL remain independently classified: a pending or dead-letter cloud callback MUST NOT block the local session handoff, and a successful local session handoff MUST NOT be reported as cloud callback success. A terminal `failed` conversion MUST NOT create an openable or streamable local review session. Review session creation, binding, idempotency, and lifecycle details are governed by `review-session-request-lifecycle`; this requirement only fixes the seam that terminal `ready` ingestion is what triggers that handoff in the B-scheme runtime.

> **Implementation status (2026-05-21)**: this requirement was ratified by archive `2026-05-21-coordinator-ifc-ready-worker-webhook` but the seam was never wired in `ingestConversionReport` (`bim-review-coordinator/src/app.ts:566-628`); only `callbackOutbox.enqueue` ran on terminal `ready` (retro-audit commit `a32fcd6`). Change `backfill-coordinator-webhook-and-auto-session` backfills the in-process trigger so the outbox and the local session handoff both run on terminal `ready` with independently classified status. See its `tasks.md` for the scenario-to-test mapping.

#### Scenario: Ready ingestion triggers session handoff alongside callback outbox

- **WHEN** coordinator conversion ingestion reaches terminal `ready` for a correlated IFC-ready job
- **THEN** the coordinator enqueues the metadata-only cloud callback in the outbox
- **AND** in parallel triggers local review session creation or activation for that correlation
- **AND** the two outcomes are reported as independently classified states

#### Scenario: Pending cloud callback does not block local session handoff

- **WHEN** the metadata-only cloud callback is `pending` or moved to dead-letter because the company-cloud endpoint is unavailable
- **THEN** the local review session handoff still proceeds for a terminal `ready` conversion
- **AND** the local session is not reported as cloud callback success

#### Scenario: Failed conversion creates no local session

- **WHEN** coordinator conversion ingestion reaches terminal `failed`
- **THEN** the coordinator MUST NOT create an openable or streamable local review session
- **AND** the callback metadata reports `failed` or an equivalent not-ready state
