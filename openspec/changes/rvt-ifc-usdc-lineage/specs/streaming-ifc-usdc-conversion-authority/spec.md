## MODIFIED Requirements

### Requirement: `bim-streaming-server` owns IFC→USDC conversion jobs under B 方案

`bim-streaming-server` SHALL remain the authority for IFC→USDC conversion jobs as an internal conversion engine. When the primary Kit/HOOPS converter cannot import a source IFC but the source IFC is locally readable and parseable by an approved host-native IFC parser, `bim-streaming-server` SHALL attempt a real geometry fallback conversion within the same conversion authority boundary before publishing a terminal failed result. The fallback MUST produce a real OpenUSD/USDC stage and the required sidecars; it MUST NOT publish placeholder USDC, fake mapping, or smoke-only artifacts as ready.

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：在 governed lineage 下，`bim-streaming-server` 仍 SHALL 是 IFC→USDC conversion execution 的 authority，並 SHALL 擁有其 immutable `attempt_id` 的配置、attempt-scoped result prefix 的內容與 `result-manifest.json` 的發布動作。Coordinator 擁有的 stable `pipeline_job_id`、durable orchestration／admission state 與 active-result pointer MUST NOT 被視為第二個 conversion authority；反之 `bim-streaming-server` MUST NOT 建立第二個 logical job、active-result pointer 或任何 cloud lineage publication。這些 governed identity 與狀態的契約由 `conversion-attempt-publication`、`conversion-runtime-admission` 與 `cloud-lineage-publication` 擁有，本 capability 只擁有執行面。既有 fallback、驗證與 non-ready 誠實行為 SHALL 不變。

#### Scenario: HOOPS import failure falls back to real OpenUSD conversion

- **WHEN** a valid internal conversion request points to a local IFC that has been downloaded by `bim-review-coordinator`
- **AND** the primary Kit/HOOPS conversion fails with an IFC import failure such as `A3D_LOAD_CANNOT_LOAD_MODEL`
- **AND** the IFC can be parsed and tessellated by the host-native fallback converter
- **THEN** `bim-streaming-server` attempts fallback conversion under the same `conversion_job_id`
- **AND** the final result returns `ready=true`, `model.status="ready"`, and a `model_usdc` artifact ref only if the fallback writes an openable `model.usdc`
- **AND** the result includes `element_mapping`, `entity_index`, `metadata`, lineage, and quality metrics generated from the real IFC geometry
- **AND** `bim-review-coordinator` can ingest the ready result for local web view handoff and callback outbox metadata

#### Scenario: fallback prerequisites missing remain honest non-ready failures

- **WHEN** the primary converter fails and the fallback parser or OpenUSD runtime is unavailable
- **THEN** the conversion job records a non-ready failure with actionable diagnostics
- **AND** `bim-streaming-server` MUST NOT mark `model.status="ready"`
- **AND** coordinator/viewer readiness remains non-passed

#### Scenario: fallback output is validated before ready publication

- **WHEN** fallback conversion writes `model.usdc`
- **THEN** `bim-streaming-server` opens the produced stage with USD runtime before publishing the result
- **AND** validates that at least one renderable mesh prim exists
- **AND** validates that required sidecars exist
- **AND** rejects placeholder or fake smoke outputs

#### Scenario: job 與 attempt 的 ownership 不重疊

- **WHEN** governed source bundle 進入 `READY` 並由 coordinator 建立 stable `pipeline_job_id`
- **THEN** `bim-streaming-server` SHALL 只在該 job 下配置 immutable `attempt_id` 並執行轉換
- **AND** 它 MUST NOT 建立第二個 logical job、active-result pointer 或 cloud lineage publication
- **AND** streaming restart 或 replay MUST NOT 造成第二個 `pipeline_job_id`

### Requirement: Streaming conversion preserves quality metrics and mapping semantics

`bim-streaming-server` SHALL preserve existing conversion quality semantics when
it becomes conversion authority. When the fallback converter is the
materialization strategy, the quality metrics document SHALL additionally
declare semantic mapping fidelity so downstream consumers can distinguish a
shape-level fallback from an IFC-semantic fallback without re-parsing the mapping
artifact body.

Governed 邊界（`rvt-ifc-usdc-lineage` 新增）：本 requirement 的 `source_ifc_entity_count`、`mapped_count`、`unmapped_count`、`coverage_ratio` 與 `coverage_status` SHALL 保留既有 IFC→USDC 語意，MUST NOT 被重新命名、重新定義或當成 RVT↔IFC↔USDC lineage accuracy。三向 lineage 的 `ifc_usdc_coverage_ratio`、`rvt_ifc_alignment_ratio` 與 `rvt_ifc_usdc_lineage_ratio` 由 `rvt-ifc-usdc-lineage` 擁有並各自宣告分母；governed report 若沿用 `source_ifc_entity_count`，其 schema MUST 明定它是 eligible source `IfcProduct` 集合的 alias。既有 workflow callback 與既有 consumer 讀到的 quality metrics 形狀 SHALL 不變。

#### Scenario: Quality metrics are returned

- **WHEN** conversion completes
- **THEN** result includes `source_ifc_entity_count`, `mapped_count`,
  `unmapped_count`, `coverage_ratio`, `coverage_status`,
  `materialization_strategy`, `sidecar_carrier_count`, and
  `minimum_coverage_baseline_locked`

#### Scenario: Mapping is not fabricated

- **WHEN** IFC element cannot be mapped to a USD prim
- **THEN** the element is listed as unmapped or sidecar-only according to policy
- **AND** fake GUID/prim mapping MUST NOT be generated unless
  `allow_fake_mapping=true` and the result is clearly marked `fake_for_smoke_test`

#### Scenario: Entity index sidecar is preserved

- **WHEN** sidecar carrier strategy is used
- **THEN** the result includes an `entity_index` artifact identity/URL
- **AND** lineage indicates the sidecar relation between the IFC source, USDC
  artifact, mapping artifact, and entity index artifact

#### Scenario: Fallback quality metrics declare semantic mapping fidelity

- **WHEN** conversion completes via the `IfcOpenShell + OpenUSD` fallback
  (`materialization_strategy == "ifcopenshell_openusd_fallback"`)
- **THEN** the result `quality_metrics` SHALL additionally include
  `semantic_mapping_fidelity` (string), `mapping_has_ifc_type` (boolean), and
  `mapping_has_ifc_name` (boolean)
- **AND** these three fields SHALL NOT be required for the primary HOOPS path
  in this change (HOOPS path remains out of scope)

#### Scenario: generic coverage_ratio 不得冒充 RVT lineage

- **WHEN** governed alignment report 需要 RVT↔IFC↔USDC 覆蓋率
- **THEN** 系統 SHALL 使用 `rvt-ifc-usdc-lineage` 定義的三個具名 ratio，各自附 `numerator`、`denominator` 與 `status`
- **AND** 既有 `coverage_ratio` SHALL 維持 IFC→USDC 意義且 MUST NOT 被重新命名
- **AND** governed report 若沿用 `source_ifc_entity_count`，其 schema SHALL 明定為 eligible `IfcProduct` count 的 alias
