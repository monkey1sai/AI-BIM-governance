## MODIFIED Requirements

### Requirement: 落地端 SHALL 以 IFC GlobalId 多級對齊兩個 model version 並分類變更

`governance-service` SHALL 接受兩份 IFC（base / target），以多級鍵對齊其 `IfcElement`，並分類 added / removed / moved / property_changed。對齊 SHALL 以 IFC GlobalId 為主，並在未命中時依序退到 Tag 與 type+name+location 鍵。多級退階對齊 SHALL 維持型別一致性：每一級的對齊鍵 SHALL 涵蓋構件型別（`is_a()`），使同一 Tag 被不同 `ifc_type` 構件共用時 SHALL NOT 誤配；恰好共用 Tag 的跨型別構件（如被刪的牆與新增的門）SHALL 分類為 removed + added，SHALL NOT 被誤判為同一構件而靜默吞掉變更。比對 SHALL 為 CPU-only，SHALL NOT 需要 GPU / Kit。

#### Scenario: GlobalId 對齊並分類變更

- **WHEN** 提交一個 diff，指向兩份可讀的 IFC（base 與 target）
- **THEN** `governance-service` SHALL 以 GlobalId 對齊兩份模型的 IfcElement
- **AND** 未配對者 SHALL 分類為 added（僅 target）或 removed（僅 base）
- **AND** 已配對者 placement 平移超過容差時 SHALL 標 moved
- **AND** 已配對者 property_sets hash 改變時 SHALL 標 property_changed
- **AND** 每筆變更 SHALL 帶真實 `ifc_guid` 與 `ifc_type`

#### Scenario: GlobalId 未命中時退到後備鍵

- **WHEN** 某構件在 base / target 的 GlobalId 不一致（例如 Revit re-export 換 GUID）
- **THEN** `governance-service` SHALL 嘗試以 Tag（source element id）對齊
- **AND** 仍未命中時 SHALL 嘗試 type + Name + 取整 placement 位置鍵
- **AND** property hash SHALL 與幾何/位置獨立，避免 hash 衝突誤判

#### Scenario: Tag 退階對齊維持型別一致性

- **WHEN** 兩構件 GlobalId 不同但 Tag 相同且 `ifc_type` 相同
- **THEN** `governance-service` SHALL 以 Tag 對齊該兩構件（match 標記為 `tag`）
- **AND** 後續 moved / property_changed 證據 SHALL 以該 Tag 配對歸屬

#### Scenario: 跨型別共用 Tag 不得誤配

- **WHEN** base 有一構件、target 有另一構件，兩者 Tag 相同但 `ifc_type` 不同（例如被刪的 IfcWall 與新增的 IfcDoor 恰好共用 Tag）
- **THEN** `governance-service` SHALL NOT 以 Tag 把兩者配成同一構件
- **AND** base 端構件 SHALL 分類為 removed、target 端構件 SHALL 分類為 added
- **AND** SHALL NOT 因誤配而靜默吞掉該變更

#### Scenario: type+name+loc 退階對齊維持型別一致性

- **WHEN** 兩構件 GlobalId 與 Tag 都不同，但 `ifc_type` + Name + 取整 placement 位置相同
- **THEN** `governance-service` SHALL 以 type+name+loc 鍵對齊該兩構件（match 標記為 `type_name_loc`）

## ADDED Requirements

### Requirement: 同鍵簇配對 SHALL 穩定可重現

當第三級 type+name+loc 對齊鍵命中多個同鍵構件時，`governance-service` 在 base 與 target 同鍵簇內配對 SHALL 為穩定可重現：配對前 SHALL 以穩定次鍵（如 GlobalId）排序兩側構件再對齊，SHALL NOT 依賴 `by_type` 迭代序等不穩定順序。相同輸入重複執行 SHALL 產生相同的配對與 property_changed 證據歸屬。

#### Scenario: 同鍵多構件配對穩定

- **WHEN** base 與 target 各有多個構件落在相同的 type+name+loc 對齊鍵簇
- **THEN** `governance-service` SHALL 以穩定次鍵（如 GlobalId）排序兩側後再 zip 配對
- **AND** 相同輸入重複執行 SHALL 得到相同的配對結果與相同的 property_changed 計數
- **AND** property_changed 等變更證據的歸屬 SHALL 可重現，SHALL NOT 隨迭代序漂移
