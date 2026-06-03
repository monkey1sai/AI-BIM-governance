# usd-federation-composition Specification

## Purpose
TBD - created by archiving change usd-federation-sublayer-sets. Update Purpose after archive.
## Requirements
### Requirement: 落地端 SHALL 以 sublayer 疊合多個 discipline USD 成 federated stage 且不破壞 member

`governance-service` SHALL 接受一組 discipline member（各帶 usd_path / discipline / layer_order）並以 OpenUSD sublayer 疊合成單一具名 root layer（`federated_review.usda`）。member 的 USD 檔 SHALL NOT 被開啟寫入（immutable）。authoring SHALL 為 CPU（不需 GPU render）。

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

### Requirement: build 前 SHALL 可驗證共享坐標系

`governance-service` SHALL 能在 build 前比對各 member 的坐標系（upAxis / metersPerUnit），回報是否一致與差異清單（federation #1 風險）。

#### Scenario: 坐標系一致與不一致

- **WHEN** 對 federation set 執行 validate-coords
- **THEN** 各 member upAxis / metersPerUnit 全一致時 SHALL 回報 consistent = true
- **AND** 任一不一致時 SHALL 回報 consistent = false 並列出差異（如 up_axis 不一致）

### Requirement: federation SHALL 誠實標示 USD 語義與未做能力

`governance-service` 與前端 SHALL 誠實標示 USD composition 語義與未做能力，SHALL NOT 誤述。

#### Scenario: USD 語義誠實標示

- **WHEN** 呈現 federation 機制說明
- **THEN** SHALL 正確標明 sublayer 為 whole-layer 非破壞疊合，其 opinion 在 LIVERPS 的 Local（最強）步驟解析（subLayerPaths[0] 最強）
- **AND** SHALL NOT 稱 sublayer 為「最弱 arc」或 LIVERPS 七弧之一（sublayer 不在七弧內）
- **AND** SHALL 標明 sessionLayer 為暫態、不作持久層（federation 用具名 root layer）
- **AND** per-member transform 套用 SHALL 標為未做（p1）

### Requirement: federation SHALL 經 coordinator proxy

瀏覽器 SHALL 只經 `bim-review-coordinator`（:8004）的 `/api/governance/federated-sets*` 操作 federation，SHALL NOT 直連 `governance-service`（:49102）。

#### Scenario: 經 proxy 操作

- **WHEN** 瀏覽器建立 / 疊合 / 驗證 / build federation set
- **THEN** 它 SHALL 呼叫 coordinator `/api/governance/federated-sets*`
- **AND** SHALL NOT 直連 `127.0.0.1:49102`
