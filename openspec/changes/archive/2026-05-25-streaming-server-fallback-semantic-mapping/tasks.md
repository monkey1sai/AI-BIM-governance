# Tasks — streaming-server-fallback-semantic-mapping

## 0. Setup

- [x] 0.1 Create branch `codex/openspec/streaming-server-fallback-semantic-mapping`
      from latest `main`.
- [x] 0.2 Run GitNexus impact analysis on `Ifc2UsdcPowershellConverterAdapter`
      (only callers are `host_native_conversion_service.py` + tests; LOW risk).
- [x] 0.3 Create OpenSpec scaffold:proposal / design / tasks / spec delta.

## 1. Failing tests first (TDD)

- [ ] 1.1 Add unit test `test_fallback_mapping_carries_ifc_type_and_name`:given
      mock IfcOpenShell shape with `guid="GUID_A"`, `name="樓梯1"`, `type="IfcStair"`,
      assert `element_mapping.json` item has `ifc_type="IfcStair"` /
      `ifc_name="樓梯1"` / non-null `entity_id`.
- [ ] 1.2 Add unit test `test_fallback_prim_paths_are_ifc_class_grouped`:assert
      generated prim path starts with `/World/IfcStair/` for an IfcStair shape.
- [ ] 1.3 Add unit test `test_fallback_unclassified_grouping`:given shape with
      empty `type`, assert prim path under `/World/Unclassified/`.
- [ ] 1.4 Add unit test `test_fallback_prim_path_sanitization`:given shape with
      special-char GUID containing `$`, assert sanitized USD-legal identifier.
- [ ] 1.5 Add unit test `test_fallback_quality_metrics_semantic_fields`:assert
      `quality_metrics.json` contains `semantic_mapping_fidelity == "ifc_class_grouped_with_name"`,
      `mapping_has_ifc_type == True`, `mapping_has_ifc_name == True`.
- [ ] 1.6 Add unit test `test_fallback_entity_id_alignment`:assert every
      `items[i].entity_id` in `element_mapping.json` appears exactly once in
      `entity_index.json` `entities[].entity_id` with same `ifc_guid` /
      `usd_prim_path`.
- [ ] 1.7 Add unit test `test_fallback_mapping_backward_compat_keys`:assert
      legacy `ifc_guid` + `usd_prim_path` keys still present on every item.
- [ ] 1.8 Run `python -m pytest bim-streaming-server/tests/test_host_native_conversion_service.py -k fallback -v`
      and verify all new tests FAIL with expected reasons (missing fields /
      wrong prim paths).

## 2. Implementation

- [ ] 2.1 Add private helper `_safe_usd_prim_name(value: str) -> str | None`:
      sanitize to `[A-Za-z0-9_]`, prepend `_` if not starting with letter / `_`,
      return `None` for empty.
- [ ] 2.2 Add private helper `_resolve_ifc_class_token(ifc_type: str) -> str`:
      returns sanitized token or `"Unclassified"` fallback.
- [ ] 2.3 Add private helper `_resolve_guid_token(ifc_guid: str, shape_index: int)
      -> str`:returns sanitized GUID or `"Shape_{shape_index:06d}"` fallback.
- [ ] 2.4 Modify `_run_ifcopenshell_openusd_fallback`:track `ifc_class_xforms`
      dict (per-IFC-class `UsdGeom.Xform.Define` once), build prim path as
      `/World/{ifc_class_token}/{guid_token}`.
- [ ] 2.5 Modify mapping_items append:add `ifc_type`, `ifc_name`, `entity_id`
      fields (keep `ifc_guid`, `usd_prim_path` first for backward-compat ordering).
- [ ] 2.6 Modify entity_items append:add `entity_id` field (same value as
      mapping_items entry at the same shape index).
- [ ] 2.7 Modify quality_metrics dict:add `semantic_mapping_fidelity`,
      `mapping_has_ifc_type`, `mapping_has_ifc_name`.
- [ ] 2.8 Handle prim path collision:if `stage.GetPrimAtPath(prim_path).IsValid()`,
      suffix with `_{shape_index:06d}`.

## 3. Verify

- [ ] 3.1 Run `python -m pytest bim-streaming-server/tests/test_host_native_conversion_service.py -v`
      and verify ALL tests pass (new + existing).
- [ ] 3.2 Run `python -m pytest bim-streaming-server/tests -q`
      and verify no regression in adjacent suites.
- [ ] 3.3 Run `python -m pytest tests -p no:cacheprovider` for repo-root contracts
      and fakes;no regression.
- [ ] 3.4 Run `openspec validate streaming-server-fallback-semantic-mapping --strict`
      (use the `openspec` CLI under `~/AppData/Roaming/npm/openspec`).
- [ ] 3.5 Run `openspec validate --specs --strict`.
- [ ] 3.6 GitNexus `detect_changes` to confirm changes only touch
      `ifc2usdc_powershell_adapter.py` + `test_host_native_conversion_service.py`
      + `openspec/changes/streaming-server-fallback-semantic-mapping/`.

## 4. Commit / PR

- [ ] 4.1 `git diff --cached --check` to catch trailing whitespace.
- [ ] 4.2 Commit:`feat(streaming): fallback 加 IFC 語意 mapping (streaming-server-fallback-semantic-mapping)`.
- [ ] 4.3 Push branch and open PR with Traditional Chinese title / body.
- [ ] 4.4 Wait for GitHub Actions verify + human review.
- [ ] 4.5 Address review comments inside this branch (do not amend; new commits).

## 5. Archive (post-merge, blocked by user merge action)

- [ ] 5.1 After PR merged to `origin/main`, sync local main:
      `git fetch origin --prune` then align `main` with `origin/main`.
- [ ] 5.2 Run `openspec archive streaming-server-fallback-semantic-mapping`
      (move to `openspec/changes/archive/<date>-streaming-server-fallback-semantic-mapping/`).
- [ ] 5.3 Sync delta into `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`.
- [ ] 5.4 Update `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`(roadmap
      Markdown source-of-truth).
- [ ] 5.5 Regenerate `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`
      (HTML view derived from Markdown).
- [ ] 5.6 Run closeout event flow per AGENTS.md `Archive 後的 agent closeout
      event flow`:check local / remote branches, delete merged branches with
      reporting.
