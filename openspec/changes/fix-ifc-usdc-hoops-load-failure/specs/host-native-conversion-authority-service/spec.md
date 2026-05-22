# host-native-conversion-authority-service — Spec Delta (fix-ifc-usdc-hoops-load-failure)

> Delta against `openspec/specs/host-native-conversion-authority-service/spec.md`。本 change 擴充 host-native converter adapter 的真實 fallback conversion 行為。

## MODIFIED Requirements

### Requirement: Host-native converter adapter publishes only validated artifacts

The host-native conversion authority service SHALL publish a ready result only when validated artifacts are present. If the primary PowerShell/Kit/HOOPS converter fails to import a locally readable IFC, the adapter MAY use an IfcOpenShell + OpenUSD fallback converter, but only when the fallback produces a real `model.usdc`, `element_mapping.json`, `entity_index.json`, `metadata.json`, and quality metrics derived from the source IFC. The fallback output MUST pass the same no-placeholder and openability gates as primary converter output.

#### Scenario: fallback converter produces publishable artifacts

- **WHEN** the primary converter fails with a source IFC import error
- **AND** the fallback converter successfully tessellates source IFC geometry and writes `model.usdc`
- **THEN** `GET /api/conversions/{conversion_job_id}/result` returns `status="succeeded"` or an explicitly allowed warning status
- **AND** `model.status="ready"`
- **AND** `artifacts.model_usdc.url`, `artifacts.element_mapping.url`, `artifacts.entity_index.url`, and metadata refs are present
- **AND** `quality_metrics.materialization_strategy="ifcopenshell_openusd_fallback"`

#### Scenario: fallback converter does not fabricate mappings

- **WHEN** a source IFC entity cannot be represented as a renderable USD prim by the fallback converter
- **THEN** the entity is reported as unmapped, sidecar-only, or omitted according to documented fallback policy
- **AND** the converter MUST NOT create fake GUID-to-prim mappings to inflate coverage
- **AND** `element_mapping.json` MUST identify `mock=false`

#### Scenario: final archive evidence requires real fallback success

- **WHEN** this OpenSpec change is considered for archive
- **THEN** the archived evidence MUST include a real runtime conversion of the user-provided or equivalent 341MB IFC that reaches ready conversion state
- **AND** unit-only or fake converter tests MUST NOT be sufficient archive evidence
