## Why

`streaming-server-enumeration-semantic-mapping`(2026-05-26 archived,PR #117)
讓 `_enumerate_usd_stage` 與 `_adopt_converter_sidecars` 從 USD prim CustomData
抽 IFC `ifcType` / `ifcName` 並寫 `semantic_mapping_fidelity` /
`mapping_has_ifc_type` / `mapping_has_ifc_name`。實作正確。但
[`docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/c2-viewer-semantic-final-vendor-blocker.md`](../../../docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/c2-viewer-semantic-final-vendor-blocker.md)
forensics 證實 vendor-side blocker:**HOOPS A3D library 把 IFC 視為 generic 3D
來源,model.usdc 10,872 prim 完全沒 `ifc:*` / `ifcGlobalId` / `ifcType` /
`ifcName` CustomData**,所以 enumeration 抽不到、quality_metrics 三 semantic
欄位仍寫 `null` / `false`,viewer 的 Semantic ready 仍是 `no`。

既有 `_run_ifcopenshell_openusd_fallback`(只在 HOOPS import failure 才走)已
證明 IfcOpenShell 能解析使用者 341MB IFC 並取得 IFC GUID / Type / Name
(2026-05-22 `fix-ifc-usdc-hoops-load-failure` evidence:`source_ifc_entity_count
=4889`,`mapped_count=4889`,fallback 寫 `ifc_class_grouped_with_name` fidelity)。
本 change 把這條 IfcOpenShell 解析能力,從 HOOPS-failure-only fallback,推到
HOOPS-success happy path 的 **semantic sidecar pass**:HOOPS 成功 ready 後序列
追加一次 IfcOpenShell 解析,只寫 `ifc_semantic_sidecar.json`(IFC GUID dict + shape
index),`_enumerate_usd_stage` 在 prim CustomData 抽不到時讀 sidecar 補
mapping_items + quality_metrics,讓 fast MVP 主鏈的最後一個 tier(Semantic ready)
真能算成 yes。

對齊 [`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`](../../../docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md)
§10 第 9 點「持續用 `kit-mcp` / `usd-code-mcp` 做 NVIDIA extension drift check」:
本 change 用 IfcOpenShell + `pxr.Usd` / `pxr.UsdGeom` API(usd-code-mcp 知識涵蓋
範圍)實作,不引入新 production dependency。

## What Changes

- 新增 `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`:
  - 新 helper `_run_ifcopenshell_semantic_sidecar(ifc_source_path, artifact_dir) -> Optional[Path]`:
    開 IFC、iterate `IfcProduct` 抽 GUID / Type / Name + 序號,寫
    `ifc_semantic_sidecar.json`(schema 見 design D2);解析失敗或 IFC source
    不存在 → 回傳 `None` + log warning,不抛例外。
  - 修改 `_materialize_sidecars` main happy path:HOOPS success 走
    `_enumerate_usd_stage` 之前,序列呼叫 `_run_ifcopenshell_semantic_sidecar`;
    sidecar 落地於 artifact dir,與 `model.usdc` co-located。
  - 修改 `_enumerate_usd_stage`:在 prim CustomData 抽不到 IFC keys 時,以
    enumeration order index 對齊 sidecar entries(best-effort)補
    `ifc_guid` / `ifc_type` / `ifc_name` / `entity_id` 進 mapping_items 與
    entity_index;CustomData 有 IFC keys 時仍以 CustomData 為主要來源(維持
    既有 archive `streaming-server-enumeration-semantic-mapping` 行為),sidecar
    僅作 supplement。
  - `_enumerate_usd_stage` `quality_metrics` 推導:當 mapping items 來源為 sidecar
    supplement 時,`semantic_mapping_fidelity` 設為新 value
    `"usd_enumeration_with_ifc_sidecar_supplement"`(viewer
    `computeSemanticReady` 只看 `mapping_has_ifc_type` + `mapping_has_ifc_name`,
    不依 fidelity 名稱判斷,所以新 value 不破壞 viewer 行為)。
  - host-native conversion service flow:HOOPS success → sidecar pass(序列)→
    enumeration → publish ready(失敗或 sidecar absent 走原既有 no-IFC-data 路徑)。

- 不改 `_run_ifcopenshell_openusd_fallback`(C1 archive 已正確處理 fallback path,
  自己寫 mapping/quality,不讀 sidecar)。
- 不改 HOOPS A3D primary converter binary(vendor-side)。
- 不改 coordinator / viewer / callback outbox / DataChannel command;不改 USD
  prim 路徑或 hierarchy(會破 viewer highlight 對齊)。
- 不引入新 production dependency:IfcOpenShell 已存在於 fallback path 既有
  external prerequisites,本 change 只是把它的使用面從 fallback 推到 happy path
  pass。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `streaming-ifc-usdc-conversion-authority`:
  - ADD requirement「HOOPS happy path SHALL be augmented by an IfcOpenShell
    semantic sidecar pass」,覆蓋 sidecar JSON schema、enumeration 讀 sidecar
    補 mapping 與 quality_metrics、IfcOpenShell 失敗 / 無 IFC source 的 honest
    non-fabrication 行為、callback outbox 仍 metadata-only、不蓋既有 prim
    CustomData IFC keys 的優先序。

## Impact

- Owner repo / folder:
  - `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py`
  - `bim-streaming-server/tests/test_host_native_conversion_service.py`
  - `openspec/changes/streaming-server-ifcopenshell-semantic-sidecar-pass/`
- Runtime boundary:不改 streaming-server / coordinator / viewer / callback
  outbox 邊界;純 conversion adapter 內部 enrichment。Host-native conversion
  service `127.0.0.1:49101` API 不變;新 sidecar 僅 host-local diagnostic +
  enumeration 內部 supplement。
- API:`GET /api/conversions/<id>/result` 回應 `quality_metrics` 可能新增
  `semantic_mapping_fidelity = "usd_enumeration_with_ifc_sidecar_supplement"`
  新 value(additive);既有 consumer 不受影響。
- Data:artifact dir 新增 `ifc_semantic_sidecar.json`;`element_mapping.json`
  items 與 `entity_index.json` entries 在 HOOPS happy path 也會帶 `ifc_type` /
  `ifc_name` / `entity_id`(additive,backward compat 保留)。
- Dependencies:無新增 production dep。IfcOpenShell 已是 fallback path
  external prerequisite。
- Performance:對 89MB / 4889-entity 級 IFC,IfcOpenShell open + iterate
  IfcProduct ≈ 30-40s(對齊 2026-05-13 `optimize-worker-source-entity-enumeration`
  經驗值 ~33s for 1.6M entities)。序列實作會把 conversion ready latency 從
  HOOPS-only 加上 sidecar 時間,但落在當前 fast MVP demo 可接受範圍;async /
  background 寫 sidecar 為 follow-up 探索,不在本 change scope。
- Non-goals:
  - 不改 HOOPS A3D primary converter library(vendor-side)。
  - 不改 `_run_ifcopenshell_openusd_fallback`(C1 已正確,且本 change 不走
    fallback path)。
  - 不改 USD prim 路徑命名或 hierarchy(會破 viewer DataChannel highlight)。
  - 不引入新 production dependency。
  - 不 retro-fit 已 archive 過的 successful conversion 重跑(只對新 conversion
    生效)。
  - 不把 sidecar 內容寫進 callback outbox(維持 `conversion-webhook-lifecycle`
    metadata-only 規約)。
  - 不在本 change 處理「精準 GUID-level join sidecar entry ↔ HOOPS USD prim」
    深層對齊問題;本 change 走 enumeration order index best-effort
    supplement,精準 join 為 Sidecar Pass v2 follow-up(open question Q1)。
  - 不引入 async / background 寫 sidecar 流程;本 change 走序列實作。
