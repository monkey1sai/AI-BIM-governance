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
- 部署後使用者可見 Chrome 實際 PNG／WebM 下載、解碼、尺寸及時長：待驗證；單元測試不取代真站驗收。
