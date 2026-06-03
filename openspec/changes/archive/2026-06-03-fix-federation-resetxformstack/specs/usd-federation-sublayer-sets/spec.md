## MODIFIED Requirements

### Requirement: federation SHALL 支援 per-member transform 且不破壞 member

federation build SHALL 能對每個 member 套用可選的 transform（translate / rotateXYZ / scale），且 member 的 USD 檔 SHALL NOT 被修改（immutable）。transform SHALL 只 author 在 federation 的 root layer，並 SHALL 與 member 自身既有的 transform 合成（不得 clobber）。per-member transform 套用 SHALL 保留 member 既有 `!resetXformStack!` 語意：若 member 的 `xformOpOrder` 以 `!resetXformStack!` 開頭，該 token SHALL 維持在 index 0（federation ops SHALL 置於 reset 之後、member 幾何 ops 之前），使含 `!resetXformStack!` 的 member 上 federation transform 仍正確套用、不被 USD 因 reset token 不在第一位而忽略。

#### Scenario: member transform 在 root layer 合成且 member 檔不變

- **WHEN** 某 member 帶 transform 且其 root prim 自身已有 local transform，federation build 之
- **THEN** 合成 stage 上該 prim 的 resolved local transform SHALL 同時反映 member 自身與 federation 的 transform
- **AND** member 的 USD 檔內容 SHALL 維持不變（byte-identical）
- **AND** federation transform SHALL author 於 root layer（最強），以 outermost op 套用（世界置放語意）

#### Scenario: member 帶 !resetXformStack! 時 federation transform 仍套用

- **WHEN** 某 member 的 root prim `xformOpOrder` 以 `!resetXformStack!` 開頭（例如 `['!resetXformStack!', 'xformOp:scale']`，scale=2），且該 member 帶 federation `translate=(100,0,0)`，federation build 後以 `Usd.Stage.Open` 開啟、對其 root prim 取 `GetLocalTransformation()`
- **THEN** 合成 stage 上該 prim 的 `xformOpOrder` SHALL 以 `!resetXformStack!` 為 index 0，federation `translate:fed` op 緊接其後，member 既有 scale op 維持在最內層
- **AND** local 原點 `(0,0,0)` 經該 transform SHALL 映射到世界座標 `(100,0,0)`（federation translate 真的套用，SHALL NOT 因 reset token 不在第一位而被忽略落在 `(0,0,0)`）
- **AND** local `(1,0,0)` SHALL 映射到世界座標 `(102,0,0)`（member scale=2 仍作用於幾何）
- **AND** member 的 USD 檔內容 SHALL 維持不變（byte-identical）

#### Scenario: 無 transform 的 member 不被加 op

- **WHEN** member 未提供 transform
- **THEN** federation build SHALL NOT 對該 member 的 prim author 任何 federation transform op
