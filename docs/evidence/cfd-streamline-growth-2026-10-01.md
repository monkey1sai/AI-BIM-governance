# CP3 流線呈現：實作與驗證紀錄

## 實作範圍

- 僅服務新 run 以 `CaseParams.presentation_version=2` 啟用；CLI、batch、convergence 與 AIJ 的預設仍為 1，golden 字典 hash 不變。
- 種子簾位於 solver-frame 建物 bbox 上游 0.5H，寬度向兩側各延伸 0.25W；8×30 個種子，高度從行人面至 1.2H。輸出不落入建物 bbox。
- 流線逐邊裁切至 bbox ±3H（XY）、ground 至 top+H；交界插值速度，離開再進入拆成不同片段。最多 240 條，每條最多 200 點。
- 管徑為 footprint 最長邊的 0.5%，限制 0.3–1.2 m。48 個時間群組依累積行進時間逐段顯示，6 秒生長，240 幀/24 fps 循環；仍標示為穩態解示意動畫。
- `StreamlineGrowth` 是 run prim 的直接子項，內含時間取樣的 `Seg_NNN`。新結果預設顯示生長、隱藏完整流線與粒子，CP2 控制可切換。
- JSON 結果新增選填 `presentation`，同步 coordinator 與生成型別，包含直接子 prim 清單、動畫設定、預留 sections 與模型座標 convex hull（最多64點）。USD customData 的 prim 清單以名稱為鍵的 dictionary 儲存，避免 USD 不支援異質 object array；公開 JSON 仍為陣列。

## 驗證狀態

本檔先記錄實作意圖；部署及新 run 截圖未完成前不宣稱真站改善。CP2 實測見 [控制驗證](cfd-presentation-controls-2026-10-01.md)。

- 初次離線 CFD tools 全套203項通過，包含 golden 與真 USD 可見性/循環/旋轉、種子簾、裁切、幾何上限和行進時間測試。
- coordinator 全套2490項通過；build、contract:check 與 viewer typecheck通過。
- 完整 streaming＋CFD root契約：899通過、8平台跳過、1未修改的程序樹 timeout測試失敗；該單測在無其他測試併行時隔離執行通過。首次失敗保留為 TEST_FAILURE，原因未證實，不將隔離通過說成完整套件全綠。
- 近期兩筆既有 run 均為240條流線，無「30條」重現證據，亦無第二個 track檔遺漏證據；歷史輸入未定位。此次不修改讀檔選擇。

## 剩餘驗收

獨立審查、PR與required check、合併及 canonical 部署後，執行一次 fast_preview 0° run；驗證層檔大小、track數、個別圖層ACK、播放與生長，並在可見 Chrome 截圖。原始私有專案影像留在ignored handoff。
