# CP6 本機 PNG 與 WebM 匯出

console 只在已套用結果有 HUD 時提供匯出。viewer 使用 WebRTC video 原生解析度與既有 HUD painter 合成 PNG，或用 canvas stream 以 30 fps 錄製 1–20 秒 WebM（VP9 退 VP8）；不讀取 form 尚未送出的值，不上傳或寫入伺服器。

## 邊界與失敗處理

- iframe postMessage 維持來源 origin、frame、request ID 驗證；回傳 Blob 限 128 MiB，檢查 MIME、副檔名、尺寸和檔名，拒絕 credential 欄位。
- 換 session、run、revision、HUD、串流失效、iframe reload、unmount、取消或逾時均丟棄未完成檔案。
- 錄製只停止自己建立的 canvas tracks，保留 WebRTC source tracks；object URL 在下載後或離開元件時釋放。
- 沿用目前播放狀態；要從頭錄製可先按既有「重播」。畫面移動可錄入，結果切換會取消。

## 驗證與待辦

- 擷取回歸涵蓋原生尺寸、同 HUD painter、VP8 fallback、revision 改變、取消及 source tracks 保留。
- console 回歸涵蓋完成後才下載、連點不重複啟動、取消與 unmount 後遲到結果不下載。
- Embed protocol／橋接測試涵蓋 Blob 欄位、origin／frame／request ID 與 reload 取消。
- 已執行 viewer 完整單元測試、typecheck、build；最終候選及獨立審查另依 PR 紀錄。
- 2026-10-01 16:03–16:15，owner 的可見 Chrome 在 canonical 181 真站完成以下驗收。部署版本為 `c8424d27a7c642335586bb628bc1a4586cac8d24`（PR #1005），重新載入頁面後使用既有完成結果，未啟動求解。
- PNG 實際下載並解碼為 1920×1080；畫面含風速圖例、來向、北向基準、用途、screening、run 短碼和 UTC。表面壓力經 Kit 確認顯示、透明度 0.35 後，另一張 PNG 也包含壓力圖例。
- 5 秒 WebM 實際下載；VP9、1920×1080、30 fps、150 幀。完整解碼 exit 0；封包 PTS 由 0 到 4.976 秒，最後封包長 0.033 秒，編碼長度 5.009 秒，時間戳嚴格遞增。檔案未帶 duration header，長度由封包計算。
- 20 秒錄製中取消，以及另一輪錄製中切換到既有結果，均未新增下載檔案。取消後 source video 仍為 readyState 4、未暫停或結束，currentTime 由 173.271 增至 204.011 秒。
- Chrome connector 的 `waitForEvent('download')` 對 PNG 逾時，但 UI 回報檔名與 Downloads 中實際檔案一致；以上通過依據為檔案及解碼，未將工具事件當作通過。
- 原疊圖 SHA-256 仍為 `f88e9b5b317c556c960111ab275d3ccfe448eb7e1315412a5199b8f46fda5099`。含真實模型的截圖、PNG、WebM 與操作紀錄僅存本機私有交接目錄，不提交公開 repo。

## 本次證據的限制

- 片中氣流仍是穩態解的示意動畫；匯出完成不代表非穩態 CFD 或物理時間同步已交付。
- owner 同時觀察到側視時行人面高於地面。原疊圖為 Z-up、1 m/unit，行人面 35,495 個頂點的 Z 範圍為 1.488235–1.509198 m，符合現行取樣高度約 1.5 m；它不是貼地材質。已在可見 Chrome 隱藏該層改善側視，未移動取樣幾何或修改數值。固定計算地面是否適用於每處實際地坪尚未驗證。
