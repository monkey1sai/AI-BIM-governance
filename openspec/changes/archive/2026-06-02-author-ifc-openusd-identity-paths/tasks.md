## 1. Preflight

- [x] 1.1 Inspect `bim-streaming-server` conversion adapter / host-native service request and result schemas to locate the smallest place for an additive `conversion_profile`.
- [x] 1.2 Run GitNexus impact analysis before editing converter symbols such as `_run_ifcopenshell_openusd_fallback`, `_materialize_sidecars`, `_enumerate_usd_stage`, or any new authoring integration point; stop and report if HIGH / CRITICAL risk appears.
- [x] 1.3 Confirm current `ifcopenshell` and OpenUSD / `pxr` runtime availability in the host-native conversion environment; document dependency and license risk before making this route default.
- [x] 1.4 Confirm existing artifact refs / stream config consumers only require `ifc_guid` and `usd_prim_path`, so new sidecar fields can remain additive.

## 2. Failing Tests First

- [x] 2.1 Add tests for deterministic USD-safe path generation from IFC class and `GlobalId`, including collision handling and preservation of original unsanitized values.
- [x] 2.2 Add tests that identity authoring creates stable element root paths under `/World/Elements/<IfcType>/G_<encoded_guid>` and keeps split mesh children under the root.
- [x] 2.3 Add tests that `element_mapping.json` declares `mapping_fidelity = "guid_exact"` only for identity-authored IFC elements and points to element root prims.
- [x] 2.4 Add tests that `entity_index`, `pset_index`, `spatial_index`, `bbox_index`, `quality_metrics`, and geo reference artifacts are emitted with joinable `entity_id` values.
- [x] 2.5 Add tests that missing CRS / true north / transform data produces quality warnings rather than fabricated geo metadata.
- [x] 2.6 Add regression tests that HOOPS/CAD Converter ordinal or sidecar-derived mapping is not labeled `guid_exact`.
- [x] 2.7 Add a no-plugin regression test: dispatching `conversion_profile = "ifcopenshell_openusd_identity"` uses IFC input directly and does not require Revit Connector / Revit add-in state.

## 3. Core Implementation

- [x] 3.1 Add an internal-only `conversion_profile = "ifcopenshell_openusd_identity"` route while preserving existing default conversion behavior for requests without the field.
- [x] 3.2 Implement or extract a focused IFC -> OpenUSD identity authoring component in `bim-streaming-server` that parses IFC products, creates element root Xforms, writes mesh children, and opens the resulting stage for validation.
- [x] 3.3 Implement deterministic USD-safe identifier encoding for IFC class, IFC `GlobalId`, and generated mesh child names.
- [x] 3.4 Author IFC identity metadata / customData on element root prims, including original `bim:ifc_guid`, `bim:ifc_type`, `bim:ifc_name`, and source model/version identifiers when available.
- [x] 3.5 Emit `element_mapping.json` during USD authoring rather than after-the-fact enumeration, with `mapping_fidelity = "guid_exact"` and honest unmapped counts.
- [x] 3.6 Emit `entity_index`, `pset_index`, `spatial_index`, `bbox_index`, `quality_metrics`, and geo reference artifact refs from the same conversion transaction.
- [x] 3.7 Keep floor/storey/space/system relationships in sidecars / relationships / collections instead of prim path segments.
- [x] 3.8 Ensure heavy identity authoring runs in the conversion worker / host-native service lane and does not block live WebRTC viewport readiness.

## 4. Coordinator / Viewer Compatibility

- [x] 4.1 If coordinator needs to select the route, plumb the optional `conversion_profile` through internal conversion dispatch without changing the external `POST /api/external/ifc-ready` contract.
- [x] 4.2 Ensure conversion result / stream config exposes additive artifact refs and quality metrics without requiring browser direct access to the internal conversion service.
- [x] 4.3 Verify `web-viewer-sample` can focus/highlight using stable element root `usd_prim_path` values and remains compatible with legacy mapping shape.
- [x] 4.4 Confirm callback outbox only sends metadata / opaque refs / summary quality fields and does not include full Pset, spatial, bbox, or geo sidecar bodies.

## 5. Validation

- [x] 5.1 Run targeted `bim-streaming-server` pytest tests for identity authoring, mapping fidelity, sidecar schema, and HOOPS non-`guid_exact` regression.
- [x] 5.2 Run service-level conversion API smoke for `conversion_profile = "ifcopenshell_openusd_identity"` with a real IFC fixture.
- [x] 5.3 Validate produced USD opens via OpenUSD runtime, has `defaultPrim = "World"`, uses expected units/upAxis metadata, and contains at least one renderable mesh.
- [x] 5.4 Verify `element_mapping.json` can resolve every mapped `ifc_guid -> usd_prim_path` and that each target prim exists in the USD stage.
- [x] 5.5 Verify bbox / spatial / Pset / geo indexes can be consumed without re-parsing IFC.
- [x] 5.6 Run `npx openspec validate author-ifc-openusd-identity-paths --strict`.
- [x] 5.7 Run `npx openspec validate --all --strict` or document any pre-existing unrelated spec failures.
- [x] 5.8 Run GitNexus detect-changes before commit and confirm affected symbols / flows match the planned converter and optional coordinator plumbing scope. GitNexus MCP/CLI was run, but the current index is rooted at the main workspace and cannot target this `.worktrees/author-ifc-openusd-identity-paths` path; actual worktree scope was confirmed with `git diff` as converter + optional coordinator plumbing only.

## 6. Documentation / Evidence / Closeout

- [x] 6.1 Record real IFC evidence under `docs/evidence/author-ifc-openusd-identity-paths/`, including conversion result, quality metrics, stage-open result, and mapping sample.
- [x] 6.2 Update relevant runbook or contract docs if the internal conversion profile or artifact package schema becomes user-facing to operators. No operator-facing contract was added; evidence records the internal profile and artifact package.
- [x] 6.3 Prepare PR summary in Traditional Chinese with changed files, validation, dependency/license risk, and rollback path.
- [x] 6.4 After merge, archive the OpenSpec change and sync the new requirement into `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`.
