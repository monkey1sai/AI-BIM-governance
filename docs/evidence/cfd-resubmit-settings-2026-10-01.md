# CFD 重送設定恢復修正

## 問題與原因

可見 Chrome 真站驗收時，快速預覽結果按「用這組設定重新送出」，表單仍顯示標準組，估算格數與耗時隨之增加；確認前取消，沒有送出錯誤設定的計算。

`settingsFromOrigin` 已讀取完整 catalog origin，卻只更新面板可見欄位，漏掉外圍放粗等預設組管理的隱藏參數。結果沿用目前表單狀態，與記錄設定不同。

## 修改

同時恢復標準預設組列出的隱藏 catalog 參數。記錄有值時逐字沿用；缺值或 null 沿用契約的標準預設回退。可見欄位既有 nullable/default 行為保持不變，不靠 preset 名稱猜參數。

## 驗證與限制

- 最小回歸在舊程式重現：預期外圍放粗 1，實際 0；修正後設定與面板 69 tests pass。
- 覆蓋快速組、標準組、缺值、null、客製隱藏參數；面板確認後實際 createRun 請求帶回記錄值。
- 完整 viewer 188 files／2870 tests pass；TypeScript 與 production build 通過，既有 React act 與大 bundle 提示保留。
- 原真站觀察是缺陷證據；修正版需合併部署後核對表單與預估，尚未驗證。
- 不修改 API/schema、solver、歷史 ledger、artifact 或部署設定。
