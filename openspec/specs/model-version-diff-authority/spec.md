# model-version-diff-authority Specification

## Purpose
TBD - created by archiving change model-version-diff-globalid. Update Purpose after archive.
## Requirements
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

### Requirement: diff 結果 SHALL 誠實且計數一致

diff 結果 SHALL 計數一致（matched + removed = base_count；matched + added = target_count），SHALL NOT 捏造變更。未做的能力 SHALL 誠實標示。

#### Scenario: 計數一致且不捏造

- **WHEN** 一個 diff 成功完成
- **THEN** matched + removed SHALL 等於 base 的 IfcElement 數
- **AND** matched + added SHALL 等於 target 的 IfcElement 數
- **AND** 兩份模型相同時 SHALL 回報 0 added / 0 removed / 0 moved

#### Scenario: 未做能力誠實標示

- **WHEN** 查詢 diff 結果或 3D overlay
- **THEN** geometry_changed SHALL 標為未做（p1；MVP 不做幾何 tessellation）於 warnings
- **AND** `POST /api/diffs/{id}/apply-overlay` SHALL 回 501（3D overlay 走 client highlightPrimsRequest，非 server-push）
- **AND** 未對映的 `usd_prim_path` SHALL 為 null，不捏造

### Requirement: diff SHALL 經 coordinator proxy 且不阻塞串流

瀏覽器 SHALL 只經 `bim-review-coordinator`（:8004）的 `/api/governance/diffs*` 觸發/讀取 diff，SHALL NOT 直連 `governance-service`（:49102）。重 CPU diff SHALL 在 governance-service 獨立 process 非同步執行。

#### Scenario: 經 proxy 非同步執行

- **WHEN** 瀏覽器觸發版本 diff
- **THEN** 它 SHALL 呼叫 coordinator `/api/governance/diffs`
- **AND** SHALL NOT 直連 `127.0.0.1:49102`
- **AND** diff SHALL 以背景工作執行並可輪詢狀態（queued → running → succeeded/failed）

### Requirement: diff SHALL 支援可選的 geometry_changed 偵測

`governance-service` 的 diff SHALL 支援以幾何比對偵測 `geometry_changed`。因 tessellation 較重，此 SHALL 為 opt-in（預設關閉）；啟用時 SHALL 用 ifcopenshell 幾何 signature（bbox / vertex count / volume）比對已配對構件，SHALL 對無幾何 representation 的構件安全略過（不誤判）。

#### Scenario: opt-in 啟用 geometry_changed

- **WHEN** diff 以 `include_geometry=true` 執行
- **THEN** 已配對且幾何 signature 不同的構件 SHALL 標 `geometry_changed`
- **AND** 無 representation 或無法 tessellate 的構件 SHALL 安全略過（geometry hash 為 null，不標變更）

#### Scenario: 預設不計算 geometry（誠實標示）

- **WHEN** diff 以 `include_geometry=false`（預設）執行
- **THEN** SHALL NOT 計算 geometry_changed
- **AND** SHALL 於 warnings 誠實標示 geometry 未計算（僅 placement/pset）

### Requirement: diff SHALL 提供與 Issue DB 交叉比對的 issue-impact

`governance-service` SHALL 能對一個 diff 計算 issue-impact：把本 diff 的變更構件（removed/moved/geometry_changed/property_changed）與 base model version 的 issue 以 `ifc_guid` 交叉比對，回報 `possibly_addressed` / `still_open` / `new`。`possibly_addressed` SHALL 明確標示為**啟發式**，SHALL NOT 自動把 issue 轉為 resolved。

#### Scenario: issue-impact 分類

- **WHEN** 對一個 base model version 有既有 issue 的 diff 計算 issue-impact
- **THEN** 其構件在本 diff 有變更的 issue SHALL 列為 `possibly_addressed`
- **AND** 其構件未變更的 issue SHALL 列為 `still_open`
- **AND** 有變更但無既有 issue 的構件 SHALL 計入 `new`
- **AND** 回應 SHALL 標明 `possibly_addressed` 為啟發式、需人工確認，SHALL NOT 自動轉 resolved

### Requirement: 同鍵簇配對 SHALL 穩定可重現

當第三級 type+name+loc 對齊鍵命中多個同鍵構件時，`governance-service` 在 base 與 target 同鍵簇內配對 SHALL 為穩定可重現：配對前 SHALL 以穩定次鍵（如 GlobalId）排序兩側構件再對齊，SHALL NOT 依賴 `by_type` 迭代序等不穩定順序。相同輸入重複執行 SHALL 產生相同的配對與 property_changed 證據歸屬。

#### Scenario: 同鍵多構件配對穩定

- **WHEN** base 與 target 各有多個構件落在相同的 type+name+loc 對齊鍵簇
- **THEN** `governance-service` SHALL 以穩定次鍵（如 GlobalId）排序兩側後再 zip 配對
- **AND** 相同輸入重複執行 SHALL 得到相同的配對結果與相同的 property_changed 計數
- **AND** property_changed 等變更證據的歸屬 SHALL 可重現，SHALL NOT 隨迭代序漂移
