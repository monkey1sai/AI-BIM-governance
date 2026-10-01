# CP7 真北來源與羅盤

來源：`docs/plans/cfd-presentation-parity-contract.md` N10.1/N10.2、D6、R1。程式驗證通過；部署後真站證據待補，不能把下列自動測試當成可見 runtime 通過。

- Streaming 新增內部唯讀 geo-reference route；只讀同一 conversion 已登錄 sidecar，限制 job artifact 根目錄、256 KiB 與 SHA-256，回傳北向白名單。舊轉換沒有 sidecar 時回傳未知；不用重轉。
- Coordinator 新增 browser `GET /api/conversions/{conversionJobId}/geo-reference`，固定上游 URL、拒絕 redirect，回傳 `GeoReferenceSummary`，不暴露位置、路徑或 artifact URL。未知 job 404、損壞/無法取得 502、逾時 503。
- `available` 描述 MapConversion 是否存在，與 IFC TrueNorth 是否可靠分開；有限且來源明確的非預設 IFC 真北才為 reliable。缺失/預設 `(0,1)` 不能宣稱可靠。手動真北不寫回模型。
- 沒有疊圖時取目前 conversion；套用 CFD 後以該結果 wind_frame 為準，缺角度的舊結果不推測。換模型丟棄延遲回覆。
- IFC 真北為從模型 +Y 逆時針的角度，camera heading 為順時針；羅盤參考 heading + north，來風箭頭沿用 model bearing − camera heading，不重複套用北向。
- 無可靠來源顯示「專案北（真北未知）」；可靠來源標 IFC／手動。可見 HUD 與 PNG/WebM 使用同一 painter。

## 已執行驗證

- Coordinator：2,504 tests passed；build 與 OpenAPI contract check 通過。
- Viewer：2,903 tests passed；TypeScript、build、session-first 與 structured-log（23 tests）通過。
- Streaming + root contracts：2,299 passed、8 個平台 skipped；skip 不列通過。既有 IFC/Starlette warnings 保留。
- 新測試涵蓋 identity、缺失/預設/可靠分類、artifact 變更、404/502/503、換 conversion 舊回覆與真北角度只計一次。
- 全套回歸後的審查补修：IFC/manual `-15°` 正規化為 `345°` 供羅盤使用，原結果與風向換算保留；後端 geo-reference 11、前端方位 34、authority 48 項 targeted checks 通過（不把它們重複加進全套計數）。
- 未改 CFD 結果、模型 artifact、求解方式或既有方位/聚焦邏輯；沒有新增環境變數、排程、Webhook 或 migration。

## 真站限制

現有測試模型缺少可靠 IFC 真北，部署後將驗未知 fallback 與疊圖/匯出一致性。可靠 IFC 與手動角度由自動測試驗證，不能宣稱已用真站算例驗證；不為此偽造模型 metadata 或啟動新求解。
