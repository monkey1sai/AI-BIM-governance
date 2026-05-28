# streaming-ifc-usdc-conversion-authority — Spec Delta (streaming-server-ifcopenshell-semantic-sidecar-pass)

> Delta against `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`。
> 接續 `streaming-server-enumeration-semantic-mapping`(2026-05-26 archived)。
> HOOPS A3D 不寫 IFC CustomData 進 USD prim,enumeration 抽不到 → viewer
> Semantic ready 仍 `no`。本 delta 新增 HOOPS happy path 後序列追加 IfcOpenShell
> semantic sidecar pass,讓 enumeration 在 prim CustomData 缺資料時讀 sidecar
> supplement,並推導 quality_metrics 三 semantic 欄位,使 viewer Semantic ready
> 真實算為 `yes`。

## ADDED Requirements

### Requirement: HOOPS happy path SHALL be augmented by an IfcOpenShell semantic sidecar pass

`bim-streaming-server` SHALL 在 HOOPS happy-path conversion 發布可渲染
`model.usdc` 之後,於 converter-emitted sidecars 或 USD-enumerated sidecars
尚未帶 IFC 語意資料時,執行一輪 IfcOpenShell-based 的 semantic sidecar
pass。本 pass MUST 把 host-local 的 `ifc_semantic_sidecar.json` 寫在與
`model.usdc` 同一個 artifact dir、MUST NOT 因自身失敗而擋住已 ready 的
HOOPS 結果、且 MUST 只在 prim CustomData 不帶 IFC keys 時被
`_enumerate_usd_stage` 當 supplement 來源消費。Sidecar entries SHALL 僅源自
對原始 IFC source 的真實 IfcOpenShell 解析(non-fabricating);
`element_mapping.json` items SHALL 僅由 prim CustomData 或 sidecar entries
推導,不得使用名稱啟發、mesh 名稱、material 等替代來源。

#### Scenario: HOOPS success without IFC CustomData triggers sidecar pass

- **WHEN** host-native conversion service 完成 HOOPS happy-path conversion
  並發布可渲染的 `model.usdc`
- **AND** `_adopt_converter_sidecars` 回傳的 sidecars 內
  `mapping_has_ifc_type` / `mapping_has_ifc_name` 皆非 truthy
- **AND** 原始 IFC source 仍可在 host 端讀取
- **THEN** `bim-streaming-server` SHALL 對該 IFC source 呼叫
  `_run_ifcopenshell_semantic_sidecar`
- **AND** SHALL 把 `ifc_semantic_sidecar.json` 寫進 conversion 的 artifact
  目錄,與 `model.usdc` 同層
- **AND** sidecar 內容 SHALL 包含 `format_version`、`ifc_source`、`entries[]`
  (每筆含 `ifc_guid`、`ifc_type`、`ifc_name`、`shape_index`)以及 `summary`
  (含 `count`、`has_type`、`has_name`)

#### Scenario: Sidecar pass filters IfcProduct without renderable Representation

- **WHEN** `_run_ifcopenshell_semantic_sidecar` iterate `IfcProduct`
- **AND** 該 product 沒有 `Representation`(例如 `IfcSite` / `IfcBuilding`
  / `IfcBuildingStorey` / `IfcSpace` 等空間 / 容器 product)
- **THEN** 該 product SHALL 被略過、不寫進 `entries[]`,避免 mesh-prim 順序
  與 sidecar entries 順序的 ordinal join 整體錯位
- **AND** `entries[]` 內 `shape_index` SHALL 從 0 連續編號,不留被略過的
  spatial product 造成的空隙

#### Scenario: Enumeration reads sidecar when prim CustomData is empty

- **WHEN** `_enumerate_usd_stage` traverse HOOPS 產出的 USD stage
- **AND** 沒有任何 prim 帶 `ifc:guid` / `ifcGlobalId` / `ifc_guid` CustomData
- **AND** artifact 目錄存在 `ifc_semantic_sidecar.json` 且 `entries[]` 非空
- **THEN** `_enumerate_usd_stage` SHALL 載入 sidecar,並以 USD mesh prim 順序
  vs sidecar entries 順序 best-effort ordinal 對齊補 `mapping_items[]`
- **AND** 每筆 supplemented mapping item SHALL 含五個 keys `ifc_guid`、
  `usd_prim_path`、`ifc_type`、`ifc_name`、`entity_id`
- **AND** `entity_index.json` entries SHALL 透過共用的 `entity_id` 與
  mapping items 對齊
- **AND** `quality_metrics.json` SHALL 含
  `semantic_mapping_fidelity = "usd_enumeration_with_ifc_sidecar_supplement"`、
  `mapping_has_ifc_type`(由 `any(item.ifc_type)` 推導)、
  `mapping_has_ifc_name`(由 `any(item.ifc_name)` 推導)
- **AND** `web-viewer-sample` `computeSemanticReady` SHALL 對此 conversion
  的 stream-config 計算 Semantic ready 為 `"yes"`(對齊
  `session-first-review-viewer`)

#### Scenario: Enumeration prefers prim CustomData over sidecar

- **WHEN** `_enumerate_usd_stage` traverse USD stage
- **AND** 至少一個 prim 帶有效的 IFC CustomData(`ifc:guid` / `ifcGlobalId`
  / `ifc_guid` 加可選 `ifcType` / `ifcName`)
- **AND** artifact 目錄同時存在 `ifc_semantic_sidecar.json`
- **THEN** `mapping_items[]` SHALL 由 prim CustomData 推導(維持
  `streaming-server-enumeration-semantic-mapping` archive 行為)
- **AND** `semantic_mapping_fidelity` SHALL 依 C6 archive 規則維持
  `"ifc_class_grouped_with_name"` 或 `"usd_enumeration_with_ifc_custom_data"`
- **AND** sidecar SHALL NOT shadow 或覆蓋 CustomData-derived 的 mapping items

#### Scenario: Missing IFC source or IfcOpenShell unavailable stays honest

- **WHEN** HOOPS 發布的 artifact 目錄含 ready 的 `model.usdc`,但原始 IFC
  source 已被 retention policy 移除
- **OR** host Python 環境不能 import `ifcopenshell`
- **OR** `ifcopenshell.open()` 對 IFC source 抛例外
- **OR** `ifcopenshell.open()` 成功但 `.by_type("IfcProduct")` 抛例外
- **THEN** `_run_ifcopenshell_semantic_sidecar` SHALL 回傳 `None` 且不抛例外
- **AND** SHALL NOT 寫 `ifc_semantic_sidecar.json`(避免留下看似成功但內容
  空的 artifact 誤導 downstream)
- **AND** HOOPS 已發布的 ready 結果 SHALL NOT 被撤回或重分類為 failed
- **AND** `_enumerate_usd_stage` SHALL fall back 到既有 CustomData / no-data
  路徑;`quality_metrics.json` SHALL 維持
  `semantic_mapping_fidelity = null`、`mapping_has_ifc_type = false`、
  `mapping_has_ifc_name = false`
- **AND** viewer Semantic ready SHALL 維持 `no`(誠實不偽宣告)

#### Scenario: Sidecar contents stay host-local and do not enter callback outbox

- **WHEN** coordinator 對含 `ifc_semantic_sidecar.json` 的 conversion job
  enqueue `conversion_ready` 或 `conversion_failed` callback
- **THEN** 送往外部公司雲端 control plane 的 callback payload MUST NOT 包含
  sidecar JSON 本體或任何 IfcOpenShell 推導出的 semantic 內容
- **AND** callback MAY 僅以 opaque diagnostic marker 引用 sidecar,對齊
  `conversion-webhook-lifecycle` metadata-only callback 規約

#### Scenario: Backward compatible mapping schema and additive quality metrics

- **WHEN** 既有 consumer(`bim-review-coordinator`、`web-viewer-sample`)
  讀取走過 sidecar supplement 路徑產出的 `element_mapping.json`、
  `entity_index.json` 或 `quality_metrics.json`
- **THEN** 只認 legacy `ifc_guid` / `usd_prim_path` mapping schema 的
  consumer SHALL 仍能無誤解析該文件
- **AND** 新 `semantic_mapping_fidelity` 值
  `"usd_enumeration_with_ifc_sidecar_supplement"` SHALL 為 additive;對先前
  值(`"ifc_class_grouped_with_name"` / `"usd_enumeration_with_ifc_custom_data"`)
  做 switch 的 consumer SHALL 把新值視為 unknown-but-valid fidelity,並依
  `mapping_has_ifc_type` / `mapping_has_ifc_name` 判定 semantic 是否存在
- **AND** 任何 `element_mapping.json`、`entity_index.json`、
  `quality_metrics.json` 既有 key SHALL NOT 被本 change 移除或重新命名

#### Scenario: Sidecar pass does not retro-fit previously archived conversions

- **WHEN** streaming server 在本 change 部署後啟動
- **AND** storage 內仍存在先前 conversion 產出的 `model.usdc` 但不含
  `ifc_semantic_sidecar.json`
- **THEN** streaming server SHALL NOT 在 startup 時自動對既有 artifact 目錄
  重跑 sidecar pass
- **AND** 只有新 dispatch 的 conversion job SHALL 觸發 sidecar pass
- **AND** 若 operator 需要回溯既有 artifact 的 sidecar 覆蓋,SHALL 透過既有
  coordinator dispatch 路徑手動觸發重 conversion
