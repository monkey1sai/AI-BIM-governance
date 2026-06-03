# usd-federation-sublayer-sets Specification

## Purpose
TBD - created by archiving change a3-transform-review-room. Update Purpose after archive.
## Requirements
### Requirement: federation SHALL 支援 per-member transform 且不破壞 member

federation build SHALL 能對每個 member 套用可選的 transform（translate / rotateXYZ / scale），且 member 的 USD 檔 SHALL NOT 被修改（immutable）。transform SHALL 只 author 在 federation 的 root layer，並 SHALL 與 member 自身既有的 transform 合成（不得 clobber）。

#### Scenario: member transform 在 root layer 合成且 member 檔不變

- **WHEN** 某 member 帶 transform 且其 root prim 自身已有 local transform，federation build 之
- **THEN** 合成 stage 上該 prim 的 resolved local transform SHALL 同時反映 member 自身與 federation 的 transform
- **AND** member 的 USD 檔內容 SHALL 維持不變（byte-identical）
- **AND** federation transform SHALL author 於 root layer（最強），以 outermost op 套用（世界置放語意）

#### Scenario: 無 transform 的 member 不被加 op

- **WHEN** member 未提供 transform
- **THEN** federation build SHALL NOT 對該 member 的 prim author 任何 federation transform op

### Requirement: federation SHALL 提供 Review Room handoff descriptor

`governance-service` SHALL 提供端點，把已 build 的 federated stage 以 viewer 可消費的 `stage_composition`（primary + secondary_layers）形式交給 Review Room；且 SHALL 誠實標示 GPU 串流由 host-native Kit 負責，本服務不啟動串流。

#### Scenario: build 後回傳 stage_composition handoff

- **WHEN** 一個 federated set 已 build 後查詢其 review-room
- **THEN** 回應 SHALL 標 `ready=true` 並含 `stage_composition.primary`，其 url 指向該 set 的 `federated_review.usda`
- **AND** 回應 SHALL 說明此 stage 交由 host-native Kit review session 載入，governance-service 不啟動 GPU 串流

#### Scenario: 尚未 build 時誠實導引

- **WHEN** 一個尚未 build 的 federated set 被查詢 review-room
- **THEN** 回應 SHALL 標 `ready=false` 且 SHALL NOT 回傳 stage_composition
- **AND** 回應 SHALL 導引使用者先執行 build
