## MODIFIED Requirements

### Requirement: 落地端 SHALL 以 sublayer 疊合多個 discipline USD 成 federated stage 且不破壞 member

`governance-service` SHALL 接受一組 discipline member（各帶 usd_path / discipline / layer_order）並以 OpenUSD sublayer 疊合成單一具名 root layer（`federated_review.usda`）。member 的 USD 檔 SHALL NOT 被開啟寫入（immutable）。authoring SHALL 為 CPU（不需 GPU render）。federated stage SHALL 保留 member 的 metersPerUnit，SHALL NOT 靜默回退 pxr 預設 0.01；build SHALL NOT 硬編 upAxis，SHALL 採用驗證後一致的 member upAxis。

#### Scenario: sublayer 疊合並保持 member immutable

- **WHEN** 對一個含 ≥2 member 的 federation set 執行 build
- **THEN** `governance-service` SHALL 產出 root layer，其 subLayerPaths 依 layer_order 排序包含各 member 的 USD 路徑
- **AND** 每個 member 的 USD 檔 byte SHALL 維持不變（immutable）
- **AND** 開啟 federated stage SHALL 能看到各 member 疊合進來的 prim

#### Scenario: 可見度 override 非破壞性

- **WHEN** 某 member 標記 visibility_default = false
- **THEN** `governance-service` SHALL 在 root layer 上以 `over` 標其 root prim 為 invisible
- **AND** SHALL NOT 修改該 member 的 USD 檔
- **AND** 切換可見度 SHALL 只需重寫 root layer，不需重新轉檔 member

#### Scenario: federated stage 保留 member 的 metersPerUnit

- **WHEN** 各 member 的 metersPerUnit 一致為 0.001 且對該 federation set 執行 build
- **THEN** federated stage 的 metersPerUnit SHALL 為 0.001
- **AND** SHALL NOT 靜默回退 pxr 預設 0.01（避免整體尺度差 10 倍）
- **AND** build 結果 SHALL 回報採用的 meters_per_unit 供呼叫端稽核

### Requirement: build 前 SHALL 可驗證共享坐標系

`governance-service` SHALL 在 build 前比對各 member 的坐標系（upAxis / metersPerUnit），回報是否一致與差異清單（federation #1 風險）。當 upAxis 或 metersPerUnit 不一致時，build SHALL 拒絕並回報差異，SHALL NOT 把不一致的 member（如 Y-up）靜默宣告成 Z-up 後產出幾何錯誤的 federated stage。

#### Scenario: 坐標系一致與不一致

- **WHEN** 對 federation set 執行 validate-coords
- **THEN** 各 member upAxis / metersPerUnit 全一致時 SHALL 回報 consistent = true
- **AND** 任一不一致時 SHALL 回報 consistent = false 並列出差異（如 up_axis 不一致）

#### Scenario: build 在 upAxis 不一致時拒絕

- **WHEN** 一個 federation set 含一個 Z-up member 與一個 Y-up member 且對其執行 build
- **THEN** build SHALL 回 409 並回報座標不一致的 issues（含 up_axis 不一致）
- **AND** SHALL NOT 產出 federated stage
- **AND** SHALL NOT 把 Y-up member 靜默宣告成 Z-up

#### Scenario: build 在座標一致時採用 member 的 upAxis 與 metersPerUnit

- **WHEN** 各 member upAxis / metersPerUnit 一致且對其執行 build
- **THEN** federated stage 的 upAxis 與 metersPerUnit SHALL 採用該一致的 member 值
- **AND** SHALL NOT 硬編 upAxis = Z
