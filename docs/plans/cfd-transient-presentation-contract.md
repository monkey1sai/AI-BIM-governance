# 非穩態 CFD：共同物理時間呈現契約

本切片回應 owner 2026-10-01 選定的「真正隨時間變化：同一時間步同步顯示流場與表面壓力」。使用已保存的有界 `pimpleFoam` / URANS 結果；本切片不啟動求解、延長時間或重試。

## 輸入與產品邊界

- 原 pilot 的重試已到原牆鐘上限；可用資料為 19 組 0.5–9.5 s、間隔 0.5 s 的三個共同取樣面。原要求 10 s 未全完成，統計穩定與工程精度未驗證。
- 三個面為 `pedestrian_1p5m` 的點資料 U、`near_wall_speed` 的點資料 U、`building` 的面資料 p。p 為運動壓力（p/ρ，m²/s²），不是 Pa。
- 19 個時間步的網格與幾何完全相同。建築幾何保持固定，顏色與向量隨物理時間變化；沒有流固耦合或建築變形。
- 本切片只交付三個面及行人面向量。現有 pilot 沒有三維非穩態流線或粒子軌跡，不能沿用穩態流線後將其標成非穩態。這是原追加需求的部分交付，三維流動路徑仍未完成。
- 原 pilot、來源 run、模型、網格與初始 U/p 保持不可變。匯入生成新的 run 與 USDC，不覆寫或取代原檔。

## 匯入入口與拒絕條件

`tools/cfd/probes/publish_transient.py` 預設只驗證；`--publish` 才建立唯一新結果。入口須明確指定 pilot、artifacts root、source run、conversion ID 與模型 SHA-256。

驗證清單：來源 run 為 ready 且身分完全相符；case metadata 與 pilot manifest 一致；初始網格與 U/p 雜湊一致；取樣路徑限固定子目錄；所有檔案為一般檔案且無 symlink/junction；每時間步三個面皆存在、雜湊相符、數值有限、幾何拓撲逐項相同、時間等距遞增。來源 JSON 上限 16 MiB、快照合計上限 1 GiB、來源雜湊檔案合計上限 4 GiB，USDC 上限 128 MiB。

無效輸入在建立結果目錄前拒絕。生成失敗或產物超限保留未完成目錄供診斷，但不寫 ready。成功時先驗證結果契約並寫 artifacts / result，再最後以 `run.json.tmp` → `run.json` 公布 ready；不複製原 idempotency key，不把穩態收斂/迭代數當成新非穩態證明。

## USD 與播放契約

- 三面使用一份共享固定幾何，各時間步各自保留實際 U/p 與顏色；每角色同時恰有一個時間步可見。行人面向量從同時間 U 生成，展示 ROI 只裁向量，不縮小求解域。
- 用 token visibility 的 sample-hold 切換，避免對離散求解快照插值生成未計算數值；不修改 Stage 全域插值模式。[OpenUSD 時間取樣文件](https://openusd.org/release/user_guides/time_and_animated_values.html)
- USDC 24 time codes/s，第一份物理資料 0.5 s 對應播放器 0 s；播放器秒數與物理時間分開。最後一份快照保留一個取樣間隔，循環後返回第一份。
- 速度仍以 session `Sdf.LayerOffset` 控制 0.25–4×，不修改 artifact 或 primary model。`overlay_playback` 新增 `query` / `seek` 與 `sample_index`；沿用 primary / runtime / lease / session authority。query 不改 timeline 或 USD session。
- seek 只接受已存在的整數索引 0–63，會暫停並移至確切求解時間步；成功讀回包含 run_id、sample_index、physical_time_seconds。多個動畫 CFD layer 或錯位時間 metadata 拒絕控制。

## 結果與前端契約

- `presentation.animation.mode = urans_sampled` 必須搭配 `presentation.temporal` 的 solver、共同時間、固定幾何、sample_hold 與來源雜湊。舊穩態格式不變；不得混合兩種標示。
- HUD 與匯出共用 renderer；物理時間只接受當前載入 run、當前 binding revision 及 Kit 成功讀回的確切索引/時間。未讀回顯示未確認，換結果或讀回失敗清除確認。
- HUD 是每 500 ms 最後確認的時間，非逐影格同步保證。PNG 精確時間驗收先 seek 暫停、等待 Kit 讀回與畫面穩定；播放中 WebM 更新最後確認時間，只有時間欄位前進不取消錄影，換 run/revision 或其他來源設定仍取消。
- 可用時間步 slider、播放、暫停、重播與變速；前端每 500 ms 最多一筆時間查詢，pending 時不重疊，transport 拒絕時停止查詢並顯示中斷。元件卸載或結果切換停止舊查詢。
- 壓力/近壁預設透明度 0.35、行人面 0.6；壓力色階跨全部可用時間，風速維持既有 0–5 m/s，超過 5 會飽和。這不代表幾何或網格精度已改善。

## 驗證與未完成門檻

本機必要證據：真 USD 的共同時間/固定幾何/原檔保留；匯入拒絕路徑；命令及 API 契約；前端錯 run/錯時間/中斷/舊結果；受影響服務完整測試與建置；canonical deploy DryRun。獨立雙軸審查後正常 PR / pr-safety / 合併，僅由 freshly fetched origin/main 部署 181。

真站驗收須在可見 Chrome：正確原模型首幀、載入新結果、至少首/中/末三個物理時間步、三表面與向量同時間原始 U/p 證據、播放/暫停/seek/重播/變速 Kit 讀回、壓力顏色隨時間改變、PNG 與 HUD 時間相符、關閉結果恢復原 BIM。健康與單元測試不能替代這些證據。

回滾以 revert 本切片 PR；新結果保留且舊結果仍可用。舊客戶端無法顯示物理時間時不得宣稱已完成同步。三維非穩態流線、10 s 完整時段、統計穩定、網格收斂與工程精度均為未完成項，不啟動額外求解。
