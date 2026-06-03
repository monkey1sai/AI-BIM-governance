# model-version-diff-authority — Spec Delta (governance-adversarial-followups-2)

> A2 diff Tag 級對齊唯一性護欄：同型別有多個相同 Tag 的構件時不得以 Tag 配對，杜絕幻影 moved + 假 removed/added（F3）。保留 a2-diff-tag-typeguard 既有「多級退階維持型別一致性」（is_a 涵蓋、跨型別共用 Tag → removed+added）。

## MODIFIED Requirements

### Requirement: 落地端 SHALL 以 IFC GlobalId 多級對齊兩個 model version 並分類變更

`governance-service` SHALL 接受兩份 IFC（base / target），以多級鍵對齊其 `IfcElement`，並分類 added / removed / moved / property_changed。對齊 SHALL 以 IFC GlobalId 為主，並在未命中時依序退到 Tag 與 type+name+location 鍵。

多級退階對齊 SHALL 維持型別一致性：每一級的對齊鍵 SHALL 涵蓋構件型別（`is_a()`），使同一 Tag 被不同 `ifc_type` 構件共用時 SHALL NOT 誤配；恰好共用 Tag 的跨型別構件（如被刪的牆與新增的門）SHALL 分類為 removed + added，SHALL NOT 被誤判為同一構件而靜默吞掉變更。

Tag 級對齊另 SHALL 維持唯一性：實作 SHALL 先統計每個 `(ifc_type, Tag)` 複合鍵在 base 與 target 各側的出現次數，僅當「base 與 target 該複合鍵各恰 1 個」時才以 Tag 配對該兩構件；任一側該複合鍵出現超過 1 個（歧義）時 SHALL NOT 以 Tag 配對，SHALL 落到 type+name+location 鍵或 removed/added。亦即同型別存在多個相同 Tag 的構件時 SHALL NOT 因壓平只留第一個而產生幻影 moved 或假 removed/added，且結果 SHALL NOT 依賴 `by_type` 等不穩定迭代序。比對 SHALL 為 CPU-only，SHALL NOT 需要 GPU / Kit。

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

- **WHEN** 兩構件 GlobalId 不同但 Tag 相同且 `ifc_type` 相同（且各側該 `(ifc_type, Tag)` 僅 1 個）
- **THEN** `governance-service` SHALL 以 Tag 對齊該兩構件（match 標記為 `tag`）
- **AND** 後續 moved / property_changed 證據 SHALL 以該 Tag 配對歸屬

#### Scenario: 跨型別共用 Tag 不得誤配

- **WHEN** base 有一構件、target 有另一構件，兩者 Tag 相同但 `ifc_type` 不同（例如被刪的 IfcWall 與新增的 IfcDoor 恰好共用 Tag）
- **THEN** `governance-service` SHALL NOT 以 Tag 把兩者配成同一構件
- **AND** base 端構件 SHALL 分類為 removed、target 端構件 SHALL 分類為 added
- **AND** SHALL NOT 因誤配而靜默吞掉該變更

#### Scenario: 同型別多個相同 Tag 不得幻影配對

- **WHEN** base 與 target 各有 2 個（含以上）同 `ifc_type` 且 Tag 相同的構件（GlobalId 皆不命中，逼到 Tag 級），且這些構件實際上各自對應、未移動
- **THEN** `governance-service` SHALL NOT 以 Tag 把它們交叉配對
- **AND** SHALL 落到 type+name+location 鍵正確各自配對（或在無法配對時分類為 removed/added）
- **AND** SHALL NOT 產生幻影 moved 或因壓平而捏造的 removed/added
- **AND** 相同輸入重複執行 SHALL 得到相同結果，SHALL NOT 隨插入/迭代序漂移

#### Scenario: type+name+loc 退階對齊維持型別一致性

- **WHEN** 兩構件 GlobalId 與 Tag 都不同，但 `ifc_type` + Name + 取整 placement 位置相同
- **THEN** `governance-service` SHALL 以 type+name+loc 鍵對齊該兩構件（match 標記為 `type_name_loc`）
