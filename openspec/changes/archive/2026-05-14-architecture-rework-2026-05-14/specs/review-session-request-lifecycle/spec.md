# review-session-request-lifecycle Specification Delta

## ADDED Requirements

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
