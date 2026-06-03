## 1. 修法 — 重排保留 leading !resetXformStack!

- [x] 1.1 `_apply_member_transform` 重排前先抽出 leading `!resetXformStack!`（若 `current[0] == "!resetXformStack!"`），固定置於 index 0；其餘 ops 再分 `fed_ops` / `member_ops`，最終 `order = leading_reset + fed_ops + member_ops`。
- [x] 1.2 無 leading reset 時退化為 FU-4 行為（`fed_ops + member_ops`），確保 FU-4 P1 修復不回歸。
- [x] 1.3 補 docstring / 註解：`!resetXformStack!` 只在 index 0 生效（pxr ground-truth：reset 不在第一位時 USD 忽略它前面所有 op），及本特例處理。

## 2. 測試 — member 帶 !resetXformStack! 時 federation translate 仍套用

- [x] 2.1 新增 helper `_member_with_reset_and_scale`：member root prim `AddScaleOp` + `SetResetXformStack(True)`，xformOpOrder=`['!resetXformStack!', 'xformOp:scale']`。
- [x] 2.2 新增 `test_federation_transform_applies_when_member_has_reset_xform_stack`：member 帶 reset + scale=2 + federation `translate=(100,0,0)`，以 `Usd.Stage.Open` + `GetLocalTransformation().Transform(Gf.Vec3d(...))` 驗 local 原點 ↦ `(100,0,0)`、local `(1,0,0)` ↦ `(102,0,0)`；斷言 `order[0] == "!resetXformStack!"`、`order[1]` endswith `translate:fed`、`order[-1] == "xformOp:scale"`、`GetResetXformStack() is True`、member usdc immutable。

## 3. 自驗

- [x] 3.1 `governance-service` pytest 全綠（74 passed）。
- [x] 3.2 P1 probe 三項真實 pxr 世界座標：item1 reset+scale 原點 ↦ (100,0,0)；item2a 無 ops 原點 ↦ (100,0,0)；item2b 無 reset scale=2 原點 ↦ (100,0,0)（FU-4 修復不回歸）。
- [x] 3.3 `npx openspec validate fix-federation-resetxformstack --strict` 通過。
- [x] 3.4 `git add -A && git diff --cached --check` 無 whitespace 錯誤。
