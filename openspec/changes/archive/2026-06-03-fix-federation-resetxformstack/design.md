## Context

FU-4（`a3-federation-trs-coords`）把 federation per-member transform 修成標準 `world = T·R·S`：federation `:fed` ops 重排到 member 既有 ops **之前（最外層）**，使 federation translate 不被 member 自身 scale/rotate 連帶。但該重排只用「`endswith(":fed")` 與否」二分，沒有把 USD 特殊 token `!resetXformStack!` 當成需要特別處理的元素。merge 後外部 reviewer（Codex P1 二次）以真實 pxr 26.5 抓到此邊界 bug。本 design 以 **pxr 26.5 本體為 ground truth** 記錄 `!resetXformStack!` 的正確語義與修法。

## Goals / Non-Goals

- Goals：federation per-member transform 在 member 既有 `xformOpOrder` 以 `!resetXformStack!` 開頭時仍正確套用（reset 語意保留、federation translate 不被吞）；以真實 pxr 世界座標把關;FU-4 既有修復不回歸。
- Non-Goals：不改 FU-4 的標準 TRS（無 reset 時 translate 最外層、scale 最內層）；不改 sublayer 疊合 / 可見度 / metersPerUnit / 座標驗證 / Review Room handoff 語義；不處理 member 中段（非 leading）的 `!resetXformStack!`（USD 中段 reset 本就不生效，非 federation 引入）。

## Decisions

### D1：重排保留 leading `!resetXformStack!` 在 index 0（核心修法）

USD `!resetXformStack!` 是 `xformOpOrder` 的特殊 token，語意為「忽略繼承自父層的變換，自此 prim 重新累積」。pxr ground-truth：**它只在出現於 index 0 時生效**；不在第一位時 USD 會**忽略它前面的所有 op**。

FU-4 的重排：

```python
fed_ops    = [n for n in current if n.endswith(":fed")]
member_ops = [n for n in current if not n.endswith(":fed")]
order_attr.Set(fed_ops + member_ops)
```

`!resetXformStack!` 不以 `:fed` 結尾 → 落入 `member_ops`。若 member 既有順序為 `['!resetXformStack!', 'xformOp:scale']`，重排後成 `['xformOp:translate:fed', '!resetXformStack!', 'xformOp:scale']` → reset 退到 index 1 → fed translate 被忽略。

修法：重排前先把 leading `!resetXformStack!` 抽出固定在 index 0，其餘再分 fed / member：

```python
reset_token = "!resetXformStack!"
leading_reset = current[:1] if current and current[0] == reset_token else []
rest = current[len(leading_reset):]
fed_ops    = [n for n in rest if n.endswith(":fed")]
member_ops = [n for n in rest if not n.endswith(":fed")]
order_attr.Set(leading_reset + fed_ops + member_ops)
```

目標順序 `['!resetXformStack!', <fed ops>, <member 既有非-reset ops>]`：reset 仍在 index 0（語意保留）；fed ops 是「reset 之後的最外層」（世界置放語意不變）；member 幾何 ops 仍最內層（未 clobber，幾何仍受其作用）。無 leading reset 時 `leading_reset = []`，退化為 FU-4 的 `fed_ops + member_ops`，行為完全一致。

pxr 26.5 實測（ground truth，member scale=2 + federation translate=(100,0,0)）：

| member 既有 xformOpOrder | 重排後 | local(0,0,0)→world | local(1,0,0)→world |
|---|---|---|---|
| `['!resetXformStack!', 'xformOp:scale']`（FU-4 重排，bug） | `['xformOp:translate:fed', '!resetXformStack!', 'xformOp:scale']` | `(0,0,0)` ✗（fed 被吞） | `(0,0,0)` ✗ |
| `['!resetXformStack!', 'xformOp:scale']`（本修法） | `['!resetXformStack!', 'xformOp:translate:fed', 'xformOp:scale']` | `(100,0,0)` ✓ | `(102,0,0)` ✓ |
| `['xformOp:scale']`（無 reset，FU-4 修復） | `['xformOp:translate:fed', 'xformOp:scale']` | `(100,0,0)` ✓ | `(102,0,0)` ✓（不回歸） |

### D2：以世界座標數值斷言把關（延續 FU-4 D2）

沿用 FU-4 的把關原則：不只斷言 op 字面順序，而是 `Usd.Stage.Open` 後 `GetLocalTransformation().Transform(Gf.Vec3d(...))` 比對手算世界座標。新測試的核心斷言是 local 原點 ↦ `(100,0,0)`（federation translate **真的套用**，非 bug 的 `(0,0,0)`）；輔以 order 斷言（reset 在 index 0、fed translate 緊接其後、member scale 在最內層）作為意圖文件。

## Risks / Trade-offs

- 修法只處理 **leading** `!resetXformStack!`。member 中段出現 reset 屬非法/無效用法（USD 本就忽略中段 reset），且非 federation 引入，故不在範圍內——這是有意的最小修復面。
- 重排邏輯多一次 list 切片，效能影響可忽略（xformOpOrder 元素數量極小）。

## Migration Plan

無資料遷移。純行為修正：對「member 既有 xformOpOrder 以 `!resetXformStack!` 開頭」的 federation set，build 後 federation translate 由「被 reset 吞掉（置放錯誤）」改為「正確套用」。先前依賴錯誤幾何結果者需重新 build。無 reset 的 member 行為不變。

## Open Questions

- 無。member 中段 reset 的處理已明確劃為 non-goal（USD 語義上本就不生效）。
