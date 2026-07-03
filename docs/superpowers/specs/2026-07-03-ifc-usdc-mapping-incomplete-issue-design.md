# IFC to USDC Mapping Incomplete Issue Spec

## Problem

A governance rule run can return IFC failures that include `ifc_guid`, but the 3D viewer cannot highlight those rows when the conversion artifact has no authoritative `ifc_guid -> usd_prim_path` mapping.

The observed runtime case is:

- `sample-fire-rating.ids` checks `IFCDOOR` fire rating requirements.
- The exported rule run has 429 failed `IfcDoor` rows.
- The failed rows have IFC GUIDs, but `usd_prim_path` is empty.
- The conversion artifact `element_mapping.json` has `items: []`, `mapping_fidelity: "unmapped"`, and `mapped_count: 0`.
- The semantic sidecar has IFC identity entries, including the door GUIDs.
- The produced USD stage is Xform-only for those semantic entities: it has no IFC GUID customData and no `UsdGeom.Mesh` prims that the existing sidecar ordinal join can use.

In plain language: IDS and governance correctly find failed IFC doors, and the USD conversion file opens, but the conversion output does not contain enough authoritative join information to connect those IFC doors back to USD prim paths.

## Goal

When the converter sees a semantic sidecar but still cannot build an authoritative mapping, it must emit a machine-readable mapping issue that says the mapping information is incomplete.

## Non-goals

- Do not fabricate `usd_prim_path` values from path-name heuristics.
- Do not mark guessed Xform token matches as high-fidelity mapping.
- Do not change governance rule evaluation semantics.
- Do not modify front-end review session behavior in this slice.
- Do not create, push, or merge a PR in this local spec-to-done run.

## Expected behavior

For a USD stage with no IFC customData and no `UsdGeom.Mesh` carriers, while `ifc_semantic_sidecar.json` has entries:

- `element_mapping.json.items` remains empty.
- `element_mapping.json.summary.mapping_information_status` is `"incomplete"`.
- `element_mapping.json.issues[0].code` is `"ifc_usdc_mapping_information_incomplete"`.
- The issue includes counts for sidecar entries, USD prims, USD mesh prims, mapped entities, and the missing join-key condition.
- Returned quality metrics include:
  - `mapping_information_status: "incomplete"`
  - `mapping_issue_count: 1`
  - `mapping_issues: [...]`
  - `sidecar_entry_count`
  - `usd_mesh_prim_count`

For existing successful mapping paths:

- Prim CustomData mapping remains unchanged.
- Sidecar ordinal mapping through `UsdGeom.Mesh` remains unchanged.
- No mapping issue is emitted when all sidecar entries are mapped.

## Acceptance checks

- A failing regression test first demonstrates the current missing issue signal.
- The new test passes after implementation.
- Existing `_enumerate_usd_stage` tests still pass.
- `GitNexus impact` is attempted before editing the converter symbol; if unavailable for the private method, codebase-memory is recorded as advisory fallback.
- `GitNexus detect_changes` is run against the linked worktree before final reporting.
