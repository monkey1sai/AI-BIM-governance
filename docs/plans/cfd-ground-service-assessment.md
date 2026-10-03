# 已保存地面與算例的服務端準備核對

本切片將既有離線地面診斷接入服務端來源權威，不能據此宣稱修正行人風場。地面仍是已確認的原模型面選取，不是完整計算地形或可步行面。

## API 與權威

`POST /api/review-sessions/{sessionId}/ground-surfaces/selections/{selectionId}/engineering-assessment`

請求只接受 `source_run_id` 與 `[0,360)` 的 `wind_from_degrees`。拒絕 caller 幾何、檔案路徑、URL 與批准欄位。Coordinator 要求目前實際 primary lease、來源 Stage 與已保存選取版本；CFD ledger 只預檢 run/conversion，不作 native status 的 fallback。await 前後核對 principal、conversion、primary ID/URL、lease、client、binding revision、完整選取版本與 run/conversion 指向，改變即 409。此操作不保存報告或修改 Stage。

Streaming 以 fresh model bytes 核對原面，並讀取 server-owned run 目錄的固定 metadata：`run.json`、`result.json`、`run_record.json`、`exclusions.json`、指定 `case_wNNN/case_meta.json`。只用同次 bytes 計 hash 與解析，不使用 metadata 中的 path。result 的 hash 綁定 aggregate/exclusions，再由唯一 ready 方向的 outputs hash 綁定 case。來源、run、指定方向或已宣告 hash 不符時拒絕；歷史缺 hash 連結則保留 unknown，不能重新造歷史權威。Native tag 採 Python ties-to-even rounding，再 modulo 360；coordinator 語意檢查採同一規則。

回覆 `cfd-ground-service-assessment/v1` 固定 `HELD`、`source_bound_metadata_only`。可確認 fresh source/faces、保存 ledger 與 metadata 連結；`actual_ground_verified`、`fluid_region_verified`、`inlet_boundary_files_checked`、`velocity_sampled`、`solver_started` 固定 false。選取 Z 範圍加 1.5 m 只是相對地面目標位置，尚未證明其落在計算流體區，也不是新的速度結果。舊 plane 與目標高度差保留於報告；缺 case 時為 null。

## 執行邊界

- Internal token fail closed，驗證在 source/body 讀取前；沿用既有設定，不新增 credentials。
- Request 8 KiB；各 metadata 2 MiB；最多五個固定檔，讀取後與第二次模型核對後各再驗一次已讀 bytes，共十五次／30 MiB。未綁定的歷史檔案不讀。JSON 拒絕重複鍵、非有限數字與深度超過 64。
- Fresh USD 與面核對沿用既有 model bytes 上限，metadata 完成後再核對一次；single-flight assessment，忙碌回 429，失敗釋放 admission。
- Report 512 KiB，transport 在 JSON parse 前限制 bytes、取消超量 reader，禁止 redirect。
- 不讀 mesh、U/p、boundary，不重採樣、不啟動容器／求解；無新 UI 或 mutable profile DB。

## 驗證與後續

本機測試覆蓋完整 native hash chain、缺鏈 unknown、hash/source/run/direction 替換、重複或失敗方向、tag collision、symlink 逃逸、JSON 與 bytes 上限、fresh source 變動、busy/lock release、primary/spectator/missing/wrong/expired lease、await 內原地權限與版本變動、公開 pair 維度及 gap/tag/link 語意。無權限呼叫與未保存選取應在 upstream 前拒絕；成功準備回覆也不得改 source、run、ledger 或 binding。

服務端切片部署後應以 native metadata 與原模型核對服務執行，並在可見 Chrome 回歸已保存版本與原 Stage。Chrome 原流程回歸不能稱新 API 的正向 HTTP 驗收。

## 面板核對入口（服務端之後的 UI 切片）

已保存地面面板提供「來源 CFD 算例 ID」「來源風向（來向，度）」及「核對地面與算例來源」。沿用 pane-owned client 的現有 session／primary lease 權限；面板不讀取或接收 credentials。必須先讀回保存版本並保持 Viewer 就緒，才可對既有算例核對，不建立新算例。

成功回覆仍明示 `HELD`：來源核對與工程驗證是不同結果。顯示原面 Z、相對 1.5 m 目標 Z、舊平面與高度差，以及 metadata 連結的 verified／unknown；缺歷史連結或高度維持未知。所選構件遭排除、平坦地面差異及選面高程變化應明示，不能把報告當成新速度結果。

session、來源、保存版本、輸入或 Viewer 就緒狀態改變時清除舊報告；失敗不保留先前成功報告，過期回覆不得重新出現。單次只接受一個核對請求；不自動重試。狀態區固定 64 px、報告區固定 260 px 並可捲動，文字增減不能推移控制項。部署後須在可見 Chrome 以原生控制項及實際權限完成正向 HTTP、拒絕後清除／手動重試及固定布局驗收；模擬回覆測試只供回歸參考。

正式工程後續仍需完整地形／wall 幾何、入流地面基準、mesh/time 與有效流體驗證，再使用 `z_surface + 1.5 m` 取得真正速度。新網格或求解前另外提出資源、停止與保留條件；不重用已耗盡探針預算。
