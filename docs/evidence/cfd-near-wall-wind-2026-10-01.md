# 近壁風速薄膜

## 使用者需求與邊界

保留可辨識的建築，同時呈現建築附近的風速。這是取樣流體速度 `|U|`，不是牆面速度，也不是將表面壓力改名或改色。CFD 外殼簡化與 screening 精度限制仍適用。

## 實作

- service presentation v2 在既有求解末尾新增 OpenFOAM 2412 `distanceSurface`，讀取流體場 `U`，`interpolationScheme cellPoint`；使用無正負號距離避免外殼三角形法向影響，取樣僅存在於實際流體網格內。
- 距計算外殼的距離為 `max(0.5m, 2 × 名義近建物網格尺度)`。這個偏移不等於網格收斂證據，不宣稱 0.2–0.5m 的解析能力。
- 結果新增選填 `presentation.near_wall` 與 role `near_wall_speed`；同步 JSON schema、Zod、OpenAPI 與 generated TypeScript。舊結果不變；CLI v1 不新增取樣。
- `NearWallWindSpeed` 是獨立預設隱藏的 prim，與風速圖例共用色階。顯示前先取得半透明 0.35 材質 ACK，再發可見命令；UI 標示距離、名義網格及限制。隱藏不更動 BIM。
- 缺預期 VTK、空面、缺 U 或非有限資料均 fail closed；不產生假的薄膜。求解域、方程式、BIM 與既有結果 artifact 不變。

## 驗證

本機 VERIFIED：取樣／USD／case／golden 首批47項、完整CFD227項、viewer2887項、coordinator2491項、root＋job service1462項通過；viewer typecheck/build及coordinator build通過。新增metadata正值與有限值案例另以targeted契約測試確認。

可見 Chrome 真站新算例尚未驗證；尚不能宣稱薄膜可用或精度改善。

首輪 streaming CI 發現既有 fake solver 缺新增取樣檔；已補齊並增加缺近壁檔必須拒絕發布的整合案例。完全未取樣時維持既有錯誤語意。另有程序逾時清理案例在 CI 失敗，本機 targeted 與完整 suite 未重現，仍需修正版 CI 通過才可合併。

OpenFOAM API 依既有官方 `opencfd/openfoam-default:2412` 映像內 `src/sampling/surface/distanceSurface/distanceSurface.H`、`sampledSurface/distanceSurface/sampledDistanceSurface.H` 核對；沒有下載或改變 runtime。

## 不包含

風線密度與展示 ROI 調整另切片；本次不為了縮小畫面改變求解域，不宣稱目前風線範圍已造成或已修復數值失真。
