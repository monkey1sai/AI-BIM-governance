# Tasks — streaming-server-enumeration-semantic-mapping

## 0. Setup

- [x] 0.1 Create branch `codex/openspec/streaming-server-enumeration-semantic-mapping`。
- [x] 0.2 Inspect `_materialize_sidecars` / `_adopt_converter_sidecars` /
      `_enumerate_usd_stage` in `ifc2usdc_powershell_adapter.py`。
- [x] 0.3 Create OpenSpec scaffold(proposal / design / tasks / spec delta)。

## 1. Failing tests first

- [ ] 1.1 新增 `test_enumeration_path_writes_semantic_fields`:fake USD stage
      with prim CustomData(`ifcGlobalId` / `ifcType` / `ifcName`)→ assert
      mapping items 含五 keys + quality_metrics 三 semantic 欄位 truthy。
- [ ] 1.2 新增 `test_enumeration_path_empty_custom_data_stays_honest`:fake
      prim 無 IFC custom data → mapping empty + semantic_mapping_fidelity=null
      + has_type/name=false。
- [ ] 1.3 新增 `test_adopt_path_supplements_missing_semantic_fields`:emitted
      quality 無 semantic 欄位 + emitted mapping items 有 ifc_type/ifc_name
      → supplement 補上。
- [ ] 1.4 新增 `test_adopt_path_does_not_overwrite_existing_semantic`:emitted
      quality 已有 `semantic_mapping_fidelity` = `"converter_native_high_fidelity"`
      → adopt 後維持原值。
- [ ] 1.5 跑 `python -m pytest ... -k "enumeration_path or adopt_path"` →
      四 test FAIL(實作還沒)。

## 2. Implementation

- [ ] 2.1 加 helper `_read_prim_custom(prim, *keys)`(static / module level)
      讀 USD prim CustomData,容忍多種 key naming(`ifc:guid` / `ifcGlobalId`
      / `ifc_guid` 等)。
- [ ] 2.2 修改 `_enumerate_usd_stage`:每個 prim 抽 ifc_type / ifc_name,
      mapping_items 加 entity_id,entity_index entries 對齊。
- [ ] 2.3 `_enumerate_usd_stage` quality_metrics 加 `semantic_mapping_fidelity`
      / `mapping_has_ifc_type` / `mapping_has_ifc_name`(fidelity 三狀態:
      `ifc_class_grouped_with_name` / `usd_enumeration_with_ifc_custom_data` /
      `None`)。
- [ ] 2.4 修改 `_adopt_converter_sidecars`:讀 emitted quality 後 supplement
      missing semantic 欄位(non-fabricating + 不蓋既有值)。
- [ ] 2.5 跑 test 全綠;C1 fallback 既有 test 不破壞。

## 3. Verify

- [ ] 3.1 `cd bim-streaming-server && python -m pytest tests -q`。
- [ ] 3.2 repo root `python -m pytest tests -p no:cacheprovider -q`。
- [ ] 3.3 `openspec validate streaming-server-enumeration-semantic-mapping --strict`。
- [ ] 3.4 `openspec validate --specs --strict`。

## 4. Commit / PR

- [ ] 4.1 `git diff --cached --check`。
- [ ] 4.2 Commit:`feat(streaming): enumeration / adopt path 寫 IFC semantic
      mapping fidelity (streaming-server-enumeration-semantic-mapping)`。
- [ ] 4.3 Push + 開 PR(zh-TW)。

## 5. Archive (post-merge)

- [ ] 5.1 Sync local main。
- [ ] 5.2 `openspec archive streaming-server-enumeration-semantic-mapping`。
- [ ] 5.3 Sync delta into `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`。
- [ ] 5.4 Update roadmap MD + HTML。
- [ ] 5.5 重啟 host-native conversion service + 跑 89MB IFC + Chrome MCP 驗
      `tri-ready-semantic = "Semantic: yes"`,存至
      `docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/c2-viewer-semantic-yes-final.md`。
- [ ] 5.6 Closeout per `AGENTS.md`。
