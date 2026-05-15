# worker-artifact-pipeline Specification

## Purpose
Define `_worker` as the artifact and conversion facade for source model files,
derived USDC artifacts, indices, mapping files, versioned object layout,
conversion lineage, original filename traceability, real IFC conversion output,
and conversion quality reporting. `_worker` owns file bytes and derived
artifact bodies while publishing metadata only to `_bim-control`.
## Requirements
### Requirement: Worker accepts source artifacts

`_worker` SHALL expose `POST /api/artifacts` for IFC/RVT/DWG source artifact intake. The request MUST include enough lineage context to associate the file with `tenant_id`, `project_id`, `model_version_id`, `source_system`, and uploader identity. `_worker` SHALL persist file bytes in its object layer and return a stable `source_artifact_id`, checksum, object URL, and upload status without making `_bim-control` store file bytes.

#### Scenario: Source IFC artifact is uploaded

- **WHEN** a client calls `POST /api/artifacts` with a valid IFC file or signed upload reference and model lineage fields
- **THEN** `_worker` returns a `source_artifact_id`, checksum, object URL, and `status=uploaded`

#### Scenario: Source artifact is missing lineage

- **WHEN** a client calls `POST /api/artifacts` without `project_id` or `model_version_id`
- **THEN** `_worker` rejects the request and does not create an orphan artifact

### Requirement: Worker manages conversion jobs

`_worker` SHALL expose `POST /api/conversions` to create conversion jobs from a `source_artifact_id`. A conversion job MUST track `queued`, `running`, `succeeded`, and `failed` states, and it MUST record `target_format`, `generate_mapping`, `created_at`, and conversion lineage.

#### Scenario: USDC conversion is queued

- **WHEN** a client calls `POST /api/conversions` with an existing `source_artifact_id`, `target_format=usdc`, and `generate_mapping=true`
- **THEN** `_worker` returns a `conversion_job_id` with `status=queued`

#### Scenario: Conversion source is unknown

- **WHEN** a client calls `POST /api/conversions` with an unknown `source_artifact_id`
- **THEN** `_worker` returns an error and does not enqueue a conversion job

### Requirement: Worker publishes derived artifact results

`_worker` SHALL expose `GET /api/conversions/{id}` and `GET /api/conversions/{id}/result`. A succeeded result MUST include derived artifact identifiers and URLs for `model.usdc`, `ifc_index.json`, `usd_index.json`, and `element_mapping.json` when mapping generation is requested.

#### Scenario: Conversion result is ready

- **WHEN** a conversion job has succeeded
- **THEN** `GET /api/conversions/{id}/result` returns derived artifact IDs, object URLs, `mapping_url`, and conversion lineage

#### Scenario: Conversion result is not ready

- **WHEN** a conversion job is still `queued` or `running`
- **THEN** `GET /api/conversions/{id}/result` reports the current status and does not claim derived artifacts are ready

### Requirement: Worker uses versioned object layout

`_worker` MUST store source and derived artifacts under a versioned object layout that includes tenant, project, model version, artifact group, source artifact, and conversion job lineage. Each artifact group MUST include `metadata.json` with `artifact_id`, `parent_artifact_id`, `artifact_group_id`, `source_system`, `source_format`, `sha256`, `version_no`, `uploaded_by`, `conversion_job_id`, `created_at`, and lineage.

#### Scenario: Derived USDC files are written

- **WHEN** a conversion job succeeds
- **THEN** `_worker` writes derived files under `derived/{conversion_job_id}/usdc/` and writes `metadata.json` with lineage fields

#### Scenario: Duplicate source bytes are uploaded

- **WHEN** a source artifact with the same checksum is uploaded again for the same model version
- **THEN** `_worker` records lineage without overwriting unrelated artifact groups

### Requirement: Worker reports metadata without taking BIM authority

`_worker` MUST notify `_bim-control` of conversion success or failure using metadata, artifact IDs, URLs, mapping URL, and lineage. `_worker` MUST NOT become the authority for project, model version, review issue, annotation, or review intent data.

#### Scenario: Conversion success is reported

- **WHEN** `_worker` completes a conversion job successfully
- **THEN** `_bim-control` can discover ready artifact metadata while the file bytes remain owned by `_worker`

#### Scenario: Conversion fails

- **WHEN** `_worker` cannot produce the requested target artifact
- **THEN** `_worker` reports failure metadata and log URL without creating a ready artifact record

### Requirement: Worker preserves original filename in source metadata

`_worker` SHALL preserve the unsanitized client-provided filename as `original_filename` in source artifact metadata, the source artifact index, the source artifact API response, and the conversion result payload published to `_bim-control`. Disk object names MAY remain sanitized for path safety, but the metadata layer MUST keep the original filename so traceability survives across non-ASCII or special characters.

#### Scenario: Source artifact metadata records the original filename

- **WHEN** a client calls `POST /api/artifacts` with a `filename` containing non-ASCII characters or characters outside `[A-Za-z0-9_.-]`
- **THEN** the source artifact `metadata.json` written under the versioned object layout MUST include `original_filename` equal to the request `filename` byte-for-byte (no sanitization), while the on-disk object key MAY use a sanitized filename for path safety

#### Scenario: Source artifact index records the original filename

- **WHEN** `_worker` upserts an entry into `data/objects/_index/source_artifacts.json`
- **THEN** the entry MUST include `original_filename` so that consumers can recover the original filename without opening the per-artifact `metadata.json`

#### Scenario: Source artifact API response includes the original filename

- **WHEN** `POST /api/artifacts` succeeds
- **THEN** the response body MUST include `original_filename` equal to the request `filename`

#### Scenario: Conversion result includes the original filename

- **WHEN** a conversion job started from any source artifact succeeds
- **THEN** `GET /api/conversions/{conversion_job_id}/result` MUST include `original_filename` carried from the source artifact metadata

#### Scenario: Callback to BIM control includes the original filename

- **WHEN** `_worker` publishes a successful conversion result to `_bim-control` via the model-version conversion-result callback
- **THEN** the callback payload MUST include `original_filename`, and `_bim-control` MUST set the source IFC artifact `name` field to that value when present, falling back to the existing default name when the field is absent

#### Scenario: Backward-compatible reads of legacy metadata

- **WHEN** `_worker` reads an existing `metadata.json` or `_index/source_artifacts.json` entry that was written before this requirement existed
- **THEN** the read path MUST treat `original_filename` as optional and MUST NOT fail or refuse to serve the artifact when the field is missing

### Requirement: Worker produces real IFC conversion artifacts

`_worker` SHALL produce real derived artifacts for IFC `target_format=usdc` conversion jobs. A successful conversion job MUST write a `model.usdc` that can be opened by a USD stage reader and MUST NOT use placeholder text, empty files, or fake geometry as the ready artifact.

The first implementation uses an internal adapter boundary backed by external
`ifcopenshell` geometry extraction and `usd-core` stage writing. These packages
remain external prerequisites; missing packages or incompatible local runtime
state MUST fail the job instead of falling back to placeholder output.

#### Scenario: IFC conversion writes an openable USDC

- **WHEN** a conversion job for an IFC source artifact succeeds with `target_format=usdc`
- **THEN** `_worker` writes `model.usdc` under the derived object layout and records evidence that the file can be opened by a USD stage reader with at least one renderable prim

#### Scenario: Converter is unavailable

- **WHEN** `_worker` cannot run the configured real IFC converter
- **THEN** the conversion job is marked `failed`, the artifact group is not marked ready, and the result reports the missing converter prerequisite without creating a ready placeholder USDC

#### Scenario: Converter output is not openable

- **WHEN** the converter returns a file that cannot be opened by a USD stage reader
- **THEN** `_worker` marks the conversion job `failed` or non-ready and records validation diagnostics instead of publishing the file as `model.usdc`

### Requirement: Worker derives indices and mapping from real conversion output

`_worker` SHALL produce `ifc_index.json`, `usd_index.json`, and `element_mapping.json` from the source IFC content and the converted USD / USDC stage. Mapping output MUST identify whether each entry is derived from a reliable IFC GUID / USD prim relationship and MUST NOT label fabricated mapping entries as real coverage. `element_mapping.json` MUST support one IFC GUID mapped to multiple USD prim paths by providing `primary_usd_prim_path` for UI / highlight / focus and `usd_prim_paths` for the complete mapping. It MUST also provide `usd_prim_path` as a backward-compatible alias for `primary_usd_prim_path` while existing viewer consumers require that scalar field. Fallback or synthetic ids generated by the converter MUST NOT be treated as source IFC GUIDs, MUST NOT increment `mapped_count`, and MUST NOT increase `coverage_ratio`.

The current mapping method is `ifcopenshell_geometry_guid_to_usd_mesh`: one IFC
GUID may produce multiple mesh prims when the geometry iterator emits multiple
shapes for the same product.

#### Scenario: Real indices are written

- **WHEN** an IFC conversion job succeeds with `generate_mapping=true`
- **THEN** `_worker` writes `ifc_index.json` with source IFC element counts, `usd_index.json` with USD prim counts, and `element_mapping.json` with mappings derived from the conversion output

#### Scenario: Mapping is incomplete

- **WHEN** some IFC elements cannot be matched to USD prim paths
- **THEN** `element_mapping.json` records mapped and unmapped counts, coverage ratio, and unmapped reasons when available

#### Scenario: Converted shape lacks a source IFC GUID

- **WHEN** a converter-emitted USD shape has no source IFC `GlobalId`, or its GUID is not present in `ifc_index.json`
- **THEN** `_worker` MAY still write the USD prim for renderability, but MUST NOT create a real mapping entry using a fallback or synthetic id
- **AND** `_worker` MUST record the condition as unmapped or diagnostic evidence without incrementing `mapped_count` or `coverage_ratio`

#### Scenario: IFC element maps to multiple USD prims

- **WHEN** a converted IFC element is represented by more than one USD prim
- **THEN** `element_mapping.json` records one `primary_usd_prim_path` for UI focus, a matching `usd_prim_path` alias for current viewer compatibility, and all related paths in `usd_prim_paths`

#### Scenario: Mapping generation is disabled

- **WHEN** an IFC conversion job succeeds with `generate_mapping=false`
- **THEN** `_worker` MAY omit `element_mapping.json`, but the conversion result MUST clearly report `mapping_url=null` and MUST NOT claim issue-to-prim highlight readiness

### Requirement: Worker reports conversion quality before enforcing coverage gates

`_worker` SHALL only mark an artifact group ready for review when the real conversion output passes hard quality gates. Hard gates MUST include USDC openability, renderable prim presence, non-placeholder output, and truthful mapping output when `generate_mapping=true`.

Mapping coverage MUST be measured and reported when `generate_mapping=true`. Before a baseline is locked, `_worker` MUST continue to report coverage as observed data and MUST NOT fail CI only because coverage is below an unstabilized threshold. After baseline stabilization, `_worker` MUST expose a locked minimum coverage policy with `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status`, and policy diagnostics.

Coverage calculation MUST include every source IFC entity in the denominator. `_worker` MUST carry every IFC entity in the artifact group with stable traceability back to the source IFC entity. Each source IFC entity's carrier MUST be one of: (a) a renderable or highlightable USD prim authored into `model.usdc` when geometry exists, (b) a non-renderable USD prim authored into `model.usdc`, or (c) a sidecar mapping artifact entry (`element_mapping.json` or a dedicated `entity_index.json`) that records the same stable IFC traceability fields. The chosen carrier MUST preserve IFC class, entity identifier, GlobalId when present, Name when present, and relationship metadata when available. No IFC entity class may be excluded from coverage solely because it is not renderable, regardless of which carrier is used.

Every source IFC entity MUST resolve to at least one carrier — a USD prim path or a sidecar mapping entry — for `coverage_status=pass`, **including geometry-shape source IFC entities that lack `ifc_guid` and were not authored as a renderable USD prim**. Such entries MUST land in the sidecar mapping artifact with `ifc_guid=null` while still recording `ifc_entity_key`, `ifc_entity_id`, and `ifc_class`. When coverage status is `warn`, `_worker` MAY keep the artifact group eligible for review-session creation as degraded quality, but MUST NOT classify issue-to-real-prim readiness as verified. When coverage status is `fail`, `_worker` MUST NOT claim mapping readiness or issue-to-real-prim highlight readiness.

When a sidecar carrier is used for non-renderable IFC entities, the conversion result and lineage MUST surface the sidecar artifact alongside `model.usdc`, `ifc_index.json`, `usd_index.json`, and `element_mapping.json`, so that `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` can continue to obtain complete coverage data without requiring those entities to be present as USD prims. Renderable mapped entries MUST keep existing `primary_usd_prim_path` / `usd_prim_path` / `usd_prim_paths` semantics.

Quality metrics MUST additionally expose an additive `no_guid_entity_count` diagnostic counting source IFC entities that lack `ifc_guid` and therefore rely on `ifc_entity_key` / `ifc_entity_id` for identity. The diagnostic MUST be backward-compatible (consumers that ignore it MUST NOT break).

#### Scenario: Hard quality gate passes

- **WHEN** a conversion job produces an openable USDC, renderable prims, non-placeholder output, and truthful mapping report
- **THEN** `_worker` marks the conversion job `succeeded`, returns derived artifact URLs, and includes coverage metrics in the result payload

#### Scenario: Mapping coverage is measured before threshold lock

- **WHEN** a conversion job produces an openable USDC and coverage report before a minimum threshold is locked
- **THEN** `_worker` returns the coverage report with `minimum_coverage_baseline_locked=false`, does not fail CI only for low coverage, and does not claim that minimum issue-to-real-prim coverage has been verified

#### Scenario: Mapping coverage passes locked threshold

- **WHEN** every source IFC entity resolves to at least one carrier (USD prim path or sidecar mapping entry)
- **THEN** `_worker` returns `minimum_coverage_baseline_locked=true`, `minimum_coverage_ratio=1.0`, `coverage_denominator=source_ifc_entity_count`, `coverage_status=pass`, the applied denominator, and no coverage failure diagnostic

#### Scenario: Mapping coverage falls into warning policy

- **WHEN** a conversion job produces openable USDC and mostly truthful mapping, but one or more IFC entities cannot be carried in either USD prim or sidecar form for a known, explicitly allowed degradation reason
- **THEN** `_worker` returns `coverage_status=warn`, preserves artifact traceability, keeps the artifact group eligible for review-session creation, and reports that issue-to-real-prim highlight readiness is degraded rather than verified

#### Scenario: Mapping coverage fails locked threshold

- **WHEN** any source IFC entity lacks any carrier (no USD prim and no sidecar mapping entry) and the condition is not covered by an explicitly allowed warning policy
- **THEN** `_worker` returns `coverage_status=fail`, records validation diagnostics, and MUST NOT mark mapping readiness or issue-to-real-prim highlight readiness as verified

#### Scenario: Quality metrics are exposed

- **WHEN** `GET /api/conversions/{conversion_job_id}/result` returns a conversion result with status `succeeded`
- **THEN** the payload includes converter identity, conversion duration, source IFC entity count, USD prim count, sidecar carrier count when present, mapped count, unmapped count, coverage ratio, `minimum_coverage_ratio`, denominator policy, baseline lock status, coverage status, validation warnings when present, and `no_guid_entity_count`

#### Scenario: Non-geometric IFC entity is carried with stable traceability

- **WHEN** the source IFC contains non-geometric entities such as property sets, type objects, relationship entities, project, site, building, or storey containers
- **THEN** `_worker` carries each entity in `model.usdc` (as a non-renderable USD prim) or in a sidecar mapping artifact, recording IFC class, entity identifier, GlobalId when present, Name when present, and relationship metadata when available
- **AND** those entities are included in `source_ifc_entity_count` and coverage calculation regardless of which carrier was used

#### Scenario: Sidecar carrier is surfaced in conversion result and lineage

- **WHEN** `_worker` uses a sidecar mapping artifact to carry non-renderable IFC entity identity
- **THEN** the conversion result, `derived_artifact_ids`, and the lineage graph response identify the sidecar artifact alongside `model.usdc`, `ifc_index.json`, `usd_index.json`, and `element_mapping.json`
- **AND** downstream consumers can obtain complete coverage data without requiring non-renderable entities to be present as USD prims

#### Scenario: No-GUID geometry-shape entities are carried via sidecar

- **WHEN** the source IFC contains geometry-shape entities (for example construction geometry, mesh shape representations, or auxiliary geometry items) that lack `ifc_guid` and are not authored as renderable USD prims
- **THEN** `_worker` records each such entity in the sidecar mapping artifact with `ifc_guid=null` and preserved `ifc_entity_key`, `ifc_entity_id`, and `ifc_class`
- **AND** these entries count toward `mapped_count` and the `coverage_denominator=source_ifc_entity_count` calculation
- **AND** `coverage_status=pass` is reachable when no other carrier gaps remain

### Requirement: Worker optimizes non-renderable entity materialization for canonical IFC fixtures

`_worker` MUST treat `non_renderable_entity_materialization` as an owned, measurable conversion subphase when converting canonical IFC fixtures. The converter MUST preserve the all-IFC-entity coverage denominator while reducing per-entity authoring cost enough for canonical large fixtures to produce `model.usdc` within the configured per-fixture timeout.

`_worker` MUST NOT achieve materialization throughput by dropping non-renderable IFC entities from coverage, by substituting synthetic identifiers for real IFC GUIDs, by replacing all-entity coverage with `IfcProduct`-only / geometry-only / renderable-only coverage, or by marking unmaterialized entities as mapped.

During long-running canonical conversions, `_worker` MUST expose additive non-renderable materialization diagnostics such as `materialized_entity_count`, `materialization_strategy` (`usd_prim`, `sidecar`, or a documented hybrid), `elapsed_seconds`, `progress_write_count`, `last_operation`, and blocker details when available. These diagnostics MUST remain backward-compatible with existing conversion result and quality metrics payloads. Fine-grained profiling diagnostics MAY be enabled for verification evidence and MUST be optional.

#### Scenario: Canonical non-renderable materialization advances past timeout bottleneck

- **WHEN** canonical `--limit 1 --timeout-seconds 600` storage verification runs against the first 89MB fixture
- **THEN** `_worker` completes `non_renderable_entity_materialization` and produces `model.usdc` before timeout, or records deterministic blocker diagnostics that identify a non-`_worker` limitation
- **AND** the batch result remains non-passed if conversion still does not complete

#### Scenario: Materialization preserves all-entity denominator

- **WHEN** `_worker` optimizes non-renderable entity materialization
- **THEN** `source_ifc_entity_count`, `coverage_denominator=source_ifc_entity_count`, mapping output, and unmapped diagnostics still include all source IFC entities rather than only renderable geometry entities
- **AND** `mapped_count + unmapped_count = source_ifc_entity_count`

#### Scenario: Materialization diagnostics are additive

- **WHEN** non-renderable materialization emits progress or completion diagnostics
- **THEN** existing conversion result fields remain available
- **AND** new diagnostics are optional nested fields that consumers can ignore without breaking lineage, readiness, or review viewer handoff

#### Scenario: Sidecar carrier choice is recorded in diagnostics

- **WHEN** `_worker` materializes non-renderable IFC entities into a sidecar carrier instead of USD prims
- **THEN** the conversion phase diagnostics record `materialization_strategy=sidecar` and the count of entities written to the sidecar
- **AND** the artifact group readiness, lineage, and review viewer handoff continue to surface complete coverage data

#### Scenario: Optimization does not lock baseline prematurely

- **WHEN** non-renderable materialization improves but the full canonical batch has not passed all archived baseline gates
- **THEN** `_worker` keeps `minimum_coverage_locked=false` and records the remaining blocker or next gate

### Requirement: Worker exposes artifact lineage graph API

`_worker` SHALL expose `GET /api/artifacts/{artifact_id}/lineage` for source, derived model, index, and mapping artifact identifiers that belong to the worker object layout. The response MUST normalize existing `metadata.json`, source artifact index, artifact group index, conversion job result, and derived artifact identifiers into a single lineage graph without making `_bim-control` read local files or become artifact byte authority.

The lineage response MUST include `artifact_id`, `artifact_group_id`, `tenant_id`, `project_id`, `model_version_id`, `nodes[]`, `edges[]`, `root_source_artifact_id`, `conversion_job_ids[]`, `quality_metrics_summary`, and `diagnostics[]`. Nodes MUST identify source IFC, derived USDC, `ifc_index.json`, `usd_index.json`, `element_mapping.json`, and `metadata.json` when present. Every source, derived model, index, and mapping node MUST include a stable `artifact_id`. Derived model, index, and mapping node IDs MUST prefer the conversion result `derived_artifact_ids` values. Missing optional artifacts MUST be reported in `diagnostics[]` rather than causing a server error.

#### Scenario: Derived artifact lineage is queried

- **WHEN** a client calls `GET /api/artifacts/{artifact_id}/lineage` for a succeeded `model.usdc` artifact
- **THEN** `_worker` returns a lineage graph linking the source IFC artifact to the conversion job, derived USDC, index files, mapping file, and metadata URL
- **AND** the graph includes quality metrics summary for the conversion that produced the derived artifact
- **AND** derived USDC, IFC index, USD index, and element mapping nodes use the stable artifact IDs from `derived_artifact_ids`

#### Scenario: Mapping and index lineage are queried by stable ID

- **WHEN** a client calls `GET /api/artifacts/{artifact_id}/lineage` using `derived_artifact_ids.ifc_index`, `derived_artifact_ids.usd_index`, or `derived_artifact_ids.element_mapping`
- **THEN** `_worker` returns the same artifact group lineage graph and identifies the requested index or mapping node as the current artifact

#### Scenario: Source artifact lineage is queried before conversion

- **WHEN** a client calls `GET /api/artifacts/{artifact_id}/lineage` for an uploaded source artifact that has no succeeded conversion
- **THEN** `_worker` returns a graph with the source node and diagnostics that derived model, mapping, and index artifacts are not ready

#### Scenario: Unknown artifact lineage is rejected

- **WHEN** a client calls `GET /api/artifacts/{artifact_id}/lineage` for an artifact identifier not present in worker indexes, artifact groups, conversion results, or metadata
- **THEN** `_worker` returns `404` and does not fabricate lineage

#### Scenario: Legacy metadata is missing lineage fields

- **WHEN** `_worker` reads older metadata that lacks some lineage fields
- **THEN** the lineage API returns the recoverable graph fields and records missing fields in `diagnostics[]` without failing the request

### Requirement: Worker supports storage IFC batch quality verification

`_worker` MUST 提供針對 repo-local `storage/*.ifc` fixtures 的 batch quality verification 實作路徑。Windows canonical fixture glob `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc` 與 worktree-local `_worker` dev source root `../storage` 必須被視為同一類 local validation fixture source。

除非後續另開 production batch-job spec，batch verification path 必須沿用既有 worker artifact intake 與 selected-source conversion contracts。每個 fixture result 必須記錄 filename、relative path、size、source artifact ID、artifact group ID、conversion job ID、USDC openability、mapped count、unmapped count、coverage ratio、coverage status、lineage API status、可取得時的 duration，以及 failure / warning details。

Canonical baseline runs 也必須記錄 per-fixture phase timings 與 timeout diagnostics。Phase timings 必須辨識用於診斷 slow 或 stuck runs 的可觀察 conversion phases，包括 source read 或 artifact intake、conversion total duration、IFC open、source entity enumeration、geometry iteration、mesh authoring、non-renderable entity materialization、stage save、stage reopen、artifact publish，以及可取得時的 lineage lookup。若 timeout 或 failure 發生在某個 phase 開始前，必須將該 phase 記錄為 not reached 或 unavailable diagnostic，不得靜默省略。

Batch summary status 必須區分 `blocked`、`partial`、`timed_out`、`failed`、`passed`。除非完整 required canonical fixture set 都完成 real conversion，且每個 fixture 都通過 USDC openability、truthful mapping、lineage API lookup 與 locked all-IFC-entity coverage criteria，`_worker` 不得設定 `minimum_coverage_locked=true`。

`minimum_coverage_locked` 是 batch summary 頂層 aggregate flag，與每個 fixture `quality_metrics` 內的 `minimum_coverage_baseline_locked` 為兩個不同層級的 key：per-fixture `minimum_coverage_baseline_locked` 由 converter 設定並隨 conversion result 回傳；batch 層 `minimum_coverage_locked` 必須由 `_worker` 在所有 selected fixture 皆 `minimum_coverage_baseline_locked=true` 且 `coverage_status=pass` 時才匯總為 `true`。兩者不得互換使用，亦不得視為同一欄位的別名。

Canonical batch implementation 必須先執行 canonical `--limit 1` single fixture。只有該 single-fixture run 產生完整 passing conversion evidence，或產生 deterministic blocker 記錄後，helper 才能嘗試 full 13-file batch。當 single-fixture run passed 時，result 必須提供 stable artifact IDs 與 object URLs，讓既有 review viewer flow 可載入產出的 `model.usdc`。

#### Scenario: Storage IFC fixtures 批次轉檔

- **WHEN** batch verification 針對可讀取的 `storage/*.ifc` fixture set 執行
- **THEN** `_worker` 透過 worker artifact pipeline 為每個 fixture 建立 distinct source artifacts 與 conversion jobs
- **AND** batch summary 記錄每個 fixture 的 conversion quality 與 lineage API status

#### Scenario: Storage fixture root 不可用

- **WHEN** configured dev storage root missing、unreadable 或不含 `.ifc` files
- **THEN** batch verification 回報 `blocked` 與 missing fixture prerequisite，且不得宣稱 coverage baseline locked

#### Scenario: Batch fixture bytes 重複

- **WHEN** 兩個 fixture files 有相同 bytes 但 filename 或 relative path 不同
- **THEN** `_worker` 必須分別保留每個 fixture 的 `original_filename`、source artifact ID、conversion job ID 與 lineage

#### Scenario: Canonical fixture run 記錄 phase timings

- **WHEN** batch verification 執行 real canonical storage fixture
- **THEN** fixture result 記錄 total duration，以及 source intake、conversion、IFC parsing、source entity enumeration、geometry processing、USD authoring、stage validation、artifact publishing 與 lineage lookup 的 available phase timings

#### Scenario: Canonical fixture timeout

- **WHEN** 任一 canonical storage fixture 在產生 completed conversion result 前超過 configured per-fixture timeout
- **THEN** `_worker` 記錄 `status=timed_out`，包含 timeout duration 與 last known phase diagnostics，且不得將 batch status 標為 `passed`

#### Scenario: Canonical single fixture gate full batch

- **WHEN** full fixture set 的 canonical batch verification 在 canonical `--limit 1` run 產生 passing result 或 deterministic blocker evidence 前被要求執行
- **THEN** `_worker` 必須讓 batch evidence 維持 non-passed，並要求先補 single-fixture evidence

#### Scenario: Canonical single fixture exposes preview handoff data

- **WHEN** canonical `--limit 1` fixture 完成 real conversion，且產出 openable USDC 與 lineage
- **THEN** `_worker` expose `conversion_job_id`、`artifact_group_id`、source artifact ID、derived `model.usdc` artifact ID 或 URL、mapping artifact ID 或 URL，以及既有 review viewer flow 所需的 readiness state

#### Scenario: Full canonical batch locks coverage

- **WHEN** 13 個 canonical storage fixtures 全部完成 real conversion，且具備 openable USDC、truthful mapping output、successful lineage lookup，並在 locked all-IFC-entity denominator 下取得 `coverage_status=pass`
- **THEN** `_worker` 回傳 batch `status=passed`，並可設定 `minimum_coverage_locked=true`

### Requirement: Worker optimizes source entity enumeration for canonical IFC fixtures

`_worker` MUST 在轉換 canonical IFC fixtures 時，把 `source_entity_enumeration` 視為自己擁有、可量測的 conversion subphase。Converter MUST 保留 all-IFC-entity 的 coverage denominator，同時避免不必要的重複 full-model traversal、過早的 deep relationship expansion，或對於建立穩定 source entity identity 並非必要的昂貴 metadata extraction。

優化後的 enumeration path MUST 為每個 source IFC entity 保留穩定識別欄位：`ifc_entity_key`、可取得時的 `ifc_entity_id`、`ifc_class`、存在時的 `ifc_guid`，以及可取得時的 `name`，且不得犧牲 bounded execution。It MUST NOT 將 all-entity coverage 退化為僅幾何、僅 `IfcProduct`、僅 GUID 或僅 renderable 的 coverage。

Real/canonical converter path MUST NOT 以 `model.by_type("IfcProduct")` 作為 all-entity 的 fallback。若無法進行 all-entity iteration，`_worker` MUST 以 deterministic diagnostics 讓 conversion 失敗或 block，而不是輸出僅 product-only 的 coverage evidence。

在長時間的 canonical conversions 中，`_worker` MUST 揭露 additive source enumeration diagnostics，例如 elapsed seconds、enumerated entity count、目前 phase 狀態、`fallback_used`、最後已知 operation，以及可取得時的 blocker 細節。這些 diagnostics MUST 與既有 conversion result 與 quality metrics payloads 保持向後相容。Fine-grained profiling diagnostics MAY 於 verification evidence 中啟用，且 MUST 為可選。

Secondary `guid_extraction` 與 `name_extraction` 子階段成本 MUST 在每次 canonical burn-down run 透過既有 `--profile-source-entities` 路徑量測並記錄。`_worker` MAY 在後續變更中優化此二子階段成本，但 MUST 保留 `ifc_guid` 與 `name` 對所有 source IFC entity 的真實值，不得以 synthetic ID 取代 real GUID，亦不得用 default name 取代 source-declared name。當 canonical run 未啟用任何 secondary 優化時，`_worker` 仍 MUST 在 evidence 中記錄當次量測值與「沒有變更」的事實，使 follow-up change 有 baseline 可比。

#### Scenario: Canonical source enumeration advances past timeout bottleneck

- **WHEN** 以設定的 per-fixture timeout 對第一個 89MB fixture 執行 canonical `--limit 1` storage verification
- **THEN** `_worker` 在 timeout 前完成 `source_entity_enumeration` 並進入下一個 conversion phase，或記錄 deterministic blocker diagnostics 指認非 `_worker` 端的限制
- **AND** 若 conversion 仍未完成，batch 結果維持 non-passed

#### Scenario: Enumeration preserves all-entity denominator

- **WHEN** `_worker` 優化 source entity enumeration
- **THEN** `source_ifc_entity_count`、`coverage_denominator=source_ifc_entity_count`、mapping 輸出與 non-renderable entity materialization 仍涵蓋所有 source IFC entity，而不僅是 renderable geometry entity

#### Scenario: Enumeration diagnostics are additive

- **WHEN** source entity enumeration 發出 progress 或 completion diagnostics
- **THEN** 既有 conversion result fields 仍然可用
- **AND** 新增的 diagnostics 為可選的 nested fields，consumer 可忽略而不影響 lineage、readiness 或 review viewer handoff

#### Scenario: Product-only fallback is rejected for canonical evidence

- **WHEN** real converter 無法 iterate 所有 IFC source entity
- **THEN** `_worker` 記錄 conversion blocker，而非退化為 `IfcProduct`-only enumeration
- **AND** 結果 MUST NOT 以 product-only 的子集宣稱 all-entity coverage evidence

#### Scenario: Optimization does not lock baseline prematurely

- **WHEN** source entity enumeration 已改善，但整個 canonical batch 尚未通過所有 archived baseline gates
- **THEN** `_worker` 維持 `minimum_coverage_locked=false`，並記錄剩餘的 blocker 或下一個 gate

#### Scenario: Secondary GUID and name extraction cost is measured

- **WHEN** canonical burn-down run 以 `--profile-source-entities` 對 first 89MB fixture（或任一 canonical fixture）執行
- **THEN** evidence 記錄 `guid_extraction` 與 `name_extraction` 的 elapsed seconds、所佔 `source_entity_enumeration` 比例，以及該次 run 是否啟用 secondary 優化
- **AND** 若該 run 啟用 secondary 優化，evidence 記錄 before/after timing 與 `ifc_guid` / `name` fidelity 對所有 source IFC entity 一致的證明
- **AND** 若該 run 未啟用 secondary 優化，evidence 記錄量測值與「deferred」的事實，並指出 follow-up change 候選名稱

### Requirement: Worker artifact pipeline separates RVT→IFC bridge from streaming-owned IFC→USDC conversion

`_worker` SHALL remain responsible for source intake metadata and RVT→IFC bridge artifacts, but under B 方案 it SHALL NOT be the authority for IFC→USDC conversion jobs. Derived USDC artifacts, conversion job status, and mapping quality results SHALL be owned by `bim-streaming-server` after the architecture rework.

#### Scenario: Worker receives RVT source

- **WHEN** `_worker` receives an RVT export request
- **THEN** it tracks source RVT artifact and derived IFC artifact lineage
- **AND** it emits `ifc_ready` to `bim-streaming-server` when IFC export succeeds

#### Scenario: Worker does not publish USDC ready in B scheme

- **WHEN** `_worker` has produced an IFC artifact
- **THEN** it MUST NOT mark `model.usdc` ready or answer USDC conversion result as authority
- **AND** downstream USDC readiness is determined by `bim-streaming-server` conversion result

#### Scenario: Historical worker conversion evidence remains historical

- **WHEN** reports mention prior `_worker` real IFC→USDC evidence
- **THEN** they MAY cite it as migration source or historical evidence
- **AND** they MUST NOT classify the new B-scheme streaming conversion authority as passed until new streaming-server-owned evidence exists

### Requirement: Worker quantifies full canonical batch outcome distribution under sidecar carrier

`_worker` MUST 在執行 full canonical 13-file `storage/*.ifc` batch verification 時，於 batch summary 中產出 additive `outcome_distribution`，依以下分桶記錄各 fixture 的結果計數與比例：`passed`（status=passed AND coverage_status=pass）、`passed_with_quality_warning`（status=passed AND coverage_status=warn）、`timed_out`、`failed`（含 status=failed 或 status=passed AND coverage_status=fail），以及 `blocked`（fixture 未進入轉檔，例如缺 prerequisites）。

`outcome_distribution` MUST 為 additive optional field；既有 `status`、`fixtures`、`minimum_coverage_locked` 等 batch summary key 必須保持不變且向後相容。分桶結果 MUST 完全由 per-fixture row 派生，不得引入新的權威來源；測試 MUST 證明從 per-fixture rows 重新計算所得的 distribution 與記錄的 distribution 完全一致。

`_worker` MUST 僅在 `outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass` 同時成立時，才設定 batch summary `minimum_coverage_locked=true`。任一條件不滿足 → `minimum_coverage_locked=false`，且 batch summary MUST 記錄阻塞的 fixture 與原因（per-fixture row 已記錄足夠時不另增 row）。

`_worker` MUST NOT 在 full batch verification 中對單一 fixture 自動 retry。一個 fixture 在一次 batch run 內只記錄一次 outcome；使用者若要重跑單一 fixture，應另外執行 `--limit 1` 對該檔案，並產生獨立的 evidence。

#### Scenario: Full canonical batch records outcome distribution

- **WHEN** `_worker` 對 `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` 執行 `verify_storage_batch.py --limit 13 --timeout-seconds 600 --profile-source-entities`
- **THEN** batch summary 中包含 `outcome_distribution` 物件，欄位含 `total`（=13）、`passed`、`passed_with_quality_warning`、`timed_out`、`failed`、`blocked` 各自的 `count` 與 `rate`
- **AND** distribution 計數加總 = `total` = `outcome_distribution.total`
- **AND** 既有 batch summary key（`status`、`fixtures`、`minimum_coverage_locked` 等）維持原樣

#### Scenario: Distribution is derived from per-fixture rows

- **WHEN** consumer 從 batch summary 重新計算 `outcome_distribution`（用 per-fixture row 的 `status` 與 `coverage_status`）
- **THEN** 重算結果與 batch summary 內記錄的 `outcome_distribution` 完全一致

#### Scenario: Coverage lock requires clean full batch

- **WHEN** `outcome_distribution.passed.count == 13` AND 所有 fixture `quality_metrics.minimum_coverage_baseline_locked=true` AND `coverage_status=pass`
- **THEN** batch summary `minimum_coverage_locked=true`
- **AND** batch summary `status=passed`

#### Scenario: Partial batch does not lock coverage

- **WHEN** 13 個 fixture 中有任一個 fixture status ≠ `passed` 或 coverage_status ≠ `pass`
- **THEN** batch summary `minimum_coverage_locked=false`
- **AND** batch summary 記錄阻塞的 fixture 與分類（`timed_out` / `failed` / `passed_with_quality_warning` / `blocked`）

#### Scenario: No automatic retry within a batch run

- **WHEN** 某個 fixture 在 batch run 中發生 timeout 或 failure
- **THEN** `_worker` 將該 fixture 的 outcome 記為單次結果（不重試），並繼續處理下一個 fixture
- **AND** batch summary 不得標示曾被自動 retry 過的 fixture 為 `passed`

