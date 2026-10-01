# CP7 真北來源與羅盤

來源：`docs/plans/cfd-presentation-parity-contract.md` N10.1/N10.2、D6、R1。程式驗證通過；2026-10-01 在使用者可見 Chrome 完成現有模型的未知真北 fallback、結果 HUD 與 PNG 核對。可靠 IFC／手動真北的真站算例仍未驗證。

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

- PR #1007 合併 `7bf021e1d011a1159b7338419cbb45545733e5a1`；canonical 部署 `deploy-20261001-639264439215044678-012` exit 0。求解 guard clear；本輪 Kit media gate 17:31:55 通過，含 video track offer 43 ms；coordinator health 正常。
- 在使用者 Chrome 的既有專案審查重新 attach primary viewer；首幀 1920×1080、readyState 4，畫面與審查模型相符。
- 未套疊圖時，geo-reference summary 為 `available=false`、`true_north.status=missing`，羅盤文字「專案北（真北未知）」且 `data-north-source=unknown`。
- 套用現有 `158afc` 結果後，Kit 確認新 binding revision；HUD 採結果的 0°、project north，north-source 仍 unknown。把未送出表單切成手動真北後，HUD 不變，隨後復原表單。
- 本輪 PNG 匯出 UI 確認 1920×1080；本機原始圖片保留相同結果、圖例與「專案北（真北未知）」。截圖、PNG 與 run/binding 識別保存在 git-ignored `.superpowers/handoff/cfd-true-north-live-20261001/`，不公開模型資料。

現有測試模型缺少可靠 IFC 真北。可靠 IFC 與手動角度由自動測試驗證，不能宣稱已用真站算例驗證；不為此偽造模型 metadata 或啟動新求解。
