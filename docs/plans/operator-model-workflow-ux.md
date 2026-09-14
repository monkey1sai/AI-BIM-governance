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

## PR #833 整合與現場驗收進度（2026-09-14）

- 使用者授權把 #833 併入 #835。已在同一分支合併 `107f2638938e21f9c3f3c42057f6bed6c26311b1`，merge commit 為 `b78737591c986f195cfab887109859fe50451db3`；未合併 main、未部署 Linux。此後範圍包含 streaming 的 IFC 基礎材質轉換，不再僅限前端。
- #833 的 UsdPreviewSurface／材質綁定在新轉檔才生效；目前 Kit 的既有 USDC 不因本機前端更新而取得新材質，不得宣稱基本上色已通過。
- 整合後 streaming 材質、highlight overlay、conversion facts／authority 測試 77 項通過；host-native identity／fallback 篩選測試 27 項通過、120 項未選取。保留 IfcOpenShell fixture destructor 警告。`scripts/deploy.ps1 -DryRun` 通過，沒有實際部署。
- 前一輪 Chrome 操作 `review_session_632a29f847b4` 實際取得兩點距離 `58.561 m`；Z/+ /5 剖切時地面及下方幾何消失，關閉後還原。圖片為 `pr835-measurement-58m.png`、`pr835-section-z5.png`、`pr835-section-off.png`。距離尚未用已知尺寸校準；使用者表示沒有看到現場變化，因此不能以這批歷史截圖完成本輪現場驗收。
- 同一審查的 A4 session 查詢實際收到 HTTP 409、`a4_session_model_unavailable`。前端新增此既有安全錯誤碼的辨識與模型／轉檔關聯修復指引；不放寬後端查詢、Stage、來源或簽章 proof gate。四個檔案的改動已經過先紅後綠測試；当時完整 verify 為 138 檔／1918 項及 struct-log 23 項通過。

### 本輪新發現：Viewer 被隱藏

- 已透過 Chrome `Page.bringToFront` 把既有分頁帶到前景；中央空白，但側欄顯示 first frame／Stage 相符。重新離開再啟動仍重現。
- 唯讀 DOM 證據：`live-3d-viewer` iframe 為 `visibility:hidden`、矩形約 2×2。這是前端畫面插槽失效，不能歸因為使用者操作或以狀態就緒宣稱模型可见。
- `WorkspacePage` 同時用 callback ref 與 effect cleanup 清空 slot；effect replay／熱更新可在 DOM 尚連接時清空註冊。新增 StrictMode 回歸測試，修改前精確重現 `slotEl === null`；移除重複 cleanup、保留 ref(null) 真正卸載清理後，插槽／iframe ownership／publication 共 39 項通過。
- 修正後已完整 reload 本機 Chrome，Z/+ /5 剖切與關閉都產生可見變化；使用者明確回覆「有，看到剖切了」。截圖為 `pr835-live-section-fixed-on.png`、`pr835-live-section-fixed-off.png`。工具審核仍間歇出現 capacity 錯誤，但不再以此否定已取得的現場證據。未注入假的模型、顏色、first frame 或 ACK。
- 當時完整 `npm run verify` 通過 138 檔／1919 項及 struct-log 23 項；後續新增測試數見下一節。仍待驗收：基本材質上色、真實高亮、Stage 樹、兩份具備來源證明的 IFC 切換及已知尺寸量測。

### 上色／高亮續驗與審查同步修復（2026-09-14）

- 唯讀 API 核對：`review_session_632a29f847b4` 所屬的 `ifcready_1788518865046_30637b69` 已查無紀錄。IFC-ready 清單當輪僅有 1 筆，不把另一个模型的工作紀錄拼接到此舊審查，也未放寬查詢權限或來源 gate。
- 透過 Chrome 正常選取圖書館模型 `mw_010792d2cce6bf9b`、版本 `24e598ab-be3d-4dbb-a1aa-60b0ba610618`、審查 `review_session_fd48be0a3fff`。重現「開啟所選審查」只更新右側 A1，而左側共用 Viewer 仍保留舊 Session 的 bug。
- `A1GovernanceWorkbenchPage` 只在明確開啟且 coordinator 確認後，同步 `activeSessionId`；不改 `publishViewer` 的一次播種契約，不因模型選單瀏覽或 Dock 重掛搶走 Viewer。切換會失效舊 gate／Stage，仍須手動 claim。新增舊目標及顯式清空兩個回歸案例，先紅後綠；Chrome 再按同一開啟按鈕，左側成功同步到圖書館審查。
- 來源由 MinIO 選單鎖定已下載的 `ifcready_1788856952485_dc468775`；`POST /api/governance/rule-runs/for-session/:sessionId` 真實完成 `rr_e5c4783633d7`：68 個 failed 構件、0 個無法定位，沒有建立新 Issue 或更改整改狀態。
- Chrome 實際啟動取得 `viewer_lease_9962f2f14a347572`，Kit `kit_local_001`；first frame／DataChannel 已觀測，expected == loaded 為 `stream_conv_20260908084233_4bbe0d28/model.usdc`，source IFC／USDC／mapping 健康均為 true，目視可見灰色圖書館幾何。
- 實際按「在模型中顯示問題」送出 68 個 path，但 `highlightPrimsResult` 回覆 error、applied_paths 為空：`Python argument types in None.None(Layer) did not match C++ signature: None(pxrInternal_v0_25_11__pxrReserved__::SdfLayer {lvalue})`。「關閉問題高亮」亦收到相同錯誤。沒有可見上色，不列為通過。
- 唯讀核對運行中 Linux Kit commit 為 `79534ca75a876a2f6ea06a5aea87100520b1dc0b`，部署 source 尚無 #833 的 `ifc_surface_materials.py`。未部署新版轉檔，因此基本材質上色仍待新版轉檔／Viewer 驗收。
- 相同 Linux Kit Python／USD 25.11 在獨立子程序中，記憶體 Cube 的現有 `HighlightOverlay.replace`／`clear` 成功。這只縮小到運行中 Kit 狀態／綁定環境，不證明真實串流高亮修好；尚無完整 traceback 可定位到單一程式行，未以猜測修改 USD 綁定或吞掉例外。
- 新修復完整 `npm run verify`：typecheck、build、138 檔／1921 項及 struct-log 23 項通過。另針對 A1／ReadyReviewSessions／publication／iframe ownership 4 檔／65 項通過。保留既有 act／SSR 與 chunk 警告，完整 lint 未執行。
- 本輪沒有更動 Linux 程式、重啟 Kit 或正式重建。基本材質與高亮仍是未完成項目；canonical 部署須由已合併的 freshly fetched `origin/main` 執行且另行取得部署授權，不能直接覆蓋 live Kit 驗收。

### 高亮失效 Layer 的可重現修復（2026-09-14 續驗）

- 延續 `feat/operator-model-workflow-ux`／PR #835，未重建分支、未重新 rebase、未合併 main。原先 9 個未提交檔案保留；新增 streaming overlay 的最小修復及測試。
- 最小回饋迴圈：建立記憶體 Stage、成功高亮、釋放 Stage，再清除或對新 Stage 高亮。`GetSessionLayer()` 留下的 Python handle 不是 `None`，但其 C++ Layer 已失效，`bool(owner)` 為 false；讀取 `owner.subLayerPaths` 就拋出相同的 `None.None(Layer)`／`SdfLayer {lvalue}` 錯誤。
- Windows USD 26.5 與現有 Linux Kit USD 25.11 均重現；Linux traceback 精確指向部署版 `highlight_overlay.py:14`。Linux 僅用已安裝程式及獨立 CPU Python 子程序重現，沒有修改或重啟 Kit；這不是擷取運行中 Kit 的完整 traceback，也不是候選修復的 GPU 驗收。
- `HighlightOverlay.clear()` 改用 USD handle 有效性檢查，僅對仍有效的 owner/layer 移除自有 sublayer。失效 owner 的 composition 已不存在，釋放本地紀錄即可；不以廣泛 catch 吞掉有效 Layer 的寫入失敗。
- 回歸測試先紅後綠：已關閉 Stage 可重複清理、直接換到新 Stage 可高亮並完整還原；有效 Layer 被禁止編輯時仍拋錯、保留 ownership，恢復編輯權後可重試。
- 本輪確定性驗證：`test_highlight_overlay.py`＋`test_stage_management_runtime_authority.py` **57 項通過**；材質／conversion facts／authority 另開 pytest 程序 **66 項通過**。合併到同一程序會被既有 pxr stub 污染；首次 tmp_path 權限失敗後，使用本次允許寫入的全新 basetemp 重跑成功，沒有更動 ACL。保留 IfcOpenShell destructor 警告。
- `npm run test:session-first`、`pr-safety.test.mjs` **8 項**及 diff whitespace 檢查通過。前端本轮沒有新增修改；上輪同一前端差異的完整 verify 為 **138 檔／1921 項＋struct-log 23 項**。本輪完整 verify 被自動工具審查服務 capacity 錯誤阻止啟動，不當成本輪通過；本輪 deploy DryRun 因 sandbox Git ownership 無法取得 revision 而未完成。
- 完整圖書館 CPU probe 使用本機 52,441,473-byte IFC，SHA-256 `8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce`，未證明與現場 MinIO 物件完全一致。執行被 sandbox network policy 中止，僅留下未完成 `model.usdc`，沒有成功報告；不載入 Viewer、不註冊 session、不列為材質驗收。產物與 probe 保留在本次 Codex visualizations，不提交 IFC／USDC。
- 工具審查另拒絕把完整候選 overlay source 經 SSH stdin 傳到 Linux；未繞過此拒絕。因此 Linux 候選程式測試、Chrome 材質／高亮開關與還原仍未完成，需要明確的受控傳送／驗證範圍；正式部署仍是另一授權邊界。

| 驗收項目 | 狀態與剩餘條件 |
| --- | --- |
| 剖切 | 已有 Chrome 開關對照及使用者確認；保留，不回退成未驗證。 |
| 基本材質 | 小型真實 IFC 轉檔／reload／高亮還原測試通過；完整圖書館與 Chrome／RTX 未通過。 |
| 問題高亮／清除 | 已重現過期 Layer 缺陷並完成本機回歸修復；現場仍是舊部署，候選 Linux／Chrome 未驗證。 |
| 量測 | 已有兩點數值操作；已知尺寸與單位校準尚未驗證。 |
| Stage 樹／兩份 IFC 切換 | 完整來源、正確 Stage、實際不同畫面仍待驗收。 |

PR 保持部分交付／待實機驗證；測試、人工核准、merge 與 deploy 分別取證，不以重建或綠燈代替真實高亮畫面。

### 已授權的 Linux 候選 CPU 驗證（2026-09-14）

- 使用者明確授權把 PR #835 `highlight_overlay.py` 傳至 `192.168.20.181`，僅由 SSH stdin 載入獨立 CPU Python 程序記憶體；不落地、不重啟既有 Kit、不修改 canonical 部署。
- 候選為 `58b50af07275538e87d6ba138d849394e95e324a`，傳送 source SHA-256 為 `4c74bfc62d0682d3534574d17c63b78102a3536bd34077fe441aaa2246457a7e`，本機檔案與 Linux 收到的內容一致。使用現有 Kit Python 與 USD **25.11**，`-B` 禁止產生 bytecode。
- 四項檢查全部 PASS：過期 owner 直接換新 Stage 後高亮／還原；過期 owner 重複 clear；先 clear 再換新 Stage 高亮／還原；有效 Layer 禁止編輯時保留錯誤及 ownership、恢復權限後重試成功。另確認 USD 材質 diffuseColor 為紅色、clear 後無高亮 binding，root/session layer 與原始內容相同。
- 部署版 overlay 檔案前後 SHA-256 均為 `8ca1622e641786efecdb16020b83f3216b862865de9453e4ac90fc4b996b4ef1`；既有 Kit PID **2440160**、啟動時間 **Mon Sep 14 11:33:48 2026** 前後一致。無 deploy/restart，未將候選加入現有串流。
- 這補足 Linux 候選修復的 CPU 相容性證據；不取代真實 IFC、Chrome／RTX、first-frame／Stage／DataChannel／ACK 驗收。完整图書館材質、畫面高亮與還原、量測校準、Stage 樹及兩份 IFC 切換仍照表待驗收。
- 使用者要求先 commit 再繼續本機驗證；本段為該 checkpoint，不宣稱整個 PR 已完成。

### Commit 後本機續驗（2026-09-14）

- 先以 `cfe03772fa896d97091a1969d6f9d5330b659c9c` 提交上一節 Linux CPU 證據，再執行本節驗證；沒有部署、重啟 Kit 或改變既有 runtime source。
- 本機重新執行 `web-viewer-sample` 的 `npm run verify` 全部通過：typecheck、production build、Vitest **138 檔／1921 項**、struct-log **23 項**。此輪已補足上一節工具容量錯誤造成的完整重跑缺口；完整 lint 未執行，保留既有 React act／SSR 及大於 500 kB chunk 警告。
- 完整圖書館 IFC 在獲准的本機執行環境中成功轉檔，輸入 **52,441,473 bytes**，SHA-256 `8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce`。直接呼叫現有 `ifcopenshell_openusd_fallback` 的 CPU probe，使用 USD **26.5**，不是 production intake/profile 的端到端證據，與現場 MinIO identity 仍未完成比對。
- 成功輸出 `model.usdc` **5,422,457 bytes**，SHA-256 `328d825b082d896e491637855d7b04b8bed7ca6adb1869a8c2d55d5b36057d8d`：**6,770 Mesh、63 材質、8,266 個含 subsets 的綁定目標**均完成材質檢查；63 組不同 surface 中，59 組來自 `ifc_geometry_style`，4 組為 `display_default`。
- CPU probe 對前 **68 個 Mesh**套用紅色高亮並檢查材質值，再 clear；所有原始材質、root/session layer 內容均還原，來源 IFC 與磁碟 USDC 雜湊不變。這 68 個是測試抽樣，不是 `rr_e5c4783633d7` 的 68 個規則失敗構件，不混用為問題高亮驗收。
- 成功報告與完整產物保留於本次 Codex visualizations 的 `pr835-library-cpu-cfe0377/`；先前失敗輸出仍保留作紀錄，不作有效模型使用。沒有上傳、註冊 session 或提交 IFC／USDC。
- 外部 Chrome `http://127.0.0.1:5173/ui#a1` 按「啟動 A1 3D Session」後，`review_session_fd48be0a3fff`／`viewer_lease_0f21a21b5d803aea`／`kit_local_001` 取得真實 first frame、DataChannel ready 與 expected == loaded；Stage 仍為現場舊產物 `stream_conv_20260908084233_4bbe0d28/model.usdc`，目視可見灰色圖書館。截圖 `pr835-chrome-cfe0377-library.png` 保存在同一 visualizations 目錄；不是新版轉檔材質或候選高亮的 RTX 證據。
- Stage 樹按「重整」後，當輪瀏覽器日誌確認送出 `getChildrenRequest`，`prim_path=/World`、`filters=["USDGeom"]`，session／trace 與圖書館一致；UI 持續「等待 viewer」、沒有節點。尚未定位回覆缺失／空樹的確切原因，不能列為通過或只歸因使用者操作。
- 驗證結束按「離開 3D 檢視」，頁面回到「尚未啟動 3D」，本次 iframe 移除、控制項停用；未終止 Review Session 或干預其他連線。

目前新增通過：完整本機 IFC 的 CPU 材質／高亮還原、Linux 候選 CPU 相容性、當輪完整前端 verify 與 Chrome 真實連線／模型顯示。仍待驗收：候選程式及新產物的 Chrome／RTX 基本材質與問題高亮／清除還原、量測校準、Stage 樹、兩份具來源證據的 IFC 切換。剖切保留使用者已確認的歷史證據。
