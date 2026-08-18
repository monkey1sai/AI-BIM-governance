# unified-governance-console（delta）

## MODIFIED Requirements

### Requirement: 點 3D 構件 ↔ IFC GUID 雙向 + 治理失敗構件 SHALL 經 client highlightPrimsRequest 在 3D 標示

統一治理控制台 SHALL 提供 3D 構件與 IFC GUID 的雙向打通（MappingCache 快取 `element_mapping` 的 `ifc_guid ↔ usd_prim_path`）：點 3D 構件 SHALL 經 `element_mapping` 反查得 IFC GUID 並帶進治理；治理失敗構件 SHALL 經其 `usd_prim_path` 由 HighlightBridge 組成 `highlightPrimsRequest`、透過 viewer 既有 WebRTC DataChannel（client 主動拉）在 3D 標示。3D 著色 SHALL 走 client `highlightPrimsRequest`，SHALL NOT 復活 2026-05-21 退役的 server-push highlight。未對映（`usd_prim_path=null`）的失敗構件 SHALL 誠實顯示「無法在 3D 標示」並顯示 coverage%，SHALL NOT 以捏造的 prim path 取代以假裝可標示。3D 端的視覺呈現方式 SHALL 誠實描述為現行 Kit handler 實際採用的 **USD selection 高亮**（回傳 `applied_mode: "selection"`）；client 雖仍依 severity 於協定 payload 帶 `color`，該欄位 SHALL NOT 被描述為已在 3D 生效的著色。

#### Scenario: 治理失敗構件經 client highlightPrimsRequest 在 3D 以 USD selection 標示

- **WHEN** 操作員在 A1–A10 overlay 對一個帶有效 `usd_prim_path` 的治理失敗構件按「在 3D 標示」
- **THEN** HighlightBridge SHALL 以該 `usd_prim_path` 組成 `highlightPrimsRequest`
- **AND** SHALL 經 primary viewer 既有的 WebRTC DataChannel（`web-viewer-sample/src/Window.tsx` React 元件的 private method `_sendStreamMessage`，client 主動拉，非 browser global `Window`）送至 Kit runtime
- **AND** Kit runtime SHALL 以 USD selection 呈現該構件（`clear_selected_prim_paths()` ＋ `set_selected_prim_paths(...)`）並回傳 `applied_mode: "selection"`
- **AND** client 依 severity 寫入 payload 的 `color` 欄位 SHALL 被視為協定攜帶值而非已生效的 3D 著色；spec SHALL NOT 宣稱該構件在 3D 中被標為紅色
- **AND** SHALL NOT 透過已退役的 server-push highlight 機制標示

#### Scenario: 點 3D 構件反查 IFC GUID 帶進治理

- **WHEN** 操作員在 primary viewer 的 3D 中點選一個構件
- **THEN** MappingCache SHALL 以該構件的 `usd_prim_path` 經 `element_mapping` 反查得對應 `ifc_guid`
- **AND** SHALL 將該 `ifc_guid` 帶進 A1–A10 治理（作為治理操作的目標構件）

#### Scenario: 未對映的失敗構件誠實標示無法 3D 標示，不捏造 prim path

- **WHEN** 一個治理失敗構件的 `usd_prim_path` 為 `null`（未對映）
- **THEN** overlay SHALL 誠實顯示「無法在 3D 標示」並顯示當前 coverage%
- **AND** SHALL NOT 以任意或捏造的 prim path 觸發 `highlightPrimsRequest` 假裝可標示
