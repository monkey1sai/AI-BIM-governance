## MODIFIED Requirements

### Requirement: federation SHALL 支援 per-member transform 且不破壞 member

federation build SHALL 能對每個 member 套用可選的 transform（translate / rotateXYZ / scale），且 member 的 USD 檔 SHALL NOT 被修改（immutable）。transform SHALL 只 author 在 federation 的 root layer，並 SHALL 與 member 自身既有的 transform 合成（不得 clobber）。per-member transform SHALL 遵循標準 TRS（world = T·R·S）：translate 為 xformOpOrder 最外層（least-local）、scale 為最內層（most-local），使 translate 不被 member 或自身 scale 連帶縮放、不被 rotate 連帶旋轉。正確性 SHALL 以真實 pxr 計算的世界座標驗證，SHALL NOT 僅斷言 xformOp 字面順序。

#### Scenario: member transform 在 root layer 合成且 member 檔不變

- **WHEN** 某 member 帶 transform 且其 root prim 自身已有 local transform，federation build 之
- **THEN** 合成 stage 上該 prim 的 resolved local transform SHALL 同時反映 member 自身與 federation 的 transform
- **AND** member 的 USD 檔內容 SHALL 維持不變（byte-identical）
- **AND** federation transform SHALL author 於 root layer（最強），其 translate op SHALL 為 xformOpOrder 最外層、scale op SHALL 為最內層

#### Scenario: per-member transform 遵循標準 TRS（以 pxr 世界座標驗證）

- **WHEN** 某 member 帶 transform `scale=(2,2,2)` 與 `translate=(100,0,0)`，federation build 後以 `Usd.Stage.Open` 開啟、對其 root prim 取 `GetLocalTransformation()`
- **THEN** local 原點 `(0,0,0)` 經該 transform SHALL 映射到世界座標 `(100,0,0)`（translate SHALL NOT 被 scale 連帶放大成 `(200,0,0)`）
- **AND** local `(1,0,0)` SHALL 映射到世界座標 `(102,0,0)`

#### Scenario: 無 transform 的 member 不被加 op

- **WHEN** member 未提供 transform
- **THEN** federation build SHALL NOT 對該 member 的 prim author 任何 federation transform op
