# C2 Viewer Semantic=yes — Final Vendor-Side Blocker(2026-05-26)

> 接續 PR #117 (`streaming-server-enumeration-semantic-mapping`) archive。
> 實作正確 + 跑通閉環,但 vendor-side limitation 阻擋 Semantic=yes。

## 結論

**Semantic ready=yes 在當前 HOOPS happy path 上 vendor-side 不可達**。要達成,
必須新加一條 **IfcOpenShell semantic sidecar pass**(HOOPS 成功後並行寫 IFC
GUID/Type/Name 進 USD CustomData 或 sidecar JSON)。屬 follow-up OpenSpec
change。

## Forensics

### A. Stack 行為已對齊(C1 + C5 + C6 implementation 全綠)

- C1 `streaming-server-fallback-semantic-mapping`:fallback path 寫 semantic ✓
- C5 `coordinator-forward-quality-metrics-summary`:coordinator forward summary ✓
- C6 `streaming-server-enumeration-semantic-mapping`(本輪 archived):enumeration
  / adopt path 寫 semantic + supplement ✓

`GET /api/review-sessions/review_session_fb76771dce5a/stream-config` 回應:

```json
{
  "source_ifc_entity_count": 10872,
  "materialization_strategy": "usd_stage_enumeration",
  "coverage_status": "warn",
  "semantic_mapping_fidelity": null,
  "mapping_has_ifc_type": false,
  "mapping_has_ifc_name": false
}
```

PR #117 前:三 semantic 欄位 `undefined`(missing key)。
PR #117 後:**顯式寫 `null` / `false`**(schema stable),但仍是 falsy。

### B. 根因:HOOPS 產出的 USD 沒 IFC metadata

直接 dump `model.usdc`(10,872 prims):

```text
total prims: 10872
first 5 prim paths:
  /model        type=Xform
  /model/Looks  type=Scope
  /model/Looks/Diffuse           type=Material
  /model/Looks/Diffuse/PreviewSurface  type=Shader
  /model/Looks/Diffuse_1         type=Material
```

每個 prim 的 CustomData 與 attribute:

```text
all 10,872 prims:
  CustomData keys = ['userDocBrief']   ← HOOPS 自家 metadata,非 IFC
  attributes containing "ifc" = []
```

**沒有任何 prim 帶 `ifcGlobalId` / `ifcType` / `ifcName` 或等價 key**。

HOOPS A3D library 把 IFC 視為 generic 3D / CAD 來源,只保留 mesh geometry +
material structure,**不保留 IFC GUID / Type / Name 語意 metadata**。這是
commercial library 設計選擇,本 repo 無 source / license 改。

### C. 為什麼 C1 fallback 上 Semantic=yes 可達?

C1 走 `_run_ifcopenshell_openusd_fallback`:**用 IfcOpenShell 直接讀 IFC source
file**,從 IfcShape 取得 GUID / type / name,**自己寫進 USD prim CustomData**
+ `element_mapping.json`。所以走 fallback 時 prim CustomData 完整,enumeration
不必再去抽(因為 mapping 已先寫好)。

HOOPS happy path 跳過 fallback,直接用 HOOPS 產 USD → CustomData 從未被寫 →
enumeration path 抽不到 → mapping_items 空 → Semantic ready 留 no。

### D. 三條走通 Semantic=yes 的路線

| Option | 動作 | 風險 |
|---|---|---|
| **X. IfcOpenShell semantic sidecar pass**(推薦) | HOOPS 成功後**並行**跑一輪 IfcOpenShell 把 IFC GUID/Type/Name 寫進 USD prim CustomData 或 sidecar JSON,然後 `_enumerate_usd_stage` 從這條 metadata pass 抽 | 對齊 join logic:IfcOpenShell 的 IfcShape 與 HOOPS 產出的 USD prim 沒共同 join key(HOOPS 沒寫 GUID),要靠 shape index / mesh count 對齊,可能 fragile |
| **Y. 強制走 IfcOpenShell + OpenUSD fallback**(skip HOOPS) | 把 HOOPS path 標 fail / disable,強制走 C1 fallback | 犧牲 HOOPS material / texture / view representation(IfcOpenShell + OpenUSD 是 geometry-only) |
| **Z. 接受 HOOPS happy path Semantic=no**(現狀) | 文件記載限制;Semantic ready 在 fallback 上才會 yes | spec scenarios 已誠實標 "stay honest"(non-fabricating),符合 |

## Recommended follow-up

**新 OpenSpec change**:`streaming-server-ifcopenshell-semantic-sidecar-pass`

Scope:
- HOOPS conversion 成功後,並行跑 IfcOpenShell 解析 IFC source,產出
  `ifc_semantic_sidecar.json`(IFC GUID → ifc_type / ifc_name dict)
- 寫進 `_cache/host-native-conversion/artifacts/<conversion_id>/`
- `_enumerate_usd_stage` 或 `_materialize_sidecars` 讀此 sidecar,join 進
  `element_mapping.json` items(用 IfcShape iterator 順序對齊 USD prim 順序
  作為 best-effort,或用 prim path → GUID 推斷 dictionary)
- 對齊 C1 fallback 的 semantic schema

Capability MODIFIED:`streaming-ifc-usdc-conversion-authority`。

Non-goals:
- 不改 HOOPS A3D library(vendor-side,不可控)
- 不犧牲 HOOPS material / texture / view representation
- 不引入新 production dep(IfcOpenShell + pxr 已用於 C1 fallback)

## 對 fast MVP 的影響

**現狀已可用**:File ready=yes / Runtime ready=yes / WebRTC started + Stage
matched(實際 3D model 可在 viewer 觀看)。Semantic ready=no 只是「IFC 元件
語意對照」這層的限制,**不阻擋核心 demo 觀看流程**。

對需要「點選 USD prim 反查 IFC element」的後續功能(highlight / focus
verification),就必須走 follow-up sidecar pass change。當前 archive 收尾合理。

## Closing

PR / archive 歷史:

| Phase | PR | Change | 結果 |
|---|---|---|---|
| C1 | #106 | streaming-server-fallback-semantic-mapping | fallback 寫 semantic ✓ |
| C2 | #108 | viewer-edge-bim-server-console | viewer 顯示三段 ready ✓ |
| C3 | #109 | coordinator-ui-tri-ready-and-queue | `/ui` 三段 ready + queue ✓ |
| C4 | #107 | coordinator-serial-conversion-dispatch-queue | dispatch queue ✓ |
| C5 | #115 | coordinator-forward-quality-metrics-summary | summary forward ✓ |
| C6 | #117 | streaming-server-enumeration-semantic-mapping | enumeration 寫 semantic,但 HOOPS 無資料 ✓(spec OK,vendor-side blocker) |

**Semantic ready=yes 全閉環 vendor-blocked**;follow-up Option X 屬下一輪。
