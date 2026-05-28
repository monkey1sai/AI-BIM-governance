# Tasks — streaming-server-ifcopenshell-semantic-sidecar-pass

## 0. Setup

- [x] 0.1 Create branch `codex/openspec/streaming-server-ifcopenshell-semantic-sidecar-pass`
      + worktree `<repo>/.worktrees/streaming-server-ifcopenshell-semantic-sidecar-pass/`
      from `origin/main`(HEAD `cfed4ff`)。
- [ ] 0.2 Inspect `Ifc2UsdcPowershellConverterAdapter._materialize_sidecars` /
      `_adopt_converter_sidecars` / `_enumerate_usd_stage` /
      `_run_ifcopenshell_openusd_fallback` in
      `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/
      ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`,
      確認 IfcOpenShell import 路徑與 sidecar 寫入時序假設。
- [x] 0.3 Create OpenSpec scaffold(proposal / design / tasks / spec delta)。
- [ ] 0.4 GitNexus pre-impact:
      `gitnexus_impact({target: "_materialize_sidecars", direction: "upstream"})`、
      `gitnexus_impact({target: "_enumerate_usd_stage", direction: "upstream"})`
      回報 blast radius;HIGH / CRITICAL 先停下回報。

## 1. Failing tests first

- [ ] 1.1 `test_sidecar_pass_writes_json_for_valid_ifc`:monkey-patched
      `ifcopenshell.open` 回 fake IFC product list(含 GlobalId / is_a / Name),
      assert sidecar JSON 落地 + schema 正確(`format_version` / `entries` /
      `summary`)。
- [ ] 1.2 `test_sidecar_pass_returns_none_for_missing_ifc`:IFC path 不存在
      → 回 None,不抛例外,不寫 sidecar。
- [ ] 1.3 `test_sidecar_pass_returns_none_when_ifcopenshell_missing`:
      monkey-patch `import ifcopenshell` raise ImportError → 回 None。
- [ ] 1.4 `test_enumeration_reads_sidecar_when_prim_custom_data_empty`:
      fake USD stage 無 IFC CustomData + sidecar entries 存在 → mapping_items
      從 sidecar 補(五 keys 含 entity_id)+ entity_index 對齊 entity_id +
      quality_metrics
      `semantic_mapping_fidelity = "usd_enumeration_with_ifc_sidecar_supplement"`、
      `mapping_has_ifc_type = true`、`mapping_has_ifc_name = true`。
- [ ] 1.5 `test_enumeration_prefers_prim_custom_data_over_sidecar`:
      fake USD stage 有 IFC CustomData + sidecar 同時存在 → mapping_items
      來源走 CustomData,fidelity 維持 C6 既有
      `"ifc_class_grouped_with_name"`,sidecar 不 shadow 既有行為。
- [ ] 1.6 `test_enumeration_stays_honest_when_neither_source_present`:
      fake USD stage 無 CustomData + 無 sidecar → mapping_items 空 +
      `semantic_mapping_fidelity = null` + `mapping_has_ifc_type = false` +
      `mapping_has_ifc_name = false`(viewer Semantic = no,誠實)。
- [ ] 1.7 跑 `cd bim-streaming-server && python -m pytest tests/test_host_native_conversion_service.py -q
      -k "sidecar_pass or enumeration_reads_sidecar or enumeration_prefers or
      enumeration_stays_honest"` → 6 test FAIL(實作還沒)。

## 2. Implementation

- [x] 2.1 加 `Ifc2UsdcPowershellConverterAdapter._run_ifcopenshell_semantic_sidecar(
      *, ifc_source_path, artifact_dir)` 到
      `ifc2usdc_powershell_adapter.py`(設計 D1 + D2;CodeRabbit P0 fix:
      `by_type` 失敗 SHALL return None 不寫 sidecar;過濾 IfcProduct 有
      Representation,避免 IfcSite/IfcBuilding/IfcBuildingStorey/IfcSpace
      把 mesh-index 對齊全錯位)。
- [x] 2.2 加 static method `_load_ifc_semantic_sidecar(artifact_dir)` 與
      `_sidecar_entry_for_mesh_index(sidecar_doc, mesh_index)`(設計 D3)。
- [x] 2.3 修改 `_enumerate_usd_stage`:不改 signature(從 `mapping_path.parent`
      自動找 sidecar);既有 prim CustomData loop 不動;loop 結束後
      mapping_items 為空時讀 sidecar supplement;quality_metrics 推導擴充支援
      fidelity value `"usd_enumeration_with_ifc_sidecar_supplement"`(設計 D3
      + D4)。
- [x] 2.4 修改 `_materialize_sidecars` main flow:adopt 拿到 sidecars 但
      `mapping_has_ifc_type` / `mapping_has_ifc_name` 全 falsy 時 SHALL 仍跑
      sidecar pass + enumeration(CodeRabbit P0 fix;對齊 spec scenario
      「HOOPS success without IFC CustomData triggers sidecar pass」)。
- [x] 2.5 確認 `_run_ifcopenshell_openusd_fallback` 與 C1 archive 行為不被
      影響(fallback path 自寫 mapping/quality 不讀 sidecar)。
- [x] 2.6 跑 task 1.7 test 全綠;repo 既有 fallback + C6 enumeration test 不
      破壞。

## 3. Verify

- [ ] 3.1 `cd bim-streaming-server && .venv\Scripts\python.exe -m pytest tests -q`
      (streaming sub-repo 全綠;對齊 CLAUDE.md §3 venv 強制要求,避免
      user-site packages 撞 FastAPI/Starlette 版本)。
- [ ] 3.2 repo root `.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider -q`
      (root contracts 不退化;同上 venv 規範)。
- [ ] 3.3 `npx openspec validate streaming-server-ifcopenshell-semantic-sidecar-pass --strict`。
- [ ] 3.4 `npx openspec validate --specs --strict`(全 specs 維持 pass)。
- [ ] 3.5 GitNexus post-impact:`gitnexus_detect_changes()` 確認改動範圍
      限 `_materialize_sidecars` / `_enumerate_usd_stage` / 新 helper,
      affected processes ≤ 預期。
- [ ] 3.6 `git diff --cached --check`(無 trailing whitespace)。
- [ ] 3.7 L4 (apply-and-verify 階段) 真機 evidence:
      - 重啟 host-native conversion service
      - 重跑使用者 341MB IFC 或 89MB IFC
      - 驗 `GET /api/conversions/<id>/result.quality_metrics`:
        `semantic_mapping_fidelity = "usd_enumeration_with_ifc_sidecar_supplement"`、
        `mapping_has_ifc_type = true`、`mapping_has_ifc_name = true`
      - 驗 artifact dir 內 `ifc_semantic_sidecar.json` 存在 + `summary.count > 0`
      - Chrome MCP / Playwright 抓 viewer:`tri-ready-semantic = "Semantic: yes"`
      - 證據存 `docs/evidence/streaming-server-ifcopenshell-semantic-sidecar-pass/`

## 4. Commit / PR

- [ ] 4.1 `git diff --cached --check` 通過。
- [ ] 4.2 Commit message(zh-TW + scope):
      `feat(streaming): IfcOpenShell semantic sidecar pass for HOOPS happy path (streaming-server-ifcopenshell-semantic-sidecar-pass)`
      + Co-Authored-By line。
- [ ] 4.3 Push branch `codex/openspec/streaming-server-ifcopenshell-semantic-sidecar-pass`。
- [ ] 4.4 開 PR(zh-TW title + body),body 附 verify 4 級結果與 GitNexus
      detect_changes 摘要。

## 5. Archive (post-merge)

- [ ] 5.1 Sync local main + fetch origin。
- [ ] 5.2 `npx openspec archive streaming-server-ifcopenshell-semantic-sidecar-pass`。
- [ ] 5.3 Sync delta into
      `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`
      (ADD 新 requirement)。
- [ ] 5.4 Update roadmap
      [`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`](../../../docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md)
      §1.4 / §10:archive 對齊紀錄;把
      `c2-viewer-semantic-final-vendor-blocker.md` 的「下一步建議」標為已落地。
- [ ] 5.5 重啟 host-native conversion service 跑 demo IFC,Chrome MCP /
      Playwright 截 `Semantic: yes` 證據存
      `docs/evidence/streaming-server-ifcopenshell-semantic-sidecar-pass/`。
- [ ] 5.6 Closeout per [`AGENTS.md`](../../../AGENTS.md) + repo-local
      [`openspec/AGENTS.md`](../../AGENTS.md);worktree cleanup 走
      `git worktree remove`。
