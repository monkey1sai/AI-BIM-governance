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
- 開發站既有45個方向的後處理摘要全部為240條流線（45/45），無「30條」重現證據，亦無第二個 track檔遺漏證據；歷史30條輸入未定位。此次不修改讀檔選擇。
- root全套1416項通過；viewer控制元件2項、typecheck/build/session-first通過。
- Spec審查發現合法growth_seconds=9.99可能把最後顯示sample寫到frame240，已限制在timeline末幀239並新增真USD邊界測試。metadata允許64個prim描述以容納後续13組切面；單次visibility命令仍維持32項上限。

## 剩餘驗收

獨立審查、PR與required check、合併及 canonical 部署後，執行一次 fast_preview 0° run；驗證層檔大小、track數、個別圖層ACK、播放與生長，並在可見 Chrome 截圖。原始私有專案影像留在ignored handoff。

## 合併後真站驗收

- PR #994 合併為 `4d8906a`，應跑 CI 與 pr-safety 全部通過，兩軸獨立審查無阻擋。canonical 開發部署 exit 0，Kit media gate 首次通過（42 ms video offer），後續 coordinator health 200。
- owner 可見 Chrome 使用原審查；重新 claim 後首幀、Stage Live、模型審查相符及命令通道可用。
- 新單方向 0° fast_preview 在第483步收斂。case_meta 確認 v2、240種子、8列、6秒生長；結果240條、47,951點、48段、1,440粒子，層檔14,055,027 bytes。
- 五種圖層均經面板顯示/隱藏取得Kit讀回；0.25倍重播起點與生長後畫面不同。重新套用後回1倍，暫停讀回8.17秒；原有完整流線和粒子預設隱藏。
- 暖機按鈕→可見Kit ACK量測763 ms。這是一次完整browser登記/套用的觀察，不是冷啟動或任意模型的效能保證。
- 關閉壓力外殼後原IFC建築清楚可見。模型SHA與run source相符，驗收前後模型與overlay檔案hash皆不變。已知的視覺差異仍保留：CFD壓力圖呈現的是簡化計算外殼，不代表原IFC細節已被保留或幾何精度改善。
- 私有原圖及run資訊只存本機ignored handoff，不加入公開repo。測試動畫只代表穩態解的呈現。

## 歷史30條資料的來源釐清

S3.1摘要的 `samples_dir` 與 `streamlines_dir` 明確引用S1.1算例；同一份算例的run record已於S1.1提交 `dd8e291` 留存。後續S3.1提交 `fac30bb` 才將 `CaseParams.streamline_seeds` 從30改240，將uniform種子改為8列cloud。可驗證的事實是「30條摘要引用較早的算例」；因此「240種子遺失210條」不是這份摘要能支持的結論。舊controlDict/VTK未取得，沿用舊30種子輸出是來源支持的推論，並非重新求解的證明；新真站算例已讀回240條，未修改reader。
