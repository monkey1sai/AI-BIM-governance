## 1. A3-1 — per-member transform TRS 修正

- [x] 1.1 反轉 `_apply_member_transform` 加入順序為 `translate→rotateXYZ→scale`（`xformOpOrder = [translate, rotateXYZ, scale]`）。
- [x] 1.2 修正 builder.py 內與此相反的 docstring / 註解（原述「translate 最外層 / 最後套用 / scale→…→translate」），改述為 op 由右至左求值、translate 最外層 least-local、scale 最內層 most-local。

## 2. A3-2 — 測試由 op 字面順序改數值世界座標斷言

- [x] 2.1 重寫 `test_per_member_transform_rotate_and_scale`：`Usd.Stage.Open` 後 `GetLocalTransformation().Transform(Gf.Vec3d(...))` 比對手算世界座標，移除鎖死錯誤順序的斷言。
- [x] 2.2 新增 `test_per_member_transform_world_coords_scale_then_translate`：`scale=2 + translate=(100,0,0)` 下 local 原點 ↦ `(100,0,0)`、local `(1,0,0)` ↦ `(102,0,0)`。

## 3. A3-3 — metersPerUnit 傳遞

- [x] 3.1 `build_federated_usda` 新增 `meters_per_unit` 參數，開 stage 後呼叫 `UsdGeom.SetStageMetersPerUnit`。
- [x] 3.2 回傳 dict 新增 `meters_per_unit` 欄位。
- [x] 3.3 新增 `test_build_preserves_member_meters_per_unit`：傳 0.001 → stage 保留 0.001；不傳 → 回退 0.01（對照證明傳遞有效）。

## 4. A3-4 — 座標一致性驗證 + 不硬編 upAxis

- [x] 4.1 `build_set` 在 build 前跑 `validate_coords`；不一致回 409 並回報 issues / members。
- [x] 4.2 一致時把該 upAxis / metersPerUnit 傳給 `build_federated_usda`，移除硬編 Z。
- [x] 4.3 新增 `_consistent_coords` helper 從一致報告抽出唯一 (up_axis, meters_per_unit)。
- [x] 4.4 新增 `test_build_rejects_inconsistent_up_axis`：Y-up + Z-up member → 409 + issues 含 up_axis；強化 `test_federation_api_end_to_end` 斷言回傳 up_axis=Z / meters_per_unit=0.001。

## 5. 自驗

- [x] 5.1 `governance-service` pytest 全綠（48 passed）。
- [x] 5.2 `npx openspec validate a3-federation-trs-coords --strict` 通過。
- [x] 5.3 `git add -A && git diff --cached --check` 無 whitespace 錯誤。
