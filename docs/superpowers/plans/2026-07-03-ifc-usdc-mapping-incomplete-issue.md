# IFC USDC Mapping Incomplete Issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an honest machine-readable issue when IFC semantic sidecar data exists but IFC-to-USD mapping cannot be built from authoritative USD join keys.

**Architecture:** Keep the change inside the host-native conversion enumeration path. `_enumerate_usd_stage` already writes `element_mapping.json`, `entity_index.json`, `metadata.json`, and quality metrics, so it is the smallest correct place to surface a mapping-incomplete issue without changing governance rule evaluation.

**Tech Stack:** Python 3.12, pytest, Pixar USD Python bindings (`pxr.Usd`, `pxr.UsdGeom`), existing `Ifc2UsdcPowershellConverterAdapter` tests.

---

## File Structure

- Modify `bim-streaming-server/tests/test_host_native_conversion_service.py`
  - Add an Xform-only USD stage helper.
  - Add a regression test for sidecar-present / no-joinable-USD mapping.
- Modify `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`
  - Count sidecar entries and USD mesh prims in `_enumerate_usd_stage`.
  - Add `mapping_information_status` and `mapping_issues` to mapping artifact and returned quality metrics.

## Task 1: Write the regression test first

**Files:**
- Modify: `bim-streaming-server/tests/test_host_native_conversion_service.py`

- [ ] **Step 1: Add an Xform-only USD helper near `_write_usd_stage_with_ifc_prims`**

```python
def _write_usd_stage_with_xform_prims(usdc_path: Path, paths: list[str]) -> None:
    from pxr import Usd, UsdGeom

    usdc_path.parent.mkdir(parents=True, exist_ok=True)
    stage = Usd.Stage.CreateNew(str(usdc_path))
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    for path in paths:
        UsdGeom.Xform.Define(stage, path)
    stage.GetRootLayer().Save()
```

- [ ] **Step 2: Add the failing regression test after `test_enumeration_reads_sidecar_when_prim_custom_data_empty`**

```python
def test_enumeration_reports_incomplete_mapping_when_sidecar_has_entries_but_stage_has_no_joinable_prims(
    tmp_path: Path, monkeypatch
):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    _write_usd_stage_with_xform_prims(
        usdc,
        [
            "/World/IFCDOOR_25312",
            "/World/IFCDOOR_25341",
        ],
    )
    _write_sidecar_doc(
        out_dir,
        [
            {"ifc_guid": "GUID_DOOR_A", "ifc_type": "IfcDoor", "ifc_name": "Door:25312", "shape_index": 0},
            {"ifc_guid": "GUID_DOOR_B", "ifc_type": "IfcDoor", "ifc_name": "Door:25341", "shape_index": 1},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    assert quality["mapping_information_status"] == "incomplete"
    assert quality["mapping_issue_count"] == 1
    assert quality["sidecar_entry_count"] == 2
    assert quality["usd_mesh_prim_count"] == 0
    issue = quality["mapping_issues"][0]
    assert issue["code"] == "ifc_usdc_mapping_information_incomplete"
    assert issue["sidecar_entry_count"] == 2

    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    assert mapping_doc["items"] == []
    assert mapping_doc["summary"]["mapping_information_status"] == "incomplete"
    assert mapping_doc["issues"][0]["code"] == "ifc_usdc_mapping_information_incomplete"
```

- [ ] **Step 3: Run the new test and verify it fails for the missing behavior**

Run:

```powershell
python -m pytest bim-streaming-server/tests/test_host_native_conversion_service.py::test_enumeration_reports_incomplete_mapping_when_sidecar_has_entries_but_stage_has_no_joinable_prims -q
```

Expected: FAIL with `KeyError: 'mapping_information_status'` or equivalent missing field.

## Task 2: Implement the mapping incomplete issue

**Files:**
- Modify: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`

- [ ] **Step 1: Track sidecar and mesh counts in `_enumerate_usd_stage`**

```python
sidecar_entry_count = 0
mesh_prim_count = 0
if not mapping_items:
    sidecar_doc = self._load_ifc_semantic_sidecar(mapping_path.parent)
    if isinstance(sidecar_doc, dict):
        sidecar_entries = sidecar_doc.get("entries")
        if isinstance(sidecar_entries, list):
            sidecar_entry_count = len(sidecar_entries)
        mesh_prims = [p for p in prims if UsdGeom.Mesh(p)]
        mesh_prim_count = len(mesh_prims)
```

- [ ] **Step 2: Emit a structured issue only when sidecar data exists but no authoritative mapping could be produced**

```python
mapping_issues: list[dict[str, Any]] = []
if sidecar_entry_count > 0 and mapped_count == 0:
    mapping_issues.append(
        {
            "code": "ifc_usdc_mapping_information_incomplete",
            "severity": "warning",
            "message": (
                "IFC semantic sidecar exists, but the USD stage has no IFC "
                "customData mapping and no joinable UsdGeom.Mesh sidecar carriers."
            ),
            "sidecar_entry_count": sidecar_entry_count,
            "usd_prim_count": len(prims),
            "usd_mesh_prim_count": mesh_prim_count,
            "mapped_count": mapped_count,
            "required_join_keys": [
                "USD prim IFC customData",
                "UsdGeom.Mesh ordinal sidecar carrier",
            ],
        }
    )
mapping_information_status = "incomplete" if mapping_issues else "complete"
```

- [ ] **Step 3: Include the issue in mapping artifact and quality metrics**

```python
"summary": {
    "mapped_count": mapped_count,
    "fake_mapping_count": 0,
    "mapping_information_status": mapping_information_status,
    "mapping_issue_count": len(mapping_issues),
},
"issues": mapping_issues,
```

and:

```python
"mapping_information_status": mapping_information_status,
"mapping_issue_count": len(mapping_issues),
"mapping_issues": mapping_issues,
"sidecar_entry_count": sidecar_entry_count,
"usd_mesh_prim_count": mesh_prim_count,
```

- [ ] **Step 4: Run the new test and verify it passes**

Run:

```powershell
python -m pytest bim-streaming-server/tests/test_host_native_conversion_service.py::test_enumeration_reports_incomplete_mapping_when_sidecar_has_entries_but_stage_has_no_joinable_prims -q
```

Expected: PASS.

## Task 3: Regression verification

**Files:**
- Verify: `bim-streaming-server/tests/test_host_native_conversion_service.py`

- [ ] **Step 1: Run the existing enumeration tests touched by this behavior**

Run:

```powershell
python -m pytest `
  bim-streaming-server/tests/test_host_native_conversion_service.py::test_enumeration_path_writes_semantic_fields `
  bim-streaming-server/tests/test_host_native_conversion_service.py::test_enumeration_path_empty_custom_data_stays_honest `
  bim-streaming-server/tests/test_host_native_conversion_service.py::test_enumeration_reads_sidecar_when_prim_custom_data_empty `
  bim-streaming-server/tests/test_host_native_conversion_service.py::test_enumeration_prefers_prim_custom_data_over_sidecar `
  bim-streaming-server/tests/test_host_native_conversion_service.py::test_enumeration_reports_incomplete_mapping_when_sidecar_has_entries_but_stage_has_no_joinable_prims `
  -q
```

Expected: `5 passed`.

- [ ] **Step 2: Run GitNexus detect_changes on the linked worktree**

Run via MCP:

```text
detect_changes(scope="all", worktree="C:\\Repos\\active\\iot\\AI-BIM-governance\\.worktrees\\ifc-usdc-mapping-incomplete-issue")
```

Expected: changed symbols limited to the converter enumeration path and its focused tests, or a documented GitNexus limitation if it cannot map the linked worktree diff.
