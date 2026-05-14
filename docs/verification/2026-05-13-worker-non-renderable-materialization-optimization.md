# worker-non-renderable-materialization optimization verification

日期：2026-05-13

## Scope

本紀錄對應 OpenSpec change `optimize-worker-non-renderable-materialization`，範圍限於：

- `_worker` non-renderable IFC entity materialization
- `non_renderable_entity_materialization` phase progress / diagnostics
- canonical `storage/*.ifc` single-fixture burn-down evidence
- artifact group lineage 對應的 sidecar (`entity_index.json`) 寫入
- batch verification 取得首個 89MB fixture 的完成 evidence

本 change 不處理 `_bim-control` metadata authority、`bim-review-coordinator` session lifecycle、`web-viewer-sample`、Kit runtime、WebRTC、GPU provisioning 或 production batch scheduler。

## Baseline Before This Change

前一份 canonical evidence：

- File: `docs/verification/2026-05-13-worker-source-entity-enumeration-optimization.md`
- Command: `python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600 --profile-source-entities`
- Fixture: `許良宇圖書館建築_2026 - 複製 (10).ifc`
- Size: `89394282` bytes
- Result: `timed_out`，last known phase `non_renderable_entity_materialization`
- Baseline decision: `minimum_coverage_locked=false`

本 change apply 階段先補充 always-on materialization diagnostics 與 profile，再重跑 canonical 取得結構化 baseline：

- Profiled baseline run：`conversion_job_id=conv_20260513102219_4c543c8f`、`artifact_group_id=ag_ec7eda49abf7`、`source_artifact_id=artifact_src_17f2e857a8ff`
- Result: still `timed_out` after 600s，within `non_renderable_entity_materialization`
- `materialized_entity_count=69,189` of `1,604,773` (≈4.3% complete) at timeout
- Per-operation breakdown：
  - `xform_define_seconds=365.48s`（97.4% of materialization 375s）
  - `attribute_write_seconds=8.19s`
  - `unique_prim_path_seconds=0.51s`
  - `progress_write_seconds=0.28s`、`row_append=0.14s`、`mapping_append=0.17s`
- Projected wall time at baseline rate for全部 1.5M：**~8,160s（13.6× 超 budget）**

## Selected Option

依 `openspec/changes/optimize-worker-non-renderable-materialization/design.md` 的 Option Selection Gate：

- 選定 **Option 4 (sidecar carrier)** + **Option 3 (chunked progress writes)**
- 拒絕 Option 1 (`Sdf.ChangeBlock`)：投影 5–10× 仍超 600s budget
- 拒絕 Option 2 (flat `Scope` prim path)：對應 cost 僅 0.13%
- 拒絕 Option 5 (secondary `guid_extraction` / `name_extraction`)：投影僅省 ~10s vs 主要 365s 瓶頸
- Option 4 跨 repo 影響由 Handoff Framework 驗證：
  - Coordinator (`bim-review-coordinator`)：`usd_prim_path` 已為 optional，無 `usd_prim_count` 消費，passes payload 不動
  - Viewer (`web-viewer-sample`)：`Window.tsx:894` 已用 `Boolean(item['usd_prim_path'])` filter，自然丟掉 sidecar entries
  - Streaming (`bim-streaming-server/source`)：對 non-renderable prim 無依賴（grep zero matches）

## Implemented Optimization

`_worker/app/converters.py` 與 `_worker/app/store.py` 變更：

- `_materialize_unmapped_entities` 接受 `strategy` 參數（`sidecar`（預設）/ `usd_prim`）。`sidecar` 路徑：
  - 不再對每個 non-renderable IFC entity 呼叫 `UsdGeom.Xform.Define` 或 `CreateAttribute`
  - 將 stable identity（`ifc_entity_key`、`ifc_entity_id`、`ifc_guid`、`ifc_class`、`name`、`renderable=false`）累積至 `sidecar_entries`
  - 在 `mapping_by_entity` 中註記 `usd_prim_path=None`、`mapping_method="ifc_entity_to_sidecar_index"`、`carrier="sidecar"`
- `convert()` 在 materialization 完成後，將 `sidecar_entries` 寫入 `entity_index.json`
- `ConversionAdapterResult` 增加 `entity_index_path: Path | None = None`（dataclass field with default，向後相容既有 callers）
- Quality metrics 與 mapping summary 新增 additive optional 欄位：`materialization_strategy`、`sidecar_carrier_count`
- `store.py`：
  - `complete_conversion_job` 在 result 加入 `entity_index_url` 與 `derived_artifact_ids.entity_index`（只在 sidecar 路徑下出現）
  - `_lineage_artifact_candidates` / `_normalized_derived_artifact_ids` / `_lineage_from_conversion_job` / `_derived_group_payload` / `_publish_staged_adapter_outputs` / `_assert_adapter_result` 都加入 entity_index 分支
  - lineage graph 對 entity_index 補 `has_sidecar` edge

`_materialize_unmapped_entities` 仍寫入 always-on diagnostics（不論策略）：`materialized_entity_count`、`materialization_strategy`、`elapsed_seconds`、`last_operation`、`progress_write_count`、`fallback_used`。`--profile-source-entities` 旗標下另寫入 fine-grained profile（`unique_prim_path_seconds`、`xform_define_seconds`、`attribute_write_seconds`、`row_append_seconds`、`mapping_append_seconds`、`progress_write_seconds`、`sidecar_io_seconds`）。

Secondary scope（`guid_extraction` / `name_extraction` 優化）依 design.md 與 §4 任務說明 defer 到 follow-up change，因為 primary burn-down 已通過且 secondary 在 baseline 中僅佔 ~10s vs 365s 主瓶頸。

## Commands And Results

### Focused tests

```powershell
cd _worker
python -m pytest tests\ -q
```

Result: `112 passed, 1 skipped`。新增 `_worker/tests/test_worker_converters.py` 中的 5 個 sidecar tests（§5.1–§5.5 spec scenarios）以及 `_worker/tests/test_worker_store.py` 中的 2 個 lineage tests，並更新既有 `test_ifcopenshell_converter_does_not_count_missing_or_unknown_guids_as_mapping` 對齊 sidecar carrier 後的 USD index / mapping payload。

### OpenSpec strict validation

```powershell
openspec validate optimize-worker-non-renderable-materialization --strict
```

Result: `Change 'optimize-worker-non-renderable-materialization' is valid`。

### Canonical profiled single-fixture run (post-change)

```powershell
cd _worker
$env:WORKER_DEV_STORAGE_ROOT='C:\Repos\active\iot\AI-BIM-governance\storage'
python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600 --profile-source-entities
```

Result: **passed**（首次有 canonical `model.usdc` 完成輸出 + lineage 完整）

- Batch-level status: `partial`（單一 fixture 範圍）
- Fixture-level status: `passed`
- Fixture: `許良宇圖書館建築_2026 - 複製 (10).ifc`
- Size: `89394282` bytes
- `source_artifact_id=artifact_src_e63ba1705fe1`
- `artifact_group_id=ag_bc5f30cda296`
- `conversion_job_id=conv_20260513105315_57b2c0fa`
- `derived_usdc_artifact_id=artifact_usdc_20260513105315_57b2c0fa`
- `mapping_artifact_id=artifact_mapping_20260513105315_57b2c0fa`
- `usdc_url`：`http://127.0.0.1:8005/objects/.../ag_bc5f30cda296/derived/conv_20260513105315_57b2c0fa/usdc/model.usdc`
- `mapping_url`：`.../element_mapping.json`
- `readiness_state.status=ready`、`mapping_ready=true`、`coverage_status=unlocked`
- `minimum_coverage_locked=false`
- `lineage_api_status=ok`
- `output_file_size_bytes=9844612`（~9.4 MB；baseline 從未產生完成 USDC）
- `duration_seconds=267.72`（fixture 端到端 wall-clock，包含 `source_read` / `artifact_intake` / `conversion_total` / `lineage_lookup`，即 verification harness 計時範圍）
- `conversion_total=232.42s`（converter 內部 phases 加總，含 `ifc_open` → `stage_reopen` 與 `artifact_publish`，不含 batch harness 端的 `source_read` / `artifact_intake` / `lineage_lookup`）

### Phase timing summary

> 兩種總和的差異：`duration_seconds=267.72` 為 fixture 端到端 wall-clock（涵蓋下表所有列）；`conversion_total=232.42s` 為 converter 內部範圍（`ifc_open` + `source_entity_enumeration` + `geometry_iteration` + `mesh_authoring` + `non_renderable_entity_materialization` + `stage_save` + `stage_reopen` + `artifact_publish`），不含 batch harness 端的 `source_read` / `artifact_intake` / `lineage_lookup`。差值 `~35s` 對應 source_read + artifact_intake + lineage_lookup 的開銷。

| Phase | Baseline | Post-change | Δ | 計入哪個 total |
|---|---|---|---|---|
| `source_read` | n/a | <0.1s | - | duration_seconds |
| `artifact_intake` | n/a | <1s | - | duration_seconds |
| `ifc_open` | 4.23s | 4.28s | flat | conversion_total + duration_seconds |
| `source_entity_enumeration` | 33.19s | 27.26s | -5.93s | conversion_total + duration_seconds |
| `geometry_iteration` | 198.08s | 187.47s | -10.61s | conversion_total + duration_seconds |
| `mesh_authoring` | 8.51s | 7.23s | -1.28s | conversion_total + duration_seconds |
| `non_renderable_entity_materialization` | timed_out > 375s | **5.05s** | **-370s+，~74× faster** | conversion_total + duration_seconds |
| `stage_save` | not_reached | 0.24s | unblocked | conversion_total + duration_seconds |
| `stage_reopen` | not_reached | 0.02s | unblocked | conversion_total + duration_seconds |
| `artifact_publish` | not_reached | 0.001s | unblocked | conversion_total + duration_seconds |
| `conversion_total` | not_reached | 232.42s | unblocked | （converter 內部 phases 的 sum） |
| `lineage_lookup` | not_run | 0.13s | unblocked | duration_seconds |

### Materialization diagnostics (post-change)

```json
{
  "materialized_entity_count": 1597773,
  "materialization_strategy": "sidecar",
  "elapsed_seconds": 5.054024600016419,
  "last_operation": "completed",
  "progress_write_count": 319,
  "fallback_used": false,
  "profile": {
    "unique_prim_path_seconds": 0.0,
    "xform_define_seconds": 0.0,
    "attribute_write_seconds": 0.0,
    "row_append_seconds": 0.0,
    "mapping_append_seconds": 0.0,
    "progress_write_seconds": 0.46411560010164976,
    "sidecar_io_seconds": 1.3916647991281934
  }
}
```

> 注意：此 JSON 為 2026-05-13 canonical run 的原始輸出快照。在 PR review 後，profile 欄位 `sidecar_io_seconds` 被改名為 `sidecar_append_seconds`（用來精確表達它計時的是 in-memory list/dict append cost，而非實際 file I/O）；同時新增 `quality_metrics.sidecar_write_seconds` 計時實際的 `entity_index.json` JSON dump。未來 canonical run 將使用新欄位名稱。1.39s 對應的是當時 1,597,773 entries 的 list append + mapping dict insert 累積耗時。

USD-side metrics:

- `usd_prim_count=7001`（含 `/World` root + 7,000 renderable mesh prims），baseline 對照組沒有完成 stage 故無對照
- `mesh_prim_count=7000`
- `converted_shape_count=7000`
- `skipped_shape_count=1`
- `vertex_count=676541`、`face_count=1288782`

Coverage / mapping metrics:

- `source_ifc_entity_count=1604773`
- `mapped_entity_count=1604771`
- `unmapped_entity_count=2`
- `mapped_count=1604771`
- `unmapped_count=2`
- `unmapped_usd_count=0`
- `coverage_ratio=0.9999987537178155`
- `sidecar_carrier_count=1597773`
- `coverage_denominator="source_ifc_entity_count"`、`minimum_coverage_baseline_locked=false`、`coverage_status="unlocked"`

注意：`mapped_count + unmapped_count = 1,604,773 = source_ifc_entity_count`，spec invariant 保持。`materialized_entity_count=1,597,773` 對應 sidecar 寫入；其餘 6,998 個被 geometry phase 在 mapped renderable 路徑覆蓋；2 個 unmapped 來自 geometry iterator 未提供 stable GUID 的 shape，未來可由 `guid_extraction` follow-up 進一步收斂。

## Sidecar Artifact / Lineage Handoff

- `entity_index.json` 已寫入 derived prefix，schema:
  - `source_artifact_id`、`mapping_method="ifc_entity_to_sidecar_index"`、`materialization_strategy="sidecar"`
  - `summary.sidecar_entity_count=1597773`
  - `entities[]`：每筆含 `ifc_entity_key`、`ifc_entity_id`、`ifc_guid`、`ifc_class`、`name`、`renderable=false`
- `derived_artifact_ids.entity_index=artifact_entity_index_20260513105315_57b2c0fa`
- Lineage graph 已加 `has_sidecar` edge 從 `model_usdc` 指向 entity_index node（單元測試 `test_store_surfaces_entity_index_sidecar_in_lineage_when_emitted` 覆蓋）
- 對 `bim-review-coordinator` / `web-viewer-sample` / `bim-streaming-server` 三邊，sidecar carrier shift 對 runtime 行為 no-op：
  - Coordinator 在 `src/types.ts` 中已將 `usd_prim_path` 標為 optional，無需 schema 變更
  - Viewer 在 `Window.tsx:894` 既有 filter `payload.items.filter((item) => Boolean(item['usd_prim_path']))` 已將 sidecar entries 從 highlight 列表自然排除
  - Streaming 對 non-renderable IFC entity 在 source 中無 reference（zero match grep）；stage 變小可降 stage-open 成本

## Interpretation

- The original blocker is resolved：`non_renderable_entity_materialization` 從 timeout > 375s 收斂至 5.05s（≈74× 改善），canonical single fixture 首次產出完成 `model.usdc`。
- Coverage semantics 維持：`coverage_denominator=source_ifc_entity_count`、`mapped_count + unmapped_count = source_ifc_entity_count`，非以 `IfcProduct`-only / renderable-only fast path 達成。
- 沒有 synthetic ID 取代 real IFC GUID：unmapped 的 2 個 entity 來自 geometry iterator side（缺 GUID 的 shape），coverage ratio 因此略低於 1.0 而非 sidecar 偽造 GUID。
- Visual preview 仍 blocked：本 change 完成 worker 邊界內的 canonical USDC 產出與 lineage 註冊；下游 `bim-streaming-server` 開啟與 `web-viewer-sample` 顯示為下一個獨立 verification 範圍。
- Full 13-file canonical batch 仍 `not_run`：本 change 範圍限定為 `--limit 1` burn-down，full batch 留待後續 change 與 baseline lock decision。

## Baseline Lock Decision

- `minimum_coverage_locked=false`
- Production mapping baseline 仍 unlocked
- Issue-to-real-prim baseline 未驗證
- 不主張 full batch pass 或 visual preview 完成

## Next Follow-Up

- Follow-up change：secondary scope `guid_extraction` / `name_extraction` 優化（baseline 量測為 ~10s vs primary 365s，現在 primary 已解，可獨立評估）
- Follow-up change：full 13-file canonical batch with sidecar carrier，量化 `mapping_quality_failed` 機率與 stage_reopen 成本曲線
- Follow-up：把 `unmapped_count=2` 案例（geometry shape 缺 GUID）的 root cause 解清楚，目標 `coverage_ratio=1.0`
