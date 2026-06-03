# usd-federation-sublayer-sets Specification

## Purpose
TBD - created by archiving change a3-transform-review-room. Update Purpose after archive.
## Requirements
### Requirement: federation SHALL 支援 per-member transform 且不破壞 member

federation build SHALL 能對每個 member 套用可選的 transform（translate / rotateXYZ / scale），且 member 的 USD 檔 SHALL NOT 被修改（immutable）。transform SHALL 只 author 在 federation 的 root layer，並 SHALL 與 member 自身既有的 transform 合成（不得 clobber）。per-member transform SHALL 遵循標準 TRS（world = T·R·S）：translate 為 xformOpOrder 最外層（least-local）、scale 為最內層（most-local），使 translate 不被 member 或自身 scale 連帶縮放、不被 rotate 連帶旋轉。正確性 SHALL 以真實 pxr 計算的世界座標驗證，SHALL NOT 僅斷言 xformOp 字面順序。此外，per-member transform 套用 SHALL 保留 member 既有 `!resetXformStack!` 語意：若 member 的 `xformOpOrder` 以 `!resetXformStack!` 開頭，該 token SHALL 維持在 index 0（federation ops SHALL 置於 reset 之後、member 幾何 ops 之前），使含 `!resetXformStack!` 的 member 上 federation transform 仍正確套用、不被 USD 因 reset token 不在第一位而忽略。

#### Scenario: member transform 在 root layer 合成且 member 檔不變

- **WHEN** 某 member 帶 transform 且其 root prim 自身已有 local transform，federation build 之
- **THEN** 合成 stage 上該 prim 的 resolved local transform SHALL 同時反映 member 自身與 federation 的 transform
- **AND** member 的 USD 檔內容 SHALL 維持不變（byte-identical）
- **AND** federation transform SHALL author 於 root layer（最強），其 translate op SHALL 為 xformOpOrder 最外層、scale op SHALL 為最內層

#### Scenario: per-member transform 遵循標準 TRS（以 pxr 世界座標驗證）

- **WHEN** 某 member 帶 transform `scale=(2,2,2)` 與 `translate=(100,0,0)`，federation build 後以 `Usd.Stage.Open` 開啟、對其 root prim 取 `GetLocalTransformation()`
- **THEN** local 原點 `(0,0,0)` 經該 transform SHALL 映射到世界座標 `(100,0,0)`（translate SHALL NOT 被 scale 連帶放大成 `(200,0,0)`）
- **AND** local `(1,0,0)` SHALL 映射到世界座標 `(102,0,0)`

#### Scenario: member 帶 !resetXformStack! 時 federation transform 仍套用

- **WHEN** 某 member 的 root prim `xformOpOrder` 以 `!resetXformStack!` 開頭（例如 `['!resetXformStack!', 'xformOp:scale']`，scale=2），且該 member 帶 federation `translate=(100,0,0)`，federation build 後以 `Usd.Stage.Open` 開啟、對其 root prim 取 `GetLocalTransformation()`
- **THEN** 合成 stage 上該 prim 的 `xformOpOrder` SHALL 以 `!resetXformStack!` 為 index 0，federation `translate:fed` op 緊接其後，member 既有 scale op 維持在最內層
- **AND** local 原點 `(0,0,0)` 經該 transform SHALL 映射到世界座標 `(100,0,0)`（federation translate 真的套用，SHALL NOT 因 reset token 不在第一位而被忽略落在 `(0,0,0)`）
- **AND** local `(1,0,0)` SHALL 映射到世界座標 `(102,0,0)`（member scale=2 仍作用於幾何）
- **AND** member 的 USD 檔內容 SHALL 維持不變（byte-identical）

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
