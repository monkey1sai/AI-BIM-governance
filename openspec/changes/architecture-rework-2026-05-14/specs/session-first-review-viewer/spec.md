# session-first-review-viewer Specification Delta

## MODIFIED Requirements

### Requirement: Viewer displays streaming-owned conversion and composition status

`web-viewer-sample` SHALL consume session-first stream config that may include `conversion_authority="bim-streaming-server"`, `conversion_job_id`, model readiness, quality summary, and stage composition summary. The viewer SHALL display this data read-only and SHALL NOT recompute or persist conversion metrics.

#### Scenario: Ready model with streaming conversion authority

- **WHEN** stream config reports `model.status="ready"` and `conversion_authority="bim-streaming-server"`
- **THEN** viewer displays the conversion authority, job id, quality summary if present, and primary/secondary layer summary

#### Scenario: Model still converting

- **WHEN** stream config reports `model.status="converting"`
- **THEN** viewer displays a degraded/pending state
- **AND** it MUST NOT send `openStageRequest` as if the model were ready unless user explicitly uses a debug/manual override

#### Scenario: Viewer does not own conversion

- **WHEN** viewer fetches conversion result in dev mode for display
- **THEN** the fetch is read-only
- **AND** production build MUST NOT rely on viewer-side fallback to establish conversion readiness
