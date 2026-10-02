# CFD 計算地面與行人取樣來源：第一刀

承接 [D1／D2 決策](cfd-v1-context-decision-2026-10-02.md) 與 [CP9b 共同域估算](cfd-context-geometry-estimate.md)。本刀交付可信標示與結果來源契約；實際地面選取、地形相對取樣及求解地形整合仍未完成。

目前 solver 使用固定 `ground_z_m`，行人取樣使用該高程加 CaseParams 的取樣高度。這不等於 IFC 中每片道路、廣場或平台上方 1.5 m。外部風場 profile 排除 IfcSite，不能把場地完整納算當成已驗證事實；全模型最低點、所有 IfcSite 或最大水平面也不能直接當作可行走地面。

## 結果契約與來源

`GET /api/cfd/runs/{runId}/result` 的每方向 `presentation` 新增 optional `ground_reference`，schema `cfd-ground-reference/v1`。來源綁定沿用同一 result 的 conversion ID、model USDC SHA 及方向 overlay SHA；沒有另建靠檔名配對的來源。

| 欄位 | 本刀意義 |
|---|---|
| reference / actual_ground_verified | 固定 `assumed_flat_plane` / `false`；不接受已核對或 selected surface 的宣稱 |
| units / up_axis | 固定 m / Z，與目前 CFD writer 的 model frame 一致 |
| ground_z_m | writer 實際使用的計算地面高程 |
| sampling_plane_z_m | 實際行人取樣 VTK 的 Z；資料不存在、非有限或平面高程差超過 0.000001 m 時為 null；不是擬合地形 |
| height_above_calculation_ground_m | 實際 sample Z 減計算 ground Z；兩者可算才記錄，不硬填 1.5 |
| vector_display_lift_m | 向量 writer 的實際顯示偏移；無向量資料則 null；不參與 U 或取樣高度計算 |

取樣 Z 與相對計算地面的高度必須同時有值或同時未知；coordinator 檢查其算術一致，亦拒絕與既有 presentation.ground_z_m 衝突。Frozen JSON Schema 定義欄位形狀，算術一致由 runtime schema 檢查。Steady v2／transient writer 產生此紀錄，v1 與舊結果保持相容。此 metadata 只加入新 result；不回填或覆寫舊 artifact，也不移動原取樣數據。

## 顯示及匯出

面板在 Kit 確認目前 run／方向後才顯示該結果的地面資料；HUD、PNG／WebM 使用同一讀回模型。舊結果只顯示已記錄的計算地面，取樣高程與箭頭偏移未知，不能由 PedestrianWind_1p5m 名稱猜值。Ground 狀態保留固定可捲讀空間，輪詢／確認不得移動後方控制。

常駐「實際地面未核對；不能視為全場距地 1.5 m」。統計欄改稱取樣面 U max；prim／API `pedestrian_1p5m` 識別保持相容。未改變量測值、solver 字典、網格、入流、地形或 run 提交流程。沒有新增依賴、環境變數、排程、部署流程或 migration。

## 接續與驗收

原面來源基礎見 [可行走面來源 primitive](cfd-ground-selected-face-source.md)：只讀明選的 source-bound authored triangles，不宣稱地面已核對；候選／UI 選面、區域版本與有效 fluid 取樣仍待後續切片。

後續先保存已選定可行走表面的模型 SHA、GUID／面／區域及版本，再驗證各點 `z_ground(x,y)+1.5m` 在有效流體 cell 內；雲圖、向量、統計及 HUD 共用定義。缺表面、孔洞、屋頂／地下結構或 solid／超域點不得插值冒充空氣。若原計算地形正確、三維 U/p 及網格有效，可重取樣；漏掉的地形不能由平移舊雲圖或重取樣補回。新 mesh／solver 必須先依 D1 決策 §6 提出成本、資源及停止條件，取得新預算，不沿用已用完探針。

本刀驗收分為：實際 writer 座標與偏移；runtime／frozen contract 負向及舊結果相容；UI／HUD 不猜值、換 run 清除；合併後 canonical181 與可見 Chrome 真站／截圖。通過僅代表軟體標示可信，不代表地面已修復或 CFD 工程精度通過。回滾使用正常 revert PR，重新 canonical 部署；舊結果可相容，不需資料遷移。
