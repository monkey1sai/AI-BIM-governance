## Why

目前 IFC -> USDC 的 happy path 仍以 HOOPS/CAD Converter 產出可視化 USD 為主，無法保證 IFC `GlobalId`、type、Pset、spatial relation 與 USD prim path 精準保留。若要不依賴 Revit Connector / Revit 外掛，同時支援後續 `ai-bim-geo` 的 governance、highlight、diff、spatial query、geo federation 與 scan-to-BIM，轉檔器必須自己 author OpenUSD，讓 IFC identity 成為 prim path 與 sidecar artifacts 的 source of truth。

## What Changes

- 在 `bim-streaming-server` conversion authority 內新增 IFC-first / identity-first 的 OpenUSD authoring 路線：
  - 輸入契約仍是 IFC，不要求 Revit plugin、Revit Connector 或 RVT 直連。
  - 以 IfcOpenShell 解析 IFC geometry + semantics，使用 `pxr.Usd` / `UsdGeom` 主動 author USD stage。
  - 以 IFC `GlobalId` 產生穩定 element root prim path，例如 `/World/Elements/IfcWall/G_<encoded_GlobalId>`。
  - 每個 element root prim 保留原始 IFC identity metadata / customData，mesh child 可依 geometry 拆分但不得改變 element root identity。
- 新增 identity-authoring artifacts / sidecars：
  - `element_mapping.json`：`ifc_guid -> usd_prim_path`，`mapping_fidelity = "guid_exact"`。
  - `entity_index.json`、`pset_index.json`、`spatial_index.json`、`bbox_index.json`、`quality_metrics.json`。
  - `geo_reference.usda` 或等價 geo reference metadata，保存 CRS / origin / true north / model-to-world transform。
- 將 HOOPS/CAD Converter 降為視覺品質或相容性輔助路線，不再作為 BIM identity authority。
- 新增 internal-only conversion profile / option，讓 coordinator 或 operator 可選擇 identity-authoring route；既有 conversion request 未指定時仍保持相容預設。
- 不改外部公司雲端 `bim-control`、外部 IFC Worker、callback outbox 權威邊界；cloud callback 仍 metadata-only。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `streaming-ifc-usdc-conversion-authority`: 新增 requirement，要求 `bim-streaming-server` 支援 IFC-first OpenUSD identity authoring，穩定產出 NVIDIA/OpenUSD 合法 prim path、GUID-exact mapping sidecars、geo/spatial/bbox/pset indexes，並維持 HOOPS/CAD Converter 與 coordinator / viewer 邊界相容。

## Impact

- Owner repo / folder:
  - `bim-streaming-server/` owns the converter behavior, USD authoring, artifact generation, quality metrics, and host-native conversion validation.
  - `bim-review-coordinator/` may only need additive internal request / result field plumbing if implementation exposes a selectable conversion profile.
  - `web-viewer-sample/` should consume existing `usd_prim_path` / artifact refs and does not become the identity authority.
- API / data shape:
  - Internal conversion request MAY add an additive profile field such as `conversion_profile = "ifcopenshell_openusd_identity"`.
  - Conversion result / stream config SHALL expose additive quality fields such as `mapping_fidelity`, `identity_authoring_profile`, and artifact refs for new indexes.
  - Existing `element_mapping.items[].ifc_guid` and `element_mapping.items[].usd_prim_path` semantics remain backward compatible.
- Runtime boundary:
  - Conversion remains internal to `bim-streaming-server`; browser MUST NOT call `127.0.0.1:49101` directly for artifact bodies.
  - Coordinator remains the external IFC-ready intake and session/control-plane boundary.
  - Callback outbox remains metadata-only and MUST NOT upload full Pset/spatial/sidecar bodies to company cloud unless a separate contract change explicitly authorizes it.
- Dependencies:
  - This route relies on existing IFC/OpenUSD capability surface (`ifcopenshell`, `pxr.Usd`, `UsdGeom`) and MUST document license/runtime risk before becoming default production mode.
  - No Revit plugin / Revit Connector dependency is introduced.
- Non-goals:
  - Do not claim NVIDIA has a single BIM-specific official prim path schema; this change defines a repo-owned, OpenUSD-legal, NVIDIA-compatible convention.
  - Do not use HOOPS/CAD Converter ordinal sidecar matching as `guid_exact`.
  - Do not rewrite viewer UI, governance UI, or issue lifecycle in this change.
  - Do not change external cloud authority, RBAC, billing, or company data model.
  - Do not move floor/storey/space into prim path segments; spatial membership is modeled through relationships / indexes so element identity remains stable across building reorganization.
