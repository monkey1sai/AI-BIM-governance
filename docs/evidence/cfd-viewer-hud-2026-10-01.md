# CP5 Viewer HUD

## 實作與邊界

- 結果新增選填 `wind_frame`，記錄求解實際使用的真北角、來源及風向基準；同步 JSON schema、coordinator Zod/OpenAPI 與 viewer 型別。舊結果保持有效，不回寫既有產物。
- HUD 只取已套用結果的圖例、風向、用途與精度等級，不讀可編輯的送出表單。父視窗須取得 Kit applied 且 secondary layer confirmed；iframe 再驗證 parent source/origin、payload 與目前 binding revision。
- `overlay_hud` 沿既有 vg01 通道。隱藏、換 run、viewer ready 失效或 iframe 重載清除；ready 恢復不重用舊 ACK。壓力圖例僅在該 prim 有顯示讀回後出現，其他圖層讀回不覆蓋其已知狀態。
- Canvas 共用繪製器使用與 USD writer 相同的五個色階端點，讀結果範圍與單位；常駐設計比較用、validation、run 短碼、風向基準、UTC 及穩態示意說明。HUD 不接收滑鼠輸入，相機讀數沿用既有羅盤 feed。
- 風向箭頭指向風的來向；八個共享案例同時驗證 Python 求解座標与 TypeScript HUD 換算。舊結果沒有可靠角度時不猜真北；缺 validation 標示「未提供」。羅盤仍標專案北，真北模式屬 CP7。
- 本切片沒有 Kit 新命令、匯出功能、iframe sandbox／credential／部署流程或求解設定變更。PNG/WebM 留待 CP6。

## 本機驗證

- 修改前 viewer 四組基準 137 passed。
- viewer typecheck、build 通過；完整 Vitest 190 files／2884 passed；coordinator build 與完整 Vitest 154 files／2491 passed。
- root contracts 1416 passed；wind/job service/runner/CFD契約 96 passed；完整 CFD tools、options estimate及conversion authority 325 passed。Python 僅既有 Starlette deprecation warning。
- 新增 ACK 前隱藏、壓力讀回、重載清除、錯來源／錯revision拒絕、Canvas尺寸／相機更新／資源釋放及結果色階測試。
- `lint:baseline` 未通過：main 與本分支同為18項／2個新增指紋（既有 IFC intake hook 及 CP2 presentation component），本次 HUD changed files 無新增訊息；未修改 baseline 或放寬規則。
- viewer 既有 React act／SSR warnings 及 bundle size warning 保留；未以此聲稱 runtime 失敗。

## 真站驗證

尚未驗證。待獨立審查、required check、合併與 canonical 部署後，在可見 Chrome 以已存在結果驗證圖例／來向／頁尾、壓力開關及清除，並保存去識別結論。本機 Canvas 測試不能替代此項。
