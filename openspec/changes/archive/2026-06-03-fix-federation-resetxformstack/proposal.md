## Why

FU-4（`a3-federation-trs-coords`，#167 已 merge）把 federation `:fed` ops 重排到 member 既有 ops **之前（最外層）**，以避免 federation translate 被 member 自身 scale/rotate 連帶縮放/旋轉。但該重排沒有處理 USD 的特殊 token **`!resetXformStack!`**。

`!resetXformStack!` 合法且常見（IFC→USD 後對 root prim 重置繼承自父層的變換）。它是 `xformOpOrder` 的特殊 token，**只在出現於 index 0 時才生效**。merge 後外部 reviewer（Codex P1 二次）以真實 pxr 26.5 強確認 1 個 finding：

- **（high/bug）**：當 member 既有 `xformOpOrder` 以 `!resetXformStack!` 開頭時，FU-4 的重排會把 fed ops 塞到它**前面**，產生 `['xformOp:translate:fed', '!resetXformStack!', 'xformOp:scale']`。reset token 不在第一位 → USD **忽略它前面的所有 op** → federation translate 完全沒套用。pxr 26.5 實測：member `['!resetXformStack!', 'xformOp:scale']`(scale=2) + federation `translate=(100,0,0)` 下，local 原點落在世界 `(0,0,0)`（federation translate 整段被吞），而非正確的 `(100,0,0)` → 該 member 置放錯誤。

本 change 以 pxr 26.5 本體為 ground truth 修復這 1 項，並新增「member 帶 `!resetXformStack!` 時 federation translate 仍套用」的真實 pxr 世界座標回歸測試。

## What Changes

- **修法**：`_apply_member_transform` 的重排在抽 `fed_ops` / `member_ops` 之前，先把 leading `!resetXformStack!`（若有）抽出固定在 index 0；fed ops 插在 reset **之後**、member 既有非-reset ops 之前。目標順序：`['!resetXformStack!', <fed ops>, <member 既有非-reset ops>]`。無 leading reset 時行為與 FU-4 完全一致（`<fed ops> + <member ops>`），FU-4 P1 的修復不回歸。
- **註解 / docstring**：在 `_apply_member_transform` 補述 `!resetXformStack!` 只在 index 0 生效的 pxr 語義，與本特例的處理。
- **測試**：新增 `test_federation_transform_applies_when_member_has_reset_xform_stack`，以 `Usd.Stage.Open` + `GetLocalTransformation().Transform(Gf.Vec3d(...))` 驗 member 帶 `!resetXformStack!` + scale=2 時 federation `translate=(100,0,0)` 下 local 原點 ↦ 世界 `(100,0,0)`、local `(1,0,0)` ↦ `(102,0,0)`，並斷言 reset token 仍在 index 0、member 既有 op 未被 clobber。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `usd-federation-sublayer-sets`：per-member transform 套用 SHALL 保留 member 既有 `!resetXformStack!` 語意——leading `!resetXformStack!` 維持在 `xformOpOrder` index 0，federation ops 置於 reset 之後、member 幾何 ops 之前，使 federation transform 在含 reset 的 member 上仍正確套用。

## Impact

- Owner repo / folder:
  - `governance-service/federation/builder.py`（`_apply_member_transform` 重排邏輯 + 註解）。
  - `governance-service/tests/test_federation_builder.py`（新增 reset-xform-stack 回歸測試 + helper）。
- API / data shape:
  - **無變更**。`_apply_member_transform` 簽章、`build_federated_usda` 簽章與回傳 dict shape 皆不變；僅改 `xformOpOrder` 排列邏輯。
- Dependencies:
  - **不新增依賴**（純 pxr authoring，CPU loopback）。
- Non-goals:
  - 不改 FU-4 已修正的標準 TRS（無 reset 時 translate 最外層、scale 最內層）語義。
  - 不改 sublayer 疊合順序、可見度 override、metersPerUnit 傳遞、座標一致性驗證、Review Room handoff 既有語義。
  - 不處理 member 中段（非 leading）出現的 `!resetXformStack!`（USD 中段 reset 本就不生效，非 federation 引入；不在本 change 範圍）。
- 交叉驗證（誠實）：以真實 pxr 26.5 證明修正後 member `['!resetXformStack!', 'xformOp:scale']`(scale=2) + federation `translate=(100,0,0)` 之 local 原點 ↦ 世界 `(100,0,0)`、`(1,0,0)` ↦ `(102,0,0)`；修正前同條件落在 `(0,0,0)`（federation translate 被 reset 吞掉），差異即本 bug。無 reset 的既有案例（member scale=2 + fed translate=(100,0,0) → 原點 `(100,0,0)`）不回歸。
