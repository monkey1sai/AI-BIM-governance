## Context

A3 federation 用 OpenUSD sublayer 把多 discipline 模型疊在同一 stage，並支援 per-member transform（協調會位移 / 對齊原點）。對抗驗證強確認 4 個 finding（A3-1~A3-4），核心是「對 USD composition / xform 語義想當然，未以 pxr 本體實測」。本 design 以 **pxr 26.5 本體為 ground truth** 記錄正確語義與修法。

## Goals / Non-Goals

- Goals：per-member transform 遵循標準 `world = T·R·S`；federated stage 保留 member metersPerUnit；build 前驗座標一致性、不硬編 upAxis；測試用真實 pxr 世界座標把關。
- Non-Goals：不改 sublayer 疊合 / 可見度 override / Review Room handoff 語義；不啟動 GPU 串流；不自動 reproject 不一致座標（只偵測並拒絕）。

## Decisions

### D1：xformOp 加入順序 = translate → rotateXYZ → scale（A3-1）

USD `xformOpOrder` 由左至右是 least-local → most-local；對點求值時**由右至左**套用（list 最後一個 op 最內層 / most-local、最先作用到點；list 第一個 op 最外層 / least-local、最後作用）。標準 `world = T·R·S`（先 scale、再 rotate、最後 translate 作用到點）等價於 `xformOpOrder = [translate, rotateXYZ, scale]`。

`UsdGeom.Xformable.Add*Op` 是 **append** 到現有 `xformOpOrder`，故「加入順序」即「list 由前到後的順序」。要讓 translate 在最前（最外層），就**先 AddTranslateOp、再 AddRotateXYZOp、最後 AddScaleOp**。

pxr 26.5 實測（ground truth）：

| 加入順序 | xformOpOrder | local(0,0,0)→world | local(1,0,0)→world |
|---|---|---|---|
| scale→translate（原錯碼） | `[scale, translate]` | `(200,0,0)` ✗ | `(202,0,0)` |
| translate→scale（修正） | `[translate, scale]` | `(100,0,0)` ✓ | `(102,0,0)` |

（scale=2、translate=(100,0,0)。錯碼把 translate 連帶 scale 放大成 200。）

原 docstring「federation op 落 outermost / 依 scale→rotateXYZ→translate 加，使 translate 最外層」自相矛盾：該加入順序實際把 translate 放在 list 最後 = 最內層。一併更正。

### D2：以世界座標數值斷言取代 op 字面順序斷言（A3-2）

字面斷言 `applied == ["scale", "rotateXYZ", "translate"]` 只鎖 op 名稱排列，無法分辨「排列正確但語義錯」。改用 `GetLocalTransformation().Transform(Gf.Vec3d(...))` 比對手算世界座標，直接驗 T·R·S 的數值結果，才是抗回歸的把關。保留一個輕量的 `applied == ["translate", "rotateXYZ", "scale"]` 斷言作為意圖文件，但正確性由世界座標決定。

### D3：metersPerUnit 顯式傳遞（A3-3）

`Usd.Stage` 預設 metersPerUnit = 0.01；member 多為 0.001（mm）。federated stage 不宣告就回退 0.01，整體尺度差 10 倍。`build_federated_usda` 新增 `meters_per_unit` 參數，開 stage 後 `UsdGeom.SetStageMetersPerUnit`，並回傳 `effective_mpu`（`GetStageMetersPerUnit` 讀回值）供呼叫端稽核。留空時退回 0.01，但呼叫端（build_set）會從一致的 member 顯式傳入。

### D4：build 前驗座標、不硬編 upAxis（A3-4）

`coords.validate_coords(members)` 已能回報 upAxis / metersPerUnit 是否一致與 issues。`build_set` 在 build 前呼叫它：不一致回 **409 Conflict**（detail 含 issues / members）；一致時用 `_consistent_coords` 抽出唯一 (up_axis, meters_per_unit) 傳給 builder。upAxis / metersPerUnit 一致是 federation 幾何正確的前提，故選硬 gate（拒絕）而非靜默宣告。

選 409 而非 422：member 各自皆為合法 USD（語法無誤），衝突在於彼此座標系不可共置——屬資源狀態衝突語義，409 較貼切。

## Risks / Trade-offs

- 既有已建立但座標不一致的 federation set 現在 build 會回 409（之前會靜默成功但幾何錯）。這是預期的正確化；錯誤的「成功」本就不該存在。
- 不自動 reproject：跨 upAxis / 單位的自動轉換需更多 USD 語義（Y↔Z 軸換、scale 補償），風險高，留待後續 change。本 change 先把「靜默錯」變成「明確擋」。

## Migration Plan

無資料遷移。純行為修正：build 對不一致座標由「靜默成功」改「409 拒絕」；transform 由錯誤 TRS 改正確 TRS。呼叫端若依賴舊（錯）幾何結果需重新 build。

## Open Questions

- 跨 upAxis / 單位的自動 reproject 是否要做、放哪一層（governance-service 還是 conversion authority）？——本 change 外，後續評估。
