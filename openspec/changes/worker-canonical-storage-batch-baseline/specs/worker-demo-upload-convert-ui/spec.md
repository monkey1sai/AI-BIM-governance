## MODIFIED Requirements

### Requirement: Worker UI visualizes lineage and quality status

Worker demo UI SHALL expose a lineage and conversion quality view for worker artifacts. The UI MUST use `_worker` APIs such as `GET /api/artifacts/{artifact_id}/lineage`, `GET /api/conversions/{conversion_job_id}/result`, and `GET /api/artifact-groups/{artifact_group_id}/readiness` rather than reading local files directly。

The view MUST remain scoped to artifact intake、conversion observability、lineage、quality evidence 與 review viewer handoff。It MUST NOT provide review issue editing、annotation editing、session lifecycle management、WebRTC streaming controls，or direct USD/USDC rendering。

When a conversion result contains an openable `model.usdc`, stable artifact IDs, and readiness data, the worker UI SHALL expose enough information or an explicit action for the user to open the converted result through the existing review viewer flow. That handoff MUST preserve `conversion_job_id`, `artifact_group_id`, source artifact ID, derived USDC artifact ID or URL, mapping artifact ID or URL, and quality status。

#### Scenario: User opens lineage for a converted artifact

- **WHEN** a conversion job succeeds and the user opens its lineage view
- **THEN** the UI displays source IFC, derived USDC, index artifacts, mapping artifact, stable artifact IDs, conversion job ID, artifact group ID, object URLs, metadata URL, and quality status

#### Scenario: Quality status is visible

- **WHEN** lineage API or conversion result returns quality metrics
- **THEN** the UI displays coverage ratio, `minimum_coverage_ratio`, baseline lock status, `coverage_denominator=source_ifc_entity_count`, mapped/unmapped IFC entity counts, coverage status, and warnings or diagnostics when present

#### Scenario: Warning quality remains reviewable

- **WHEN** the lineage API or conversion result reports `coverage_status=warn`
- **THEN** the UI keeps the review handoff available while clearly showing degraded mapping quality and MUST NOT label issue-to-real-prim readiness as verified

#### Scenario: Lineage is incomplete

- **WHEN** the lineage API reports missing mapping, missing derived artifact, legacy metadata gaps, or unavailable quality metrics
- **THEN** the UI displays the incomplete state without hiding the source artifact or exposing absolute local filesystem paths

#### Scenario: Converted USDC has review viewer handoff

- **WHEN** a conversion result exposes an openable worker-produced `model.usdc`, artifact group readiness, and lineage data
- **THEN** the UI exposes a preview/open action or equivalent handoff data that routes to `bim-review-coordinator` or the existing review viewer flow with the stable artifact IDs and URLs needed to load the USDC

#### Scenario: Worker UI does not render USDC directly

- **WHEN** the user wants to inspect the converted `model.usdc`
- **THEN** the worker UI routes the user to the review viewer / Kit path and MUST NOT parse USD, render USDC, open a WebRTC stream, or manage review session lifecycle inside `_worker`

#### Scenario: Review workflow remains outside worker UI

- **WHEN** an artifact group is ready and lineage is visible in the worker UI
- **THEN** the next review action still routes to `bim-review-coordinator` or the existing review viewer flow, and the worker UI does not manage review sessions
