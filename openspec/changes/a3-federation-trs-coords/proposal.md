## Why

A3 USD federation 在對抗驗證（fullsystem-adversarial-verify）中被強確認 4 個 finding：

- **A3-1（high/bug）**：per-member transform 的 xformOp 加入順序反了。原碼依 `scale→rotateXYZ→translate` 加，產生 `xformOpOrder = [scale, rotateXYZ, translate]`；但 pxr 對點求值是**由右至左（list 最後最內層）**，故 translate 變成**最內層**、被 member/自身 scale 連帶縮放、rotate 連帶旋轉，破壞標準 `world = T·R·S`。以 pxr 26.5 實測：`scale=2 + translate=(100,0,0)` 下，local 原點落在世界 `(200,0,0)`（translate 被放大），而非正確的 `(100,0,0)`。
- **A3-2（medium/test-gap）**：既有測試 `test_per_member_transform_rotate_and_scale` 用 `assert applied == ["scale", "rotateXYZ", "translate"]` 與 `order[-1].endswith("translate:fed")` 把**錯誤的 op 順序當正確**斷言，鎖死 A3-1，使 bug 無法被測試攔截。
- **A3-3（medium/bug）**：`build_federated_usda` 開 stage 後不傳遞、不宣告 metersPerUnit，federated stage 靜默回退 pxr 預設 `0.01`；member 為 `0.001` 時整體尺度差 **10 倍**。
- **A3-4（medium/bug）**：`build_set` 不檢查座標一致性且 builder 硬編 `up_axis="Z"`，Y-up member 被靜默宣告成 Z-up，協調會幾何全錯仍無告警。

本 change 以 pxr 26.5 本體為 ground truth 修復這 4 項，並把鎖死錯誤行為的測試改成**真實 pxr 世界座標數值斷言**。

## What Changes

- **A3-1 TRS 修正**：`_apply_member_transform` 反轉加入順序為 `translate→rotateXYZ→scale`，使 `xformOpOrder = [translate, rotateXYZ, scale]`（translate 最外層 / least-local、scale 最內層 / most-local），符合標準 `world = T·R·S`。同步修正 builder.py 內與此相反的錯誤 docstring / 註解（原述「translate 最外層 / 最後套用」與實際相反）。
- **A3-2 測試補強**：把 op 字面順序斷言改成 `Usd.Stage.Open` 後 `UsdGeom.Xformable(prim).GetLocalTransformation().Transform(Gf.Vec3d(...))` 比對手算世界座標；新增 `scale=2 + translate=(100,0,0)` 下 local 原點 ↦ `(100,0,0)`、local `(1,0,0)` ↦ `(102,0,0)` 的核心數值斷言。
- **A3-3 metersPerUnit 傳遞**：`build_federated_usda` 新增 `meters_per_unit` 參數，開 stage 後依 member 一致值呼叫 `UsdGeom.SetStageMetersPerUnit`，回傳 dict 新增 `meters_per_unit` 欄位供呼叫端稽核。
- **A3-4 座標一致性驗證 + 不硬編 upAxis**：`build_set` 在 build 前先跑 `validate_coords`，upAxis / metersPerUnit 不一致時回 **409** 並回報 issues；一致時把該 upAxis 與 metersPerUnit 傳給 `build_federated_usda`，不再硬編 Z。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `usd-federation-sublayer-sets`：per-member transform 由「outermost / scale→…→translate」更正為標準 `world = T·R·S`（translate 最外層、scale 最內層），並以真實 pxr 世界座標驗證。
- `usd-federation-composition`：federated stage SHALL 保留 member 的 metersPerUnit（不回退 0.01）；build SHALL 先驗座標一致性，不一致時拒絕，且 SHALL NOT 硬編 upAxis。

## Impact

- Owner repo / folder:
  - `governance-service/federation/builder.py`（A3-1 op 順序 + 註解、A3-3 metersPerUnit）。
  - `governance-service/federation/api.py`（A3-4 build 前驗座標、傳 upAxis / mpu）。
  - `governance-service/tests/test_federation_builder.py` + `tests/test_federation_api.py`（A3-2 數值斷言、A3-3 / A3-4 新測試）。
- API / data shape:
  - `build_federated_usda` 新增可選參數 `meters_per_unit`；回傳 dict 新增 `meters_per_unit`。
  - `POST …/build` 在座標不一致時新增 **409** 回應（detail 含 `issues` / `members`）；成功回應沿用既有 shape 並含 `up_axis` / `meters_per_unit`。
- Dependencies:
  - **不新增依賴**（純 pxr authoring，CPU loopback）。
- Non-goals:
  - 不改 sublayer 疊合順序、可見度 override、Review Room handoff 既有語義。
  - 不在 governance-service 啟動 GPU 串流。
  - 不自動「修正」不一致座標（reproject / 換軸）——本 change 只偵測並拒絕，自動 reproject 留待後續。
- 交叉驗證（誠實）：以真實 pxr 26.5 證明修正後 `scale=2 + translate=(100,0,0)` 之 local 原點 ↦ 世界 `(100,0,0)`、`(1,0,0)` ↦ `(102,0,0)`；修正前同條件落在 `(200,0,0)`，差異即 A3-1 bug。
