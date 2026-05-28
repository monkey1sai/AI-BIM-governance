# streaming-ifc-usdc-conversion-authority Specification

## Purpose
TBD - created by archiving change architecture-rework-2026-05-14. Update Purpose after archive.
## Requirements
### Requirement: `bim-streaming-server` owns IFC→USDC conversion jobs under B 方案

`bim-streaming-server` SHALL remain the authority for IFC→USDC conversion jobs as an internal conversion engine. When the primary Kit/HOOPS converter cannot import a source IFC but the source IFC is locally readable and parseable by an approved host-native IFC parser, `bim-streaming-server` SHALL attempt a real geometry fallback conversion within the same conversion authority boundary before publishing a terminal failed result. The fallback MUST produce a real OpenUSD/USDC stage and the required sidecars; it MUST NOT publish placeholder USDC, fake mapping, or smoke-only artifacts as ready.

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

### Requirement: Heavy conversion execution does not block live WebRTC runtime

`bim-streaming-server` SHALL keep conversion authority within its service boundary while preventing heavy conversion execution from blocking the live Kit/WebRTC viewport runtime.

#### Scenario: Headless converter process is used

- **WHEN** an IFC conversion job runs
- **THEN** it SHOULD run through a headless converter app, subprocess, or worker lane
- **AND** the live WebRTC endpoint remains separately health-checked

#### Scenario: Live runtime dependency creep is detected

- **WHEN** converter-only dependencies are added to the live streaming Kit app
- **THEN** the change MUST document startup/runtime impact and provide a rollback path
- **AND** demo readiness MUST separately classify conversion readiness and WebRTC readiness

### Requirement: Streaming conversion preserves quality metrics and mapping semantics

`bim-streaming-server` SHALL preserve existing conversion quality semantics when
it becomes conversion authority. When the fallback converter is the
materialization strategy, the quality metrics document SHALL additionally
declare semantic mapping fidelity so downstream consumers can distinguish a
shape-level fallback from an IFC-semantic fallback without re-parsing the mapping
artifact body.

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

### Requirement: Streaming conversion authority can run as a host-native service

`bim-streaming-server` SHALL support running its IFC to USDC conversion authority as a host-native service that is separate from the live Kit/WebRTC viewport runtime. The service SHALL remain internal-only and SHALL NOT expose the external IFC-ready intake contract.

#### Scenario: Host-native service preserves streaming ownership

- **WHEN** the host-native conversion service accepts an internal conversion request
- **THEN** the returned job and result identify `authority="bim-streaming-server"`
- **AND** coordinator consumes the result as streaming-owned conversion evidence

#### Scenario: External IFC-ready caller cannot bypass coordinator

- **WHEN** an external IFC Worker needs to report IFC readiness
- **THEN** the supported entry point remains `bim-review-coordinator` `POST /api/external/ifc-ready`
- **AND** the host-native conversion authority service remains an internal API called by coordinator

#### Scenario: Conversion readiness is not WebRTC readiness

- **WHEN** the host-native conversion service successfully produces USDC and mapping artifacts
- **THEN** conversion readiness MAY be classified as passed
- **AND** Kit launcher, WebRTC `49100`, DataChannel stage loading, and browser visual evidence remain separate tiers

### Requirement: Host-native conversion keeps heavy work off the live viewport path

Heavy IFC to USDC conversion SHALL run through the host-native service runner, converter subprocess, or worker lane instead of blocking the live viewport thread. The implementation SHALL keep a clear operational boundary between conversion execution and Kit/WebRTC streaming.

#### Scenario: Live Kit runtime is down while conversion succeeds

- **WHEN** `127.0.0.1:49101` is healthy and `127.0.0.1:49100` is not listening
- **THEN** a conversion API smoke MAY pass
- **AND** WebRTC or viewport smoke MUST remain `blocked` or `not_observed`

#### Scenario: Converter dependency fails

- **WHEN** the converter adapter fails because of missing executable, invalid IFC, missing output, or process failure
- **THEN** the conversion job records a non-ready failure
- **AND** live Kit/WebRTC runtime status is reported separately

### Requirement: Conversion failures expose actionable diagnostic

`bim-streaming-server` SHALL capture the Kit conversion subprocess's full stdout and stderr to dedicated log files inside the conversion's artifact directory and SHALL expose those log file paths in any failure result so operators can read the Kit subprocess output without re-running the conversion. The capture MUST be performed via asynchronous redirect(`Process.RedirectStandardOutput=true` + `BeginOutputReadLine`/`BeginErrorReadLine` writing to file)to avoid the standard sync `WaitForExit` + `ReadToEnd` deadlock when the subprocess output volume is large.

When the conversion fails for any reason after the subprocess starts(non-zero exit code, missing output file despite zero exit, or timeout):

- The `error` object on `GET /api/conversions/<id>/result` SHALL include `kit_stdout_log` and `kit_stderr_log` keys holding host-absolute paths to the captured log files.
- The `error.message` string SHALL include a tail summary of the last 100 lines of stderr and the last 50 lines of stdout so operators can triage from the result payload alone without filesystem access.
- The log files SHALL persist on disk(co-located with the conversion's artifact dir)beyond the failure event so subsequent re-reads, archival, or post-mortem analysis can use them.
- Successful conversions SHALL also retain the log files(co-located with `model.usdc`)to support baseline comparison; the result object MAY omit `kit_stdout_log` / `kit_stderr_log` from `error`(no error)but the files MUST still exist on disk.

The log files MUST NOT be sent to the cloud callback outbox(callback remains metadata-only per `conversion-webhook-lifecycle`);diagnostic log access is a host-local-only concern.

#### Scenario: Kit subprocess silent failure surfaces stderr tail in result

- **WHEN** `bim-streaming-server` invokes `convert-ifc-to-usdc.ps1` for a conversion job and the Kit subprocess exits with code 0 but does NOT write `model.usdc`
- **THEN** the resulting `GET /api/conversions/<id>/result` returns `status="failed"` with `error.code="converter_failed"`
- **AND** `error.kit_stdout_log` and `error.kit_stderr_log` are host-absolute paths pointing to files that exist on disk
- **AND** `error.message` contains the substring `---- stderr tail (last 100 lines) ----` followed by actual stderr lines from the Kit subprocess
- **AND** the operator can `tail` either log file independently without re-running the conversion

#### Scenario: Successful conversion retains subprocess logs on disk

- **WHEN** Kit subprocess successfully writes `model.usdc` and the conversion completes ready
- **THEN** `kit-stdout.log` and `kit-stderr.log` files exist in the artifact directory alongside `model.usdc`
- **AND** the result object does NOT include `kit_stdout_log` / `kit_stderr_log` in its `error` field(there is no error)
- **AND** the log files MAY be used for baseline comparison against future failures

#### Scenario: Async redirect prevents large-output deadlock

- **WHEN** Kit subprocess emits a stdout/stderr volume large enough to fill the OS pipe buffer(typical Kit verbose conversion log can reach megabytes)
- **THEN** the PowerShell wrapper MUST NOT block `WaitForExit` waiting for the parent to drain the pipe
- **AND** the conversion MUST progress to natural completion(success or terminal exit)without artificial pipe-buffer-induced hang
- **AND** the full output is captured to disk via async `BeginOutputReadLine` / `BeginErrorReadLine` event handlers

#### Scenario: Cloud callback outbox excludes subprocess logs

- **WHEN** coordinator enqueues a `conversion_failed` callback for a job whose error includes `kit_stdout_log` and `kit_stderr_log`
- **THEN** the callback payload sent to the company-cloud control plane MUST NOT include the log file contents
- **AND** MAY reference the log file paths only as opaque diagnostic markers(per existing metadata-only callback principle in `conversion-webhook-lifecycle`)

### Requirement: Fallback converter emits IFC-semantic mapping

`bim-streaming-server` 的 `IfcOpenShell + OpenUSD` fallback converter SHALL produce
`element_mapping.json` items that carry the originating IFC entity type and name
(when available from IfcOpenShell), align each mapping item with one entity in
`entity_index.json` via a shared `entity_id`, and structure the USD prim hierarchy
so each mesh prim is grouped under an `Xform` named after its IFC class. The
fallback SHALL also publish three quality-metric fields that downstream consumers
(coordinator `/ui`, viewer) can read to determine semantic readiness without
having to re-parse the mapping items themselves.

The new fields and structure SHALL be additive to the existing schema so existing
consumers that only know the legacy `ifc_guid` + `usd_prim_path` shape continue
to work without modification.

#### Scenario: Fallback mapping carries IFC class and name

- **WHEN** `_run_ifcopenshell_openusd_fallback` writes `element_mapping.json` for a
  successful IFC parse
- **THEN** every entry in `items[]` SHALL include the keys `ifc_guid`,
  `usd_prim_path`, `ifc_type`, `ifc_name`, and `entity_id`
- **AND** `ifc_type` / `ifc_name` MAY be `null` when IfcOpenShell does not return
  a type or name for that shape, but the keys MUST be present
- **AND** the legacy keys `ifc_guid` and `usd_prim_path` SHALL retain their
  existing meaning (IFC GUID and absolute USD prim path)

#### Scenario: Fallback prim paths are IFC-class grouped

- **WHEN** `_run_ifcopenshell_openusd_fallback` writes the fallback `model.usdc`
- **THEN** every mesh prim SHALL live under `/World/<IfcClass>/<identifier>` where
  `<IfcClass>` is a USD-safe identifier derived from the IFC entity type (e.g.
  `IfcCableCarrierSegment`, `IfcBuildingElementProxy`) and `<identifier>` is a
  USD-safe identifier derived from the IFC GUID
- **AND** shapes with no resolvable IFC class SHALL be grouped under
  `/World/Unclassified/<identifier>`
- **AND** any `<IfcClass>` segment SHALL be defined as a `UsdGeom.Xform` (only
  once per class) before any mesh under it is added
- **AND** the resulting `model.usdc` SHALL remain openable via `Usd.Stage.Open`
  with at least one `UsdGeom.Mesh` prim

#### Scenario: Mapping items align with entity index by entity_id

- **WHEN** `_run_ifcopenshell_openusd_fallback` writes `element_mapping.json` and
  `entity_index.json`
- **THEN** every `items[i].entity_id` value in `element_mapping.json` SHALL
  appear exactly once in `entity_index.json` `entities[].entity_id`
- **AND** the matching entity record SHALL contain the same `ifc_guid` and
  `usd_prim_path` as the mapping item
- **AND** consumers MAY join `element_mapping.items` with `entity_index.entities`
  on `entity_id` to retrieve full IFC entity information

#### Scenario: Quality metrics declare semantic mapping fidelity

- **WHEN** `_run_ifcopenshell_openusd_fallback` writes `quality_metrics.json`
- **THEN** the JSON object SHALL include the keys `semantic_mapping_fidelity`,
  `mapping_has_ifc_type`, and `mapping_has_ifc_name`
- **AND** when at least one mapping item has a non-null `ifc_type`,
  `mapping_has_ifc_type` SHALL be `true`
- **AND** when at least one mapping item has a non-null `ifc_name`,
  `mapping_has_ifc_name` SHALL be `true`
- **AND** when the fallback uses IFC-class grouped prim paths and emits the
  enriched mapping schema described above, `semantic_mapping_fidelity` SHALL be
  `"ifc_class_grouped_with_name"`

#### Scenario: USD-safe identifier sanitization for IFC GUID and class

- **WHEN** the fallback constructs a USD prim path segment from an IFC GUID or
  IFC class string that contains characters outside `[A-Za-z0-9_]`
- **THEN** the identifier SHALL be sanitized so each illegal character is replaced
  by `_`
- **AND** if the resulting identifier does not begin with a letter or `_`, the
  identifier SHALL be prefixed with `_`
- **AND** if sanitization yields an empty string, the fallback SHALL use a
  deterministic placeholder such as `Shape_NNNNNN` (zero-padded shape index) or
  the literal `Unclassified` (for the IFC class segment)
- **AND** the sanitized prim path SHALL remain unique within `model.usdc`

#### Scenario: Backward compatible mapping schema

- **WHEN** a consumer that only understands the legacy mapping shape reads
  `element_mapping.json`
- **THEN** the consumer SHALL still be able to parse `items[].ifc_guid` and
  `items[].usd_prim_path` without error
- **AND** the new keys `ifc_type`, `ifc_name`, `entity_id` MAY be ignored without
  breaking the consumer
- **AND** the fallback MUST NOT remove or rename any pre-existing key in the
  mapping or entity-index documents

### Requirement: Enumeration and adoption sidecar paths emit IFC-semantic mapping fidelity

`bim-streaming-server` SHALL write the three C1 semantic fields
(`semantic_mapping_fidelity` / `mapping_has_ifc_type` / `mapping_has_ifc_name`)
into `quality_metrics.json` from both sidecar materialization paths
(`_enumerate_usd_stage` and `_adopt_converter_sidecars`), so that the
HOOPS-success happy path and the IfcOpenShell fallback path both let viewer /
`/ui` compute Semantic ready as `yes` when IFC semantics are present. The
enumeration path MUST extract `ifcType` / `ifcName` from USD prim CustomData
(tolerating `ifc:type` / `ifc:name` key variants); the adoption path MUST
supplement missing semantic fields from converter-emitted `element_mapping.items`
in a non-fabricating manner (never overwriting fields the converter already
wrote).

#### Scenario: Enumeration path enriches mapping items with IFC type / name

- **WHEN** `_enumerate_usd_stage` 從 USD stage Traverse 列出 prims
- **AND** prim CustomData 含 `ifcGlobalId`(或 `ifc:guid` / `ifc_guid`)、
  `ifcType`(或 `ifc:type` / `ifc_type`)、`ifcName`(或 `ifc:name` / `ifc_name`)
- **THEN** 寫出的 `element_mapping.json` items 每筆 SHALL 含
  `ifc_guid` / `usd_prim_path` / `ifc_type` / `ifc_name` / `entity_id` 五個 keys
- **AND** `entity_index.json` entries 每筆 SHALL 對齊同一 `entity_id`
- **AND** 沒 IFC custom data 的 prim SHALL 不寫進 mapping_items(避免 fabricate)

#### Scenario: Enumeration quality_metrics declares semantic fidelity

- **WHEN** `_enumerate_usd_stage` 完成 sidecars
- **AND** mapping_items 中至少一筆 `ifc_type` 與一筆 `ifc_name` 為 truthy string
- **THEN** `quality_metrics.json` SHALL 含
  `semantic_mapping_fidelity = "ifc_class_grouped_with_name"`、
  `mapping_has_ifc_type = true`、`mapping_has_ifc_name = true`
- **AND** viewer `computeSemanticReady` 對此 conversion 的 stream-config
  SHALL 計算為 `"yes"`(對齊 `session-first-review-viewer`)

#### Scenario: Enumeration path with no IFC custom data stays honest

- **WHEN** USD stage 內 prim 完全沒 IFC custom data(例如純 mesh export 無
  IFC metadata)
- **THEN** `quality_metrics.json` SHALL 含 `semantic_mapping_fidelity = null`
  /`undefined`,`mapping_has_ifc_type = false`、`mapping_has_ifc_name = false`
- **AND** viewer SHALL 計算 Semantic ready 為 `no`(誠實不偽宣告)

#### Scenario: Adoption path supplements missing semantic fields

- **WHEN** `_adopt_converter_sidecars` 讀 converter-emitted `quality_metrics.json`
- **AND** 該 quality_metrics 缺少 `semantic_mapping_fidelity` /
  `mapping_has_ifc_type` / `mapping_has_ifc_name` 任一
- **AND** emitted `element_mapping.json` items 內既有 `ifc_type` / `ifc_name` data
- **THEN** adapter SHALL supplement 三個 missing 欄位,依 mapping items
  推導對應 truthy 值(`has_type = any(item.ifc_type)`、
  `has_name = any(item.ifc_name)`,fidelity 依 has_type / has_name 組合)
- **AND** supplement SHALL NOT 蓋過 converter 自己已寫的非 null / 非缺失欄位
  (`is None` / `not in` guard)
- **AND** supplement 不從 element_mapping 以外的來源推導,維持 non-fabricating
  原則

#### Scenario: Backward compatible mapping schema

- **WHEN** 既有 consumer(viewer / coordinator)只認 legacy `ifc_guid` +
  `usd_prim_path` keys 而不認 `ifc_type` / `ifc_name` / `entity_id` 新 keys
- **THEN** 它們 SHALL 仍能解析新 element_mapping.json 與 entity_index.json
- **AND** 新 keys SHALL 是 additive,既有 keys 不被刪除或重新命名

### Requirement: HOOPS happy path SHALL be augmented by an IfcOpenShell semantic sidecar pass

`bim-streaming-server` SHALL 在 HOOPS happy-path conversion 發布可渲染
`model.usdc` 之後,於 converter-emitted sidecars 或 USD-enumerated sidecars
尚未帶 IFC 語意資料時,執行一輪 IfcOpenShell-based 的 semantic sidecar
pass。本 pass MUST 把 host-local 的 `ifc_semantic_sidecar.json` 寫在與
`model.usdc` 同一個 artifact dir、MUST NOT 因自身失敗而擋住已 ready 的
HOOPS 結果、且 MUST 只在 prim CustomData 不帶 IFC keys 時被
`_enumerate_usd_stage` 當 supplement 來源消費。Sidecar entries SHALL 僅源自
對原始 IFC source 的真實 IfcOpenShell 解析(non-fabricating);
`element_mapping.json` items SHALL 僅由 prim CustomData 或 sidecar entries
推導,不得使用名稱啟發、mesh 名稱、material 等替代來源。

#### Scenario: HOOPS success without IFC CustomData triggers sidecar pass

- **WHEN** host-native conversion service 完成 HOOPS happy-path conversion
  並發布可渲染的 `model.usdc`
- **AND** `_adopt_converter_sidecars` 回傳的 sidecars 內
  `mapping_has_ifc_type` / `mapping_has_ifc_name` 皆非 truthy
- **AND** 原始 IFC source 仍可在 host 端讀取
- **THEN** `bim-streaming-server` SHALL 對該 IFC source 呼叫
  `_run_ifcopenshell_semantic_sidecar`
- **AND** SHALL 把 `ifc_semantic_sidecar.json` 寫進 conversion 的 artifact
  目錄,與 `model.usdc` 同層
- **AND** sidecar 內容 SHALL 包含 `format_version`、`ifc_source`、`entries[]`
  (每筆含 `ifc_guid`、`ifc_type`、`ifc_name`、`shape_index`)以及 `summary`
  (含 `count`、`has_type`、`has_name`)

#### Scenario: Sidecar pass filters IfcProduct without renderable Representation

- **WHEN** `_run_ifcopenshell_semantic_sidecar` iterate `IfcProduct`
- **AND** 該 product 沒有 `Representation`(例如 `IfcSite` / `IfcBuilding`
  / `IfcBuildingStorey` / `IfcSpace` 等空間 / 容器 product)
- **THEN** 該 product SHALL 被略過、不寫進 `entries[]`,避免 mesh-prim 順序
  與 sidecar entries 順序的 ordinal join 整體錯位
- **AND** `entries[]` 內 `shape_index` SHALL 從 0 連續編號,不留被略過的
  spatial product 造成的空隙

#### Scenario: Enumeration reads sidecar when prim CustomData is empty

- **WHEN** `_enumerate_usd_stage` traverse HOOPS 產出的 USD stage
- **AND** 沒有任何 prim 帶 `ifc:guid` / `ifcGlobalId` / `ifc_guid` CustomData
- **AND** artifact 目錄存在 `ifc_semantic_sidecar.json` 且 `entries[]` 非空
- **THEN** `_enumerate_usd_stage` SHALL 載入 sidecar,並以 USD mesh prim 順序
  vs sidecar entries 順序 best-effort ordinal 對齊補 `mapping_items[]`
- **AND** 每筆 supplemented mapping item SHALL 含五個 keys `ifc_guid`、
  `usd_prim_path`、`ifc_type`、`ifc_name`、`entity_id`
- **AND** `entity_index.json` entries SHALL 透過共用的 `entity_id` 與
  mapping items 對齊
- **AND** `quality_metrics.json` SHALL 含
  `semantic_mapping_fidelity = "usd_enumeration_with_ifc_sidecar_supplement"`、
  `mapping_has_ifc_type`(由 `any(item.ifc_type)` 推導)、
  `mapping_has_ifc_name`(由 `any(item.ifc_name)` 推導)
- **AND** `web-viewer-sample` `computeSemanticReady` SHALL 對此 conversion
  的 stream-config 計算 Semantic ready 為 `"yes"`(對齊
  `session-first-review-viewer`)

#### Scenario: Enumeration prefers prim CustomData over sidecar

- **WHEN** `_enumerate_usd_stage` traverse USD stage
- **AND** 至少一個 prim 帶有效的 IFC CustomData(`ifc:guid` / `ifcGlobalId`
  / `ifc_guid` 加可選 `ifcType` / `ifcName`)
- **AND** artifact 目錄同時存在 `ifc_semantic_sidecar.json`
- **THEN** `mapping_items[]` SHALL 由 prim CustomData 推導(維持
  `streaming-server-enumeration-semantic-mapping` archive 行為)
- **AND** `semantic_mapping_fidelity` SHALL 依 C6 archive 規則維持
  `"ifc_class_grouped_with_name"` 或 `"usd_enumeration_with_ifc_custom_data"`
- **AND** sidecar SHALL NOT shadow 或覆蓋 CustomData-derived 的 mapping items

#### Scenario: Missing IFC source or IfcOpenShell unavailable stays honest

- **WHEN** HOOPS 發布的 artifact 目錄含 ready 的 `model.usdc`,但原始 IFC
  source 已被 retention policy 移除
- **OR** host Python 環境不能 import `ifcopenshell`
- **OR** `ifcopenshell.open()` 對 IFC source 抛例外
- **OR** `ifcopenshell.open()` 成功但 `.by_type("IfcProduct")` 抛例外
- **THEN** `_run_ifcopenshell_semantic_sidecar` SHALL 回傳 `None` 且不抛例外
- **AND** SHALL NOT 寫 `ifc_semantic_sidecar.json`(避免留下看似成功但內容
  空的 artifact 誤導 downstream)
- **AND** HOOPS 已發布的 ready 結果 SHALL NOT 被撤回或重分類為 failed
- **AND** `_enumerate_usd_stage` SHALL fall back 到既有 CustomData / no-data
  路徑;`quality_metrics.json` SHALL 維持
  `semantic_mapping_fidelity = null`、`mapping_has_ifc_type = false`、
  `mapping_has_ifc_name = false`
- **AND** viewer Semantic ready SHALL 維持 `no`(誠實不偽宣告)

#### Scenario: Sidecar contents stay host-local and do not enter callback outbox

- **WHEN** coordinator 對含 `ifc_semantic_sidecar.json` 的 conversion job
  enqueue `conversion_ready` 或 `conversion_failed` callback
- **THEN** 送往外部公司雲端 control plane 的 callback payload MUST NOT 包含
  sidecar JSON 本體或任何 IfcOpenShell 推導出的 semantic 內容
- **AND** callback MAY 僅以 opaque diagnostic marker 引用 sidecar,對齊
  `conversion-webhook-lifecycle` metadata-only callback 規約

#### Scenario: Backward compatible mapping schema and additive quality metrics

- **WHEN** 既有 consumer(`bim-review-coordinator`、`web-viewer-sample`)
  讀取走過 sidecar supplement 路徑產出的 `element_mapping.json`、
  `entity_index.json` 或 `quality_metrics.json`
- **THEN** 只認 legacy `ifc_guid` / `usd_prim_path` mapping schema 的
  consumer SHALL 仍能無誤解析該文件
- **AND** 新 `semantic_mapping_fidelity` 值
  `"usd_enumeration_with_ifc_sidecar_supplement"` SHALL 為 additive;對先前
  值(`"ifc_class_grouped_with_name"` / `"usd_enumeration_with_ifc_custom_data"`)
  做 switch 的 consumer SHALL 把新值視為 unknown-but-valid fidelity,並依
  `mapping_has_ifc_type` / `mapping_has_ifc_name` 判定 semantic 是否存在
- **AND** 任何 `element_mapping.json`、`entity_index.json`、
  `quality_metrics.json` 既有 key SHALL NOT 被本 change 移除或重新命名

#### Scenario: Sidecar pass does not retro-fit previously archived conversions

- **WHEN** streaming server 在本 change 部署後啟動
- **AND** storage 內仍存在先前 conversion 產出的 `model.usdc` 但不含
  `ifc_semantic_sidecar.json`
- **THEN** streaming server SHALL NOT 在 startup 時自動對既有 artifact 目錄
  重跑 sidecar pass
- **AND** 只有新 dispatch 的 conversion job SHALL 觸發 sidecar pass
- **AND** 若 operator 需要回溯既有 artifact 的 sidecar 覆蓋,SHALL 透過既有
  coordinator dispatch 路徑手動觸發重 conversion

