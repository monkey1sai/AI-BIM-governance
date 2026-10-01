# Primary viewer 建築中心導航

使用者要求：中鍵繞建築體旋轉、上下左右平移，以及更快拉近拉遠。此刀接在 CP7 後，不改已完成的方位／建築聚焦，也不改 CFD 求解或幾何。

## 行為與來源

- Kit app 原生 bindings 改為 `MiddleButton` tumble、`Shift MiddleButton` pan；streaming app 繼承同一設定。保留原右鍵 look/flight 與 Alt-right zoom，不把逐幀滑鼠操作轉成 REST 指令。
- Stage 已渲染並由既有 building framing 建立相機中心後，設定 native model `scroll_speed` 為每軸 0.075（原預設 0.025）。這是 3 倍係數；一次滾輪的實際位移依距離與 Kit 原生縮放曲線而變，不宣稱各距離位移恆為 3 倍。
- 禁用滑鼠 pick position 作為導航中心，避免 CFD 雲圖或流線改變旋轉中心。平移會移動目前焦點；按「建築主體」重設。鎖定或作者明確禁止旋轉的相機保留 Kit 限制。
- 啟用原生正交旋轉支援，不強制切換投影。相機仍由 Kit 寫 session layer；原 BIM 與 CFD artifact 不變。
- 視角面板新增操作說明與「讀取目前視角」，沿用已有 `camera_state` family 和 Kit readback；沒有新增 API、命令 vocabulary、環境變數或依賴。
- `blender_navigation.py` 集中存取目前釘住的 Kit 110 viewport layer lookup（`_find_viewport_layer`）；這是版本相依 adapter，升級 Kit 時須重新核對。找不到 model 或參數讀回不符只記 warning，不阻斷模型載入，也不能當導航成功證據。
- Spec 獨立審查指出 native 手勢結束會清空 object-centric mode。Adapter 對該 model 的原 getter 加入空值 fallback 0，避免下一次恢復 picked-point 偏好；用弱引用委派、只安裝一次，其他項目照原讀回。沒有改 class、vendor 或 persistent settings；新增三次結束／再開始的回歸。

## 修改前基準

在使用者可見 Chrome、同一既有結果與 primary viewer 實際操作：中鍵使位置由 `(57.23,-51.16,146.81)` 變為 `(38.53,-81.79,134.89)`，視線保持 `(-0.58,0.58,-0.58)`，確認是平移。

重設等角後，一次 `deltaY=-120` 原生滾輪，位置由 `(57.23,-51.16,146.81)` 變為 `(38.94,-32.86,128.52)`，約移動 31.68 模型單位。基準是相機讀回，不是 FPS 或主觀速度評分。

## 驗證狀態

- Streaming + root：修正連續手勢焦點後 2,307 passed、8 個平台 skipped、20 個既有 warnings；skip 不列通過。初版導航／相機／stage targeted 125 passed，最終完整回歸包含新增生命週期測試。
- Viewer：2,906 passed；相關 UI 22 passed、TypeScript、session-first 與 build 通過。build 的既有 bundle-size warning 保留。
- Canonical `scripts/deploy.ps1 -DryRun` exit 0。新增 config test 首次使用標準 TOML 讀既有 Kit generated lock 的重複 table 失敗，限定檢查 authored dependency prefix 後重跑完整回歸通過；未為此改 generated lock。
- 尚未完成獨立審查、合併、部署或修改後 Chrome 驗收。程式測試不能替代真正拖曳、縮放、相機中心及正交操作證據。
