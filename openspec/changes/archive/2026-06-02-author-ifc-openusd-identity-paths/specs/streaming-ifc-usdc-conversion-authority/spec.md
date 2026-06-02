# streaming-ifc-usdc-conversion-authority — Spec Delta (author-ifc-openusd-identity-paths)

> Delta against `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`。
> 本 delta 新增 no-Revit-plugin 的 IFC-first OpenUSD identity authoring route，讓
> `bim-streaming-server` 能主動 author stable USD prim path 與 GUID-exact sidecars。

## ADDED Requirements

### Requirement: Streaming conversion SHALL support IFC-first OpenUSD identity authoring

`bim-streaming-server` SHALL support an internal IFC-first OpenUSD authoring route that parses IFC geometry and semantics from the IFC source, authors the USD stage itself, and treats IFC `GlobalId` as the source of truth for element identity. This route MUST NOT require Revit Connector, Revit add-in, or any Revit plugin. When this route is selected, `bim-streaming-server` SHALL NOT classify HOOPS/CAD Converter ordinal matching as `guid_exact`.

#### Scenario: Identity authoring does not require Revit plugin

- **WHEN** coordinator or an operator dispatches an internal conversion request with `conversion_profile = "ifcopenshell_openusd_identity"`
- **AND** the request points to a readable IFC source
- **THEN** `bim-streaming-server` SHALL parse the IFC source directly
- **AND** SHALL NOT require a Revit Connector export, Revit add-in, RVT file, or browser-side plugin
- **AND** SHALL report the conversion result under the existing `bim-streaming-server` conversion authority boundary

#### Scenario: Element root prim path is derived from IFC GlobalId

- **WHEN** identity authoring creates a USD prim for an IFC product with `GlobalId = "<guid>"` and IFC class `IfcWall`
- **THEN** the element root prim path SHALL follow `/World/Elements/IfcWall/G_<encoded_guid>`
- **AND** `<encoded_guid>` SHALL be USD-safe, deterministic, and derived from the IFC `GlobalId`
- **AND** the element root prim SHALL preserve the original IFC `GlobalId` in metadata or customData such as `bim:ifc_guid`
- **AND** the path SHALL remain stable when the element moves between storeys, spaces, systems, or zones

#### Scenario: Split geometry remains under the stable element root

- **WHEN** one IFC element is tessellated into multiple USD mesh prims
- **THEN** every mesh child SHALL be authored under the stable element root prim
- **AND** mesh child names MAY change across tessellation runs
- **AND** the element root `usd_prim_path` SHALL remain the mapping target for issue binding, highlight/focus, diff, and downstream `ai-bim-geo` consumers

#### Scenario: USD-safe identifier sanitization is deterministic

- **WHEN** an IFC `GlobalId`, IFC class, or generated child name contains characters that are illegal in a USD prim path segment
- **THEN** `bim-streaming-server` SHALL encode or sanitize the segment deterministically
- **AND** SHALL keep the original unsanitized IFC value in metadata / customData / sidecar data
- **AND** SHALL avoid sibling prim path collisions by adding deterministic disambiguation when needed

### Requirement: Identity authoring SHALL emit GUID-exact mapping and ai-bim-geo indexes

When `conversion_profile = "ifcopenshell_openusd_identity"` succeeds, `bim-streaming-server` SHALL emit artifacts that downstream consumers can use without re-parsing the IFC source. The artifacts SHALL include GUID-exact mapping, entity metadata, Pset/property data, spatial relationships, local/world bounding boxes, quality metrics, and an explicit geo reference artifact that reports availability and warnings without fabricating unsupported geo values.

#### Scenario: Element mapping declares guid_exact fidelity

- **WHEN** identity authoring successfully writes an openable USD stage
- **THEN** `element_mapping.json` SHALL contain `mapping_fidelity = "guid_exact"`
- **AND** every mapped item SHALL include at least `ifc_guid`, `usd_prim_path`, `ifc_type`, `ifc_name`, and `entity_id`
- **AND** `usd_prim_path` SHALL point to the stable element root prim, not an arbitrary child mesh
- **AND** unmapped IFC products SHALL be counted honestly in `quality_metrics.json` rather than fabricated

#### Scenario: Entity, Pset, spatial, and bbox indexes are emitted

- **WHEN** identity authoring publishes ready conversion artifacts
- **THEN** the artifact set SHALL include `entity_index`, `pset_index`, `spatial_index`, `bbox_index`, and `quality_metrics` references
- **AND** `entity_index` records SHALL join to `element_mapping.items[]` via `entity_id`
- **AND** `spatial_index` SHALL represent storey / space / system membership as relationships or index data rather than prim path segments
- **AND** `bbox_index` SHALL include local bounding boxes and SHOULD include world bounding boxes when geo reference data is available

#### Scenario: Geo reference artifact is explicit and non-fabricating

- **WHEN** identity authoring publishes ready conversion artifacts
- **THEN** the artifact set SHALL include `geo_reference.usda`, `geo_reference.json`, or an equivalent geo reference artifact reference
- **AND** the geo reference artifact SHALL declare whether CRS, local origin, true north, and model-to-world transform values are available, unavailable, or not extracted
- **AND** SHALL keep mesh geometry in local/project coordinates unless an explicit transform policy says otherwise
- **AND** SHALL record missing, unavailable, incomplete, or not-yet-extracted geo data as artifact warnings and `quality_metrics` warnings instead of fabricating CRS or transform values

#### Scenario: Artifacts support ai-bim-geo consumers

- **WHEN** `ai-bim-geo` or another downstream consumer reads the identity-authored artifact package
- **THEN** it SHALL be able to resolve `ifc_guid -> usd_prim_path`
- **AND** SHALL be able to inspect IFC type/name/Pset/spatial/bbox/geo metadata from sidecars without re-running IFC parsing
- **AND** SHALL be able to bind governance issues, scan-to-BIM observations, IoT assets, schedule/cost references, or AI search results to the stable element root identity

### Requirement: Identity authoring SHALL preserve existing conversion boundaries and compatibility

The IFC-first identity authoring route SHALL be additive to the existing conversion authority. It SHALL preserve coordinator intake, callback outbox, viewer artifact consumption, and current conversion behavior for requests that do not select the identity profile.

#### Scenario: Existing conversion requests remain compatible

- **WHEN** an internal conversion request does not specify `conversion_profile = "ifcopenshell_openusd_identity"`
- **THEN** `bim-streaming-server` SHALL preserve the existing conversion selection behavior
- **AND** existing consumers that only understand legacy `element_mapping.items[].ifc_guid` and `element_mapping.items[].usd_prim_path` SHALL continue to parse mapping artifacts without error

#### Scenario: HOOPS path is not reported as guid_exact without real IFC identity on prims

- **WHEN** HOOPS/CAD Converter produces a renderable USD stage but does not preserve IFC `GlobalId` on USD prims
- **THEN** `bim-streaming-server` SHALL NOT report `mapping_fidelity = "guid_exact"` for ordinal or best-effort sidecar matching
- **AND** SHALL report a weaker fidelity such as sidecar / ordinal / unmapped according to the existing quality metrics policy

#### Scenario: Callback outbox remains metadata-only

- **WHEN** coordinator enqueues a cloud callback for an identity-authored conversion result
- **THEN** the callback payload SHALL NOT include full `pset_index`, `spatial_index`, `bbox_index`, `element_mapping`, or `geo_reference` bodies
- **AND** MAY include opaque artifact refs, summary quality metrics, and conversion status according to the existing metadata-only callback boundary

#### Scenario: Browser consumes artifact refs rather than becoming conversion authority

- **WHEN** `web-viewer-sample` needs to focus or highlight failed elements
- **THEN** it SHALL consume `usd_prim_path` values from conversion artifacts or coordinator-provided stream config
- **AND** SHALL NOT call the internal host-native conversion service directly to compute mapping or parse IFC
