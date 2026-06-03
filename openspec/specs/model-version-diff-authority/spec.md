# model-version-diff-authority Specification

## Purpose
TBD - created by archiving change model-version-diff-globalid. Update Purpose after archive.
## Requirements
### Requirement: 落地端 SHALL 以 IFC GlobalId 多級對齊兩個 model version 並分類變更

`governance-service` SHALL 接受兩份 IFC（base / target），以多級鍵對齊其 `IfcElement`，並分類 added / removed / moved / property_changed。對齊 SHALL 以 IFC GlobalId 為主，並在未命中時依序退到 Tag 與 type+name+location 鍵。比對 SHALL 為 CPU-only，SHALL NOT 需要 GPU / Kit。

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
