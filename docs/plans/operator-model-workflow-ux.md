# 模型導向操作介面：第一版

日期：2026-09-14。狀態：隔離前端實作與 PR 準備；已觀測真實 Kit 模型畫面，尚未部署或完成完整 IFC／高亮／剖切驗收。以下各版保留當時證據，最新驗證見末節。

## 使用者結果

使用者不必理解 session ID、lease、Stage URL，便能找到模型、確認轉檔、開啟審查及辨識 3D 是否真的就緒。技術識別資訊保留在可展開的診斷區；不把健康檢查或指令 ACK 當成可見模型正確的證據。

## 操作分層

| 層次 | 使用者看到的內容 | 操作位置 |
| --- | --- | --- |
| 來源模型 | IFC 檔名、專案與版本 | 模型庫 `#minio` |
| 轉檔產物 | 來源 IFC 對應的 USDC、轉檔狀態 | `#minio`、轉檔紀錄 `#conv` |
| 審查紀錄 | 選定模型可用的審查；不是所有檔案清單 | `#a1` 的「選擇模型與審查」 |
| 3D 連線 | 操作權、畫面、指令通道、模型核對分開呈現 | 共用 Viewer 摘要與診斷 |
| 維運 | 審查管理、封存重建、Kit 狀態 | `#sessions`、`#runtime`、`#instances` |

同一模型可有多筆審查，所以審查數量不等於 IFC 檔案數量。選取模型不等於 Viewer 已切換。離開 3D 與永久結束審查是不同操作；保持既有確認與權限契約。

## 本版變更

- 總覽加入四步操作導引、名詞說明及占用／無畫面的恢復說明，明確標示導引不是即時進度。
- 模型庫、轉檔紀錄、審查管理與 Kit 實例頁使用同一殼層；保留既有路由與 API。
- 移除固定 Demo Project、無功能的搜尋輸入與假身分；主要導覽改為鍵盤可用的連結，規劃中功能預設折疊。
- 修正高特異性 reset 覆蓋嵌入元件樣式的問題；沿用 `--ab-*` 深色設計 token。
- 模型選取優先顯示檔名、專案與版本，另顯示來源路徑與可用審查數量。
- A1 的原始審查 ID 選單改為進階入口；保留全 ID 供精確識別，不自動 claim Viewer。
- Viewer 常駐顯示畫面／通道／模型相符狀態；Session、Kit、Stage、ACK 收進診斷。保留所有 runtime gating。
- 模型樹容器不再以 `aria-disabled` 連帶封鎖剖切與量測；各工具自身的就緒條件不變。
- 375px 導覽与總覽自適應、鍵盤焦點及 reduced-motion 樣式。

## 範圍與驗證界線

僅修改 `web-viewer-sample` 呈現／路由和測試；不修改 coordinator、governance、Kit、轉檔 API 或授權。不改已有 `.env`。工作區 `operator-model-workflow-ux`，預覽 `http://127.0.0.1:5180/ui#home`，不代理 Linux 的可變狀態。

本機瀏覽器已檢查總覽、模型庫、A1 未連線畫面及 375px 總覽（document clientWidth / scrollWidth 同為 375）。單元測試使用受控資料，不是實際 IFC／GPU 證據。production build 與完整 console 測試結果以本輪交付回覆為準。

## 後續實際驗收，不得宣稱已完成

1. 以兩份不同 IFC 核對來源、ready model、審查、實際 Stage 及可見幾何，排除僅換選單而未換模型。
2. 指定 Kit 上取得 first frame、DataChannel、正確 Stage；再目視核對高亮顏色與剖切前後畫面。
3. 真實占用／連線失敗／封存重建情境，確認回復路徑與錯誤文案。
4. 原有轉檔與 Kit 細節頁仍有工程術語；依使用者操作回饋繼續精簡，而非改寫後端狀態或捏造 telemetry。
5. 尚未更新或核准正式視覺 baseline；本版不可據本機預覽宣稱 Linux 已部署完成。

## 第二版：3D 畫面優先（2026-09-14）

- Panel 說明改為 `i`：滑鼠 title、點擊／鍵盤可展開；Esc 或焦點離開收起，不推擠版面。
- A1 的操作流程、步驟紀錄、剖切與量測預設收合。標題、IDS 欄位及按鈕 caption 縮減常駐高度；錯誤與重試仍可見。
- Viewer 的原始 Session 輸入、模型資訊、連線診斷改為小型展開入口；收到畫面／模型核對狀態仍保留。未出幀只顯示等待狀態，七軸資訊與診斷預設收起。live 語意／USD 側欄預設收合，尊重先前明確儲存的偏好。
- 中央工具列新增「全螢幕／退出」。採頁面內滿版，不呼叫原生 `requestFullscreen`：內嵌瀏覽器實測原生切換後不能穩定保留同一操作畫面。擴張既有 page-root，包含兄弟層 WorkspaceViewportHost；不 portal、不重掛 iframe、不 claim/release lease。背景導覽以 inert 隔離並於退出還原。
- Esc 在外層頁面可退出；游標焦點在跨來源 iframe 時，鍵盤事件不會冒泡到外層，使用固定保留的「退出」按鈕。不為此擴充 Viewer postMessage 契約。

### 本輪已觀測

| 驗證面 | 實際結果 |
| --- | --- |
| Codex App in-app browser `/ui#a1` | 說明點擊／Esc 收起；新版滿版可持續讀取且退出後恢复三欄。Viewer slot 由約 543×746 放大到 1301×848。 |
| 外部 Chrome `/ui#a1` | 滿版 1896×791；滿版中可點開說明，按退出及 Esc 均回到工作區；再展開剖切面板。 |
| Runtime／API | 本機預覽未接通 coordinator；真實 API 顯示 Failed to fetch。無本輪 session/lease/Kit ID、IFC fixture、first frame、Stage、DataChannel 或 ACK 證據。未嘗試搶佔／關閉 Linux Session。 |
| 確定性驗證 | `npm run typecheck`、`npm run test:session-first`、`npm run build` 通過；完整 `npx vitest run --silent` 137 檔／1912 項通過。最後加入背景焦點隔離後，重跑 presentation＋iframe ownership 2 檔／15 項通過，typecheck/build 再通過。 |
| 控制生命週期 | 受控 coordinator 測試確認同一 iframe、同一 src，滿版切換不增加 claim 且不 release。這是 client ownership 證據，不是真實 Kit 串流證據。 |

截圖位於本次 Codex visualizations 目錄 `2026/09/14/01a09db3-50be-7022-8b4a-687b67edfc71`：`viewer-help.png`、`chrome-viewer-fullscreen.png`、`chrome-viewer-controls.png`、`iab-viewer-fullscreen.png`。

已知界線：未驗證真實模型高亮／剖切；未驗證實際跨來源 iframe 在滿版中的 GPU 畫面；正式視覺 baseline 仍未核准。建置保留既有 >500 kB chunk 警告。熱更新新增 hook 時曾出現 React queue 錯誤，完整 reload 後恢復並完成上述操作；不把熱更新狀態當 production runtime 證據。修改未提交／推送／部署，主工作區仍乾淨且 main == origin/main。

## 第三版：左側控制、純模型視區與基底更新（2026-09-14）

- Viewer 控制與 Session／模型資訊／連線診斷移入左側；中央只保留原本同一個串流 iframe。工作區嵌入模式隱藏 iframe 內重複導覽、頁首與診斷；獨立 Viewer 入口保留原模式。
- 僅 Vite loopback 預覽使用當前本機 Viewer bundle，讓外層與嵌入畫面一起驗證；production configured endpoint、origin 驗證與 bearer 傳遞方式不變。預覽為 `http://127.0.0.1:5173/ui#a1`，API 指向原測試 coordinator，未修改 `.env`、Linux 或後端 API。
- 實際重現三個排版問題：外層 `.uc-root.scrollTop=207` 使頁首消失並露出底部背景；舊 `height:auto !important` 把 iframe 壓成 152px；內層視訊以原始比例長到 1059.75px，超出 827px 視區。分別以 fixed／overflow:clip、正確 CSS 覆蓋順序及限高 contain 視訊修正。外層量測已回到 scrollTop=0，視訊完整顯示，不以裁切模型填滿比例不同的視窗。
- 退出全螢幕的焦點還原使用 preventScroll；左側與右侧欄各自捲動，診斷仍可展開。

### Rebase 與保留證據

- 使用者指定 rebase 到 #832 的 `2437d006638730b5e03aa7f63ce788ec9c19079a`；工作分支 `feat/operator-model-workflow-ux` 已成功移至該 HEAD，沒有額外提交需要重播。
- 使用 `git stash push --include-untracked` 保存後，以 `git stash apply --index` 還原。39 個既有修改檔案與 stash 的 Git blob 逐一比對 39/39 相符，原 staged／unstaged 狀態保留。Windows checkout 的換行正規化會改變 raw file SHA，因此不將 raw SHA 差異當成內容遺失。
- 保留安全備份 stash `f54ee2cb362ca6e92548faebbdb9013aaff52d3e`；未刪除、未提交、未推送、未部署。

### 本輪瀏覽器與驗證結果

- 外部 Chrome 由 UI 選取 `ifc-test / v1`、開啟 `review_session_632a29f847b4`，再按「啟動 A1 3D Session」。Rebase 後再次連線並目視看到建築幾何；頁面顯示「已收到畫面／指令連線已連線／模型核對相符」。Kit 為 `kit_local_001`，新 lease 為 `viewer_lease_f33e1533c4e7e885`。
- 診斷已觀測 first frame、DataChannel ready、expected == loaded；模型 Stage 為 `stream_conv_20260904104745_d779fe7e/model.usdc`。原始 IFC 檔名／存在性未由此回應提供，因此本輪不宣稱完成原始 IFC provenance 驗證或兩份 IFC 切換驗收。
- 實際送出 Z/+ /0 剖切並收到「設定已套用」回覆，再關閉並收到「剖切已關閉」。這是命令與回覆證據，尚未建立可辨識的剖面前後圖片對照；高亮、量測與完整 Stage 樹仍未驗收。
- Rebase 後全螢幕模型截圖：Codex visualizations 的 `2026/09/14/01a09db3-50be-7022-8b4a-687b67edfc71/chrome-clean-model-2437d00-fullscreen.png`。Chrome 分頁保留供使用者操作；用完以左側「離開 3D 檢視」釋放該連線。
- Rebase 前最終 typecheck、完整 Vitest 138 檔／1916 項、build、session-first、struct-log 23 項、diff check 全部通過。Rebase 後 typecheck／build 再次通過；完整測試重跑因工具自動審核服務 capacity 錯誤未能啟動，不列為通過。保留既有大於 500 kB bundle 警告，正式 design baseline 尚未核准。

## PR 前驗證更新（2026-09-14）

- 使用者授權開 PR；本輪重新執行 `npm run verify`，typecheck、production build、完整 Vitest 138 檔／1916 項與 struct-log 23 項全部通過，補足 rebase 後完整測試的缺口。
- `npm run test:session-first` 通過；`node --test .github/scripts/pr-safety.test.mjs` 8 項通過。完整 lint 未執行；建置仍有大於 500 kB chunk 警告，測試保留既有 React act／SSR 警告。
- 本輪 PR 準備未重新操作 GPU；上一節記錄的是同日、同一 rebase 後前端的手動瀏覽器證據，不等同本輪重新執行自動化 browser E2E。高亮、可辨識的剖切前後對照、量測、Stage 樹及兩份 IFC provenance 仍未驗收。
- 保留使用者指定的 `2437d006638730b5e03aa7f63ce788ec9c19079a` 基底，不因 `main` 後續前進而自行再次 rebase。PR 僅包含前端、測試及此紀錄；無後端 API、資料結構、環境變數、migration、部署或排程變更。新增 `presentation=workspace` 僅控制嵌入 Viewer 的 UI，不提供操作權。
