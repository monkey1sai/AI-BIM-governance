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

### Merge 前續驗：Stage 樹修復與本機隔離環境（2026-09-14）

- 使用者要求驗證成功才準備 merge；PR #835 保持 Draft，不以先合併／部署作為驗收前提。使用者另已授權建立目前分支的本機隔離 Coordinator、轉檔服務與 RTX Kit，使用獨立資料／埠，不覆蓋 Linux 或既有部署，僅可停止本次啟動且已核對 ownership 的程序。
- 唯讀下載現場 `stream_conv_20260908084233_4bbe0d28/model.usdc` 檢查：`/World` 的 5 個子節點都是 Xform；`/World/Elements` 的 20 個 IFC 類別容器沒有 typeName。前端 `getChildrenRequest` 原先使用 `["USDGeom"]`，Kit 因而濾掉根節點；僅增加 `xform`／`scope` 仍會濾掉下一層未定型容器。
- `buildGetChildrenRequest` 改用 Kit 已有的 `filters: null` 分支，保留容器與幾何；不使用會排除所有節點的空陣列，不修改後端 API、授權或命令 proof。新增 `/World` 與 `/World/Elements` 兩個先紅後綠回歸案例。
- Chrome `http://127.0.0.1:5173/ui#a1` 實際操作同一圖書館審查 `review_session_fd48be0a3fff`，取得 `viewer_lease_8039983fba1c909c`；first frame、DataChannel 與模型核對相符。Stage 樹顯示 Live，可展開 Elements 的 20 個分類，再展開 IfcDoor 的 68 個構件及其 `Body_000` 幾何。
- 點選 `/World/Elements/IfcDoor/G_1_6rKosWT5r9WGrkrSURLd/Body_000`，`selectPrimsResult` 對 request `cmd_a95fe12b-94af-4bf0-9305-bf42f565465e` 回覆 success，selected_paths 與請求一致，UI 顯示該 path。後續畫面選取曾變為多個其他構件，未完成穩定的單一構件聚焦前後對照，因此本節只確認階層讀取與選取 ACK，不把完整聚焦或問題高亮列為通過。
- 按「清除選取」後 UI 回報已清除；截圖 `pr835-stage-tree-hierarchy-chrome.png` 保存在本次 Codex visualizations。驗證完按「離開 3D 檢視」，UI 回到尚未啟動、重整停用；未結束 Review Session，未強制回收其他 lease。
- 最終 null-filter 版本完整 `npm run verify` 通過：typecheck、build、Vitest **138 檔／1923 項**、struct-log **23 項**；Stage／命令橋接 targeted tests **4 檔／294 項**通過。首次沙箱 build 無法建立 sibling worktree 鎖檔，工具文案誤報 stale lock；沒有移除鎖或改 ACL，以已授權主機環境重跑成功。保留既有 React act／SSR 與 bundle chunk 警告，完整 lint 未執行。
- 隔離環境準備：本 worktree Coordinator `npm ci --no-audit --no-fund` 成功，Streaming `repo.bat build` 顯示 BUILD (RELEASE) SUCCEEDED，已取得本機 Kit SDK。尚未啟動完整隔離服務，沒有把 CPU probe 人工註冊為正式轉檔成功。
- 正式 adapter preflight 阻塞於 `CAD extension cache link parent is not owner-private`：新建 `_build/windows-x86_64/release` 與 `extscache` 繼承了非 trusted-writer 的寫入 ACL。只做 Get-Acl 診斷，尚未修改權限或放寬驗證；此為新增且獨立的 permission 授權邊界，不能用隔離堆疊授權推定同意改 ACL。

尚未通過的 merge 前驗收仍為：新版完整產物的 Chrome／RTX 基本材質、規則失敗構件高亮／清除／外觀還原、量測尺寸與單位校準、穩定構件聚焦、兩份具來源關聯的 IFC 切換。Stage 階層讀取與選取 ACK 已補足；剖切保留使用者已確認證據。不得將 Windows SDK 建置成功或 CPU 測試換算成 GPU 驗收。

### 已授權的本機 ACL 修正 checkpoint（2026-09-14）

- 使用者明確授權先備份 ACL，僅收緊此 worktree 的 `bim-streaming-server/_build/windows-x86_64/release` 與其 `extscache` 目錄；不得延伸到 main、Linux 或全域快取。使用者要求 commit 後再繼續驗證。
- 修改前確認兩者均為普通目錄、owner 屬既有 trusted-writer 集合，各有 6 組非受信任有效寫入 SID；未改 owner、SACL、帳號或 repo 的信任條件。
- 本機備份為 Codex visualizations 內 `pr835-build-acl-before-87467fa5c241482f83945b6efac7db92.clixml`，包含兩個目錄原始 ACL 及唯讀全域快取對照，已重新讀取驗證，不提交 ACL／SID 明細。
- 僅改兩個目錄自身的 DACL，保留既有子目錄繼承語意，將可繼承但不受信任的寫入 ACE 限為 inherit-only；repo 原有 predicate 檢查兩個目錄均通過。CAD 全域快取的 10 個 chain components 前後 ACL 全部一致。
- 此 checkpoint 只證明已授權 ACL 操作完成；正式 adapter preflight、隔離堆疊及 Chrome／RTX 驗收在 commit 後繼續，不提前列為通過。ACL 備份可用於恢復原 DACL，無 tracked runtime 程式修改或正式部署。

### 本機隔離 RTX 實測與手動審查切換修復（2026-09-14）

- 先提交 ACL checkpoint `0db442e02adc6a1e6acafb068dc0672e8c3fd736`，再執行正式 adapter preflight，結果 PASS。依授權啟動本分支的獨立 Coordinator（8008）、Governance（49106）、conversion（49160）、Viewer（5183）、Kit Manager（8018）與 RTX Kit（49161／48061）。API 只綁 loopback；Kit SDK signaling listener 綁 all interfaces，不把本機堆疊描述為完整網路隔離。未更改 firewall、既有 .env、main、Linux 或全域快取 ACL。
- Chrome 實際 route 為 `http://127.0.0.1:5183/ui#a1`。使用既有 `/api/dev/ifc-sources/:id/register` 準備本機測試進件，由正常下載／conversion authority 產生 USDC 及 session；沒有人工寫入 ready 狀態、假 ACK、mock viewport 或放寬 Stage／授權檢查。這不是 MinIO provenance 驗收。
- 完整圖書館來源為 52,441,473-byte IFC，SHA-256 `8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce`。正式 conversion `stream_conv_20260914105057_73ef5816`，ifc-ready `ifcready_1789383057661_c095b1eb`，session `review_session_0428a31f01a6`。USDC 為 4,485,679 bytes，SHA-256 `92aa67cc210bb5cda4b2a5891bbc7a81ddf208d1ab96adbd0449c2255bdaf2b6`；6,770 Mesh 均有材質綁定、63 材質、58 種 diffuseColor，metersPerUnit=1、Z-up。
- 當輪本機 Kit `kit_local_001`／PID 36816，圖書館初次 lease `viewer_lease_fb5fcba4df83b9d6`，first frame、DataChannel、expected == loaded Stage 均已觀測。Chrome 可見棕色步道、灰色路面及不同建材，保存 `pr835-local-library-materials-before.png`。新材質的正式轉檔及 RTX 顯示已補足；不因此推定舊 Linux 產物已更新。
- A1 local_fs 清單要求 `{project}/{model}/*.ifc`，頂層 dev intake 檔案不會自動列入。於本次測試資料根建立相同 SHA 的檔案庫副本，經 UI 選取、鎖定並執行 `/api/governance-library/rule-runs`：圖書館 IDS 得到 68 個門失敗、0 個無法定位；高亮 ACK 68 個，但全景未辨識到明確顏色差異。定位第一個門 `3$xKPHQlD10AG1nzmJabuU` 確實移動鏡頭並選取，卻被牆遮擋；保存 `pr835-local-library-focus-occluded.png`，不列大型模型可見高亮或穩定聚焦通過。
- 另用 repo `write_real_ifc` 建立分析校準 fixture：兩面 2×1×3 m 牆、中心相距 5 m，加入明確綠／藍 IFC style，SHA-256 `3a1426d0a0b0a8e9aa94a0b4fdd2bd715bbd41c174735237b05bcb31d356a143`。正常 conversion `stream_conv_20260914105337_b8a46e46`，ifc-ready `ifcready_1789383217191_60bfd964`，session `review_session_e5fee46502bd`，USDC SHA-256 `6e47a0dc7656f3b0c5997c662c7d3a3ffc311fee1601c73544768a978971c130`。此為可追溯校準 IFC，不是第二份業務驗收模型。
- 實機重現手動「審查紀錄」改選後，右側目標已換、共用 Viewer 仍用舊 session；正確 Stage guard 因此封鎖高亮。只修改 A1 手動選項 onChange，同步 `setActiveSessionId` 並失效舊 gate／Stage，不自動 claim。不改 provider 的 Dock publish 播種規則，也不改新審查選單僅瀏覽時不切換的契約。
- 新增 2 項先紅後綠測試，涵蓋改選與清空後不可保留舊 Viewer authority。相關 A1／iframe ownership／viewport host **3 檔／65 項**通過；完整 `npm run verify`：typecheck、build、Vitest **138 檔／1925 項**、struct-log **23 項**通過。保留既有 chunk／React act／SSR 警告；完整 lint 未執行。
- 修復後 Chrome 由圖書館切到綠／藍校準牆，實際 Stage 與 session 一致；校準 lease `viewer_lease_a7be8de732533b20`。清空 IDS 後執行內建 YAML，得到 `WALL-STOREY-ASSIGNED` 兩個 medium 失敗；按「在模型中顯示問題」後兩牆真實變黃，ACK=2。定位一牆可見橘框；「清除選取」框消失、黃色保留、視角不變；「關閉問題高亮」同一鏡頭恢復綠／藍。證據：`pr835-local-walls-before.png`、`pr835-local-walls-highlight-yellow.png`、`pr835-local-wall-focus.png`、`pr835-local-wall-selection-cleared.png`、`pr835-local-wall-original-restored.png`。
- 校準牆 Z／正向／1.5 剖切可見高度裁切，關閉恢復；保存 `pr835-local-wall-section-z1.5.png`／`pr835-local-wall-section-off.png`。不撤銷先前使用者已確認的圖書館剖切證據。
- 表面两點人工取樣取得 **2.907 m**，保存 `pr835-local-wall-measurement-2.907m.png`；取點在端點內側，不是精确 3 m 基準。再靠近邊緣取點回報「無法確認量測」，未取得可校準的端點證據，故只列兩點量測成功路徑，不列尺寸／單位精度驗收通過。
- 反向改選圖書館時，舊 Viewer 失效並等待手動啟動；啟動後 Stage 相符且畫面確實回到圖書館，保存 `pr835-local-return-library.png`。但重置／返回的 framing 過遠，模型偏小；不能據此宣稱相機操作體驗完成。
- 新發現的剩餘缺口：dev intake 的 `idem_devreg_...` record 出現在可選已轉檔清單，按「建立新的審查」卻回 `400 invalid_ready_model_id`，已記錄且未放寬 validator；手動跨模型改選仍可看見前次檢核列表，不能算跨來源結果生命週期驗收通過；退出 Viewer 後部分流程提示可短暫保留 ready 字樣。上述均留待修復，不把舊結果當新模型證據。
- 本輪結束先從 UI 離開 Viewer，未終止 Review Session。停機前依 manifest 核對 PID／啟動時間／exe／工作目錄／listener 與 Kit 父鏈；只停止本輪啟動的程序。初次停機前置檢查因 UTC 解析差 8 小時安全中止，改用明確 UTC 並重新核對後執行；停止後即時 listener 查詢尚未收斂，後續唯讀複查確認本次 TCP／UDP listeners=0、owned processes=[]。IFC／USDC／ACL 備份／截圖及測試資料均保留，未刪除。

**Merge 狀態：仍為 Draft／HELD。** 本輪補足正式轉檔材質、校準模型真實 RTX 高亮／清除／還原、雙向不同 Stage 切換及剖切；尚待大型圖書館可見高亮與無遮擋聚焦、精確量測校準、第二份業務 IFC／MinIO identity、上述前端剩餘缺陷與完整獨立 review。不得先 merge 再補驗。

### Merge 前第二輪本機續驗（2026-09-14）

- 使用者授權順序為「先 commit 修復 → 本機驗收 → 通過後 merge main → canonical Linux 部署 → 新部署實際截圖」。此次接續同一 worktree／PR #835；`0db442e` 與 `a828652` 已存在，不重複提交 ACL 或改動 main／Linux。
- 新提交 `6198747` 清除跨審查的舊檢核／mapping／交付狀態，保留明確的 local_fs 來源供重新檢核；首次綁定審查仍保留獨立 CPU 檢核，交付版本由原 gate 重驗。Chrome 實測圖書館 68 個失敗切到校準審查後變為 0 筆、0 構件，Viewer 回到尚未啟動；沒有自動 claim。`pr835-round2-switch-clears-results.png` 為當輪證據。
- 同一提交保留 dev intake 紀錄可觀測，但對不符合 canonical `mw_[a-f0-9]{16}` 身分的紀錄停用「建立新的審查／開啟所選審查」，顯示使用進階既有審查選擇器的指引。Chrome 確認停用與原因；不再從該入口送出必定 `invalid_ready_model_id` 的請求。這是 admission／復原路徑修復，**不是新增 dev intake 建立審查能力，也不是 MinIO 成功路徑驗收**；backend validator 未放寬。
- 本次資料根 `pr835-premerge-round2` 使用與上一輪相同 SHA 的完整圖書館 IFC／分析校準 IFC，經正常 dev intake／正式 converter 產物開啟。圖書館 conversion `stream_conv_20260914113503_126b03d1`、session `review_session_1bc15d52aa4e`；校準 conversion `stream_conv_20260914113755_d65bc1ed`、session `review_session_830163477240`。來源 SHA 與尺寸沿用上節並重新核對；校準 IFC 仍不算第二份業務 IFC。未人工偽造 ready、Stage、命令 ACK 或 MinIO identity。
- 重啟僅本輪已核對 ownership 的隔離服務後，新 Kit 載入 `f3861f8`：在可回復的匿名高亮材質層加入與嚴重度相同的 `emissiveColor`，避免暗室的紅色高亮退化為黑色。不改原始材質／場景灯光設定，不穿透遮擋；RTX 可產生鄰近紅色光暈，因此不可把光暈視為其他構件也被規則命中。
- Chrome `http://127.0.0.1:5183/ui#a1` 圖書館 lease `viewer_lease_091747d9605daaa8`，first frame、DataChannel、expected == loaded Stage 已觀测；同一 IDS 檢核為 68 個門失敗、0 無法定位。定位 `3$xKPHQlD10AG1nzmJabuU` 後可見門下部紅色，但屋頂／牆仍遮擋；使用 Z／反向／8.2 剖切移除上方遮擋後，同一鏡頭可明確看見兩個紅色門。此為**剖切輔助下可見的業務模型高亮**，不是自動無遮擋聚焦通過。
- 同一鏡頭按「清除選取」後橘框消失、紅色保留；「關閉問題高亮」後恢復原始灰色門，剖切仍保留，之後另按關閉剖切。證據 `pr835-round2-library-door-emissive.png`、`pr835-round2-library-door-highlight-section.png`、`pr835-round2-library-selection-clear.png`、`pr835-round2-library-restored.png` 均保存於本機 Codex visualizations，未將 IFC／大型 USDC 納入 git。
- 提交 `08dbbed` 只保留已核對的 native 量測拒絕原因 allowlist，未知細節仍顯示通用錯誤；量測資訊以預設收合的 details 顯示 native Stage 座標與 request ID，並明示不是自動吸附端點。不改 API／資料格式／座標運算／單位 authority。
- 校準 lease `viewer_lease_7321097dd8bf115a`，UI 回報 first frame observed、DataChannel ready、Stage matched、三項 artifact health true、Kit `kit_local_001`。定位 3 m 高綠色牆後，實際 native 兩點為 P1 `[-0.934999, 0.500000, 2.977674]`、P2 `[-0.963407, 0.500000, 0.007952]`，request `cmd_7ca1e5dc-8cf1-4dca-86b5-d9f250ac2ff9`，UI **2.970 m**；點均在已知 y=0.5 牆面、Stage metersPerUnit=1，尺度／表面命中吻合。約 3 cm 差距是人工取點內縮，**不列精確端點或工程精度校準通過**。`pr835-round2-measurement-2970.png` 完整顯示讀值及座標。
- 故意點背景實際收到 `no_hit`，UI 顯示「未點到模型表面；請重新開始，在可見表面內取點。」；`pr835-round2-measurement-nohit.png` 保存。清除後 UI 顯示已清除，不保留距離或座標。
- 本輪先紅後綠覆蓋跨審查清除、非 canonical ready admission、暗處 overlay emissive 與量測原因；前端完整 `npm run verify` 通過：typecheck、build、Vitest **138 檔／1934 項**、struct-log **23 項**。量測橋接／DOM／controls targeted **24 項**；Python `test_highlight_overlay.py`、`test_distance_measurement.py`、`test_measurement_runtime.py` **107 項**通過。另 `npm run test:session-first`、本輪 8 個前端變更檔的 ESLint、`git diff --check` 通過。保留既有 chunk／React act／SSR 警告；不宣稱完整 repository lint 通過。

**尚未滿足 merge 條件：** 自動無遮擋構件聚焦／遠景 framing、精確量測端點校準、第二份業務 IFC 與 MinIO 来源 identity 尚未全部驗收。前者目前 `_on_focus_prim` 只呼叫 Kit `frame_viewport_prims`，成功是 framing＋selection，不提供視線無遮擋保證；本輪未用任意隱藏建材／全域變更來冒充修復。已請使用者提供第二份業務 IFC 路徑或授權 MinIO bucket/object key。完整獨立 review、exact-head CODEOWNER／last-push approval 亦須另外成立。保留 Draft／HELD，未 merge、未部署，沒有新 Linux 截圖可當作通過。

#### 本輪獨立審查後的修復 checkpoint

- 針對固定 `cabaa0c…08dbbed` 完成 Standards／Spec 分開唯讀審查，完整覆蓋 56 檔、16 個提交。Standards 未發現違規；Spec 發現 P2：MinIO 建立／重用 A 後改選 B，`reviewOpen.expected_stage_url` 仍優先傳給 B。該問題確實重現，不以剛才 local_fs 成功路徑掩蓋。
- `764a9db` 修復：明確切換時清除舊 review handoff；來源／物件／審查改變使等待中的建立回覆失效，舊成功或失敗都不能覆寫新狀態；預期 Stage 額外要求回覆 session 與當前 session 相同。新增 direct／先清空／pending 三個回歸，修改前皆收到錯誤的 `stage://a`，修改後新 session 搭配 `stage://b`；A1 相關 3 檔 **60 項**通過。MinIO 此分支為受控 client regression，**仍不是 live MinIO provenance 驗收**。
- 兩位唯讀 reviewer 完整補審 `08dbbed…764a9db` 的兩檔，原 P2 判定 FIXED、無新增 finding；未冒充 GitHub counted approval。文件新增的本節是後續證據紀錄，不冒稱已接受 exact-head 人工核准。
- `764a9db` 完整 `npm run verify` 再次通過：typecheck、build、Vitest **138 檔／1937 項**、struct-log **23 項**；兩個新增變更檔 ESLint 通過。`scripts/deploy.ps1 -DryRun` exit 0，所有 auto-fix 階段明確 skip；提示本 worktree 缺正式 env／venv、5173 被其他程序占用，未修正或停止該程序，不能解讀為已準備好正式部署。
- 最後以 Chrome 重新開啟真實圖書館，lease `viewer_lease_2cfad6b671a0c61e`、first frame／DataChannel／Stage matched／artifact health 均由當前 UI 確認。再跑 68 門檢核、定位同一門、Z／反向／8.2 剖切，目視確認紅色；清除選取仍紅、關閉高亮恢復灰色，最後關閉剖切。新版截圖為 `pr835-round2-final-library-red.png`、`pr835-round2-final-selection-cleared.png`、`pr835-round2-final-restored.png`。
- 從 UI 離開 Viewer、未終止 Review Session；核對 generation-2 manifest、listener、exe、creation UTC、Kit PID 26152 → cmd PID 30140 → launcher PID 17616 後，只停止本輪程序。停止工具確認本輪 TCP／UDP listeners=0，receipt `pr835-premerge-round2/stopped-2.clixml` 保留。兩代測試資料、來源、產物、ACL 備份與截圖皆未刪除。這是測試資源釋放 checkpoint，**不是產品已完成或 session 收工**。

### 真實 MinIO 自動轉檔與新建審查續驗（2026-09-14）

- 使用者授權讀取 MinIO、驗證自動轉檔，成功 USDC 均可作驗證資料。只讀既有 bucket；沒有上傳／修改／刪除 MinIO 物件、修改既有 Linux 部署或覆寫任何 `.env`。既有 Linux Coordinator 與 S3 health 當輪可達；這是唯讀現況確認，不是新版 Linux 部署驗收。
- 配置 bucket `bim-control` 當輪共 525 個物件，其中只有 2 個 `.ifc`，沒有 `.usdc`／`.usdcc`；USDC 位於 streaming artifact service，不在同一 bucket。既有 Linux watcher poll_count 持續增加、last_error=null、seen=2、triggered_total=0；兩個來源已在既有 ledger，因此舊環境的去重狀態不能冒充本輪新增轉檔。
- 沿用獲准的本機隔離埠，建立全新 `pr835-premerge-minio` 資料根，執行本分支 `38ce188` 的正常 MinIO watcher／IFC-ready intake／正式 converter。未 preseed 來源、未手動呼叫 conversion trigger、未偽造 ready 或來源身分。啟動 helper 原先錯把可空的 tenant 設定當必填，依 source 的既有預設修正 helper 後才啟動；未修改產品設定契約。
- 9 次自然掃描：baseline=2、seen=2、triggered_total=2、skipped_malformed_total=0、last_error=null；兩筆 `intake_source=minio_watch`、download_status=downloaded、conversion_status=ready。conversion ledger 仍只有兩筆，證明首次發現自動下載／轉檔，以及後續輪詢不重複派工。證據 `pr835-premerge-minio/automatic-conversion-receipt.json`；沒有以額外上傳物件測試外部上傳事件。

| MinIO 來源 | 自動 conversion／session | 實際產物與品質 |
|---|---|---|
| `ifc-test/architecture/v1/model.ifc`，`mw_62a38b64a3256b88`，ETag `7c5a1638bd699be671dbc5efe78be9dc-11` | `stream_conv_20260914133219_e807067a`／`review_session_27aa5b5186a3` | IFC 89,394,282 bytes；USDC 7,162,952 bytes；7,000 Mesh 全部有材質綁定，62 材質、57 diffuse colors。Mapping 6,998/7,009，11 unmapped，coverage=99.843%，WARN。 |
| `東勢區許良宇紀念圖書館/root/建築/24e598ab-be3d-4dbb-a1aa-60b0ba610618/model.ifc`，`mw_010792d2cce6bf9b`，ETag `06363b2cb9b9206118a8547f93ce6825-11` | `stream_conv_20260914133221_b64798ff`／`review_session_ad0fe6e23fac` | IFC 52,441,473 bytes；USDC 4,485,627 bytes；6,770 Mesh 全部有材質綁定，63 材質、58 diffuse colors。Mapping 6,770/6,816，46 unmapped，coverage=99.325%，WARN。 |

- 兩份 IFC 另經真正 S3 HEAD／條件 GET／再 HEAD，比對 bucket/key/ETag 與 `mw_` 身分；獨立下載 SHA 與 watcher 的 `storage/ifc-cache/<job>/source.ifc` 完全相符。來源 SHA 分別 `54d77fe1c8839bdd7d2cb46a9a87e4491b75f0019462608fab7bc5fc86155b71`、`8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce`。新 USDC SHA 分別 `2b0aced65c3bb5a48c1c43494eb5a0b89260cbfa55528dddab8dbff633e3bb78`、`78d2086aad51633d872fc5ca806e0725412c4b1a16b55729a108ff7b835c7d1a`；兩者 metersPerUnit=1、Z-up、GUID 集合／Mesh 數／bounds 不同。這是兩份真實來源檔的證據，不宣稱它們是兩棟獨立建築；共享門 GUID 與外觀相近，可能是同建築不同版本。
- 舊 Linux USDC 亦以 GET 200／PXR-USDC magic 核對可讀。artifact HEAD 回 405 是方法不支援，不是檔案不存在；`download-audit.json` 的來源穩定證據與 `artifacts-audit.json` 的 GET 證據須分開解讀，第二份 receipt 未重新檢查來源，不能將其預設 false 解讀為來源已變動。新產物結構檢查為 `geometry-provenance.json`。大型 IFC／USDC 只保留本機，未提交 Git。
- 外部 Chrome `http://127.0.0.1:5183/ui#a1` 先開自動建立的 ifc-test 審查，lease `viewer_lease_9bce5dcd569a2b27`、Kit `kit_local_001`；first frame、DataChannel、expected == loaded `...e807067a/model.usdc` 與三項 artifact health true 均已確認。初始 framing 仍過遠，不將縮小模型畫面列為操作體驗完成。
- A1 從 MinIO 下拉選取／鎖定該 downloaded job，再經真實 for-session proxy 執行 IDS：`rr_134c0c9679eb` 成功，71 個問題構件、4 個無法定位；高亮成功套用 67 個。定位 `3$xKPHQlD10AG1nzmJabuU` 後，以 Z／反向／8.2 剖切可明確看見紅色門；清除選取只移除橘框、保持紅色，關閉問題高亮恢復深灰原色，最後關閉剖切。截圖 `pr835-minio-ifctest-red-section.png`、`pr835-minio-ifctest-selection-clear.png`、`pr835-minio-ifctest-restored.png`。4 個不可定位構件仍是未通過項目，不以其他 67 個成功代替。
- 從 canonical ready-model 入口建立圖書館新審查成功，跨審查舊結果清成 0 筆，卻重現 Viewer 誤報 runtime/status 未列出新 session。根因：共用 `ReviewSessionViewerPane` 只在 mount 查一次 runtime，新建 session 沒被它的清單納入。修復為切換 sid 重查，snapshot 綁查詢時的 sid，請求序號阻止晚到舊成功／失敗及 Kit 狀態回覆覆蓋；仍必須手動 claim，不放寬 runtime admission／Stage／lease gate。
- 4 個先紅後綠回歸涵蓋新建切換、舊成功／失敗晚到、新查詢未完成及查無目標時維持停用。相關 4 檔 96 項通過；完整 `npm run verify`：typecheck、build、138 檔 1,941 項、struct-log 23 項通過。兩個 changed files ESLint 無 error，保留既有 4 個 warning；不宣稱全 repo lint 通過。
- 修復後不刷新頁面，從既有 ifc-test 新建圖書館 `review_session_request_9c0faebb4b147542914d3f4f713fe5a1c2794a56c65103fafb4338d02e8df097`，手動啟動成功；lease `viewer_lease_f09124dea1a10735`、first frame／DataChannel／Stage matched，實際 `...b64798ff/model.usdc`。`pr835-minio-new-library-session.png` 保存真實模型及載入路徑；此新審查當時 artifact health 尚未提供，沒有寫成全 true。
- 第二份 MinIO 圖書館經 for-session 檢核 `rr_c84f6b895a29` 成功：68 個問題、0 個無法定位。該檢核屬 watcher 原審查 `review_session_ad0fe6e23fac`，不是後建的新審查；UI 正確以「目前 3D Session 與這份檢核結果不同」阻止高亮，未繞過 guard 或混用兩份審查證據。

本節補足 MinIO 真實來源、自動進件／正式轉檔／去重、兩份不同 IFC 產物、A1 MinIO CPU 成功路徑、可見高亮／剖切／還原及新建審查即時啟動。仍不可 merge：初始遠景／自動無遮擋聚焦、精確端點量測、來源 coverage 警告與 4 個問題不可定位尚未全部驗收；新 Linux 部署截圖與 exact-head CODEOWNER／last-push approval 亦未完成。

#### MinIO 續驗的審查修正與最終實機 checkpoint

- `eb790d0` 的 Standards／Spec 增量審查完整涵蓋 3 檔，累計保留先前 57 檔的 coverage；兩者指出同一 P2：A 已查證後切 B，B 還 pending 就回 A，新 A 回覆前可重用舊 A snapshot。新增此序列先紅後綠；snapshot 改綁既有 lease selection epoch，refresh 開始失效舊 snapshot，回覆同时核對 request 序號與 epoch。這是前端 freshness 缺口，不宣稱後端授權可被繞過。
- 最终 4 檔 targeted 97 項通過；完整 `npm run verify`：typecheck、build、138 檔 1,942 項、struct-log 23 項通過；session-first contract 通過，兩個 changed files ESLint 0 error／4 個既有 warning。沒有用較早 1,941 項結果冒充最後版本。
- Chrome 最終版本從 MinIO 圖書館選取／鎖定 downloaded job，按「建立／重用 3D Session」明確附掛同一個 watcher 審查 `review_session_ad0fe6e23fac`，再手動啟動；lease `viewer_lease_4d1bdfc48949dc69`、first frame、DataChannel、expected == loaded `stream_conv_20260914133221_b64798ff/model.usdc` 均觀測。重新檢核 `rr_a236a47c5e1d` 成功，68 個問題、0 個無法定位；同審查高亮 ACK 成功套用 68 個。
- 目視確認 Z／反向／8.2 剖切後红色門；清除選取只移除橘框且維持紅色，關閉高亮還原深灰原色。證據 `pr835-minio-final-library-red.png`、`pr835-minio-final-library-clear.png`、`pr835-minio-final-library-restored.png`。隨後關閉剖切並從 UI 離開 Viewer；此為正確審查配對後的成功路徑，不改寫前一段跨審查 guard 拒絕的紀錄。
- 最後再次 S3 HEAD，兩份來源 ETag／大小仍與獨立下載時相同，`head-audit.json` 的 sourceHeadMatchedPrior=true；artifact HEAD 405 明確記為 reachability 未判定，不覆蓋先前 GET 200 證據。

#### 使用者現場驗收待確認（2026-09-14）

- 使用者要求實際操作 Chrome，且須由使用者明確確認驗收通過才能 merge；所有既有測試與 advisory review 均不能代替此確認。
- 核對上一代 stop receipt 與空閒測試埠後，重啟同一 MinIO 隔離資料根 generation 2；保留舊 manifest、日誌、來源與兩份轉檔產物，不重轉 IFC、不改 Linux。新 manifest 為 `pr835-premerge-minio/processes-2.clixml`。
- Chrome `http://127.0.0.1:5183/ui#a1` 從 MinIO 選圖書館、鎖定 downloaded job、手動啟動；session `review_session_ad0fe6e23fac`、lease `viewer_lease_fdd1d70cbb63c177`。UI 回報已收到畫面、載入模型與審查相符，Stage Live、命令通道可用。實際檢核 `rr_3f1f6b7200c2` 成功，68 問題、0 不可定位；「在模型中顯示問題」回報套用 68 個構件。
- 定位門 `3$xKPHQlD10AG1nzmJabuU`、套用 Z／反向／8.2 剖切；Chrome 中紅門及橘色選取框可見。`pr835-user-demo-red-g2.png` 為當輪截圖。保留該 live tab／本輪程序等使用者目視確認，尚未收到確認；不得先記成使用者通過，也不得 merge。
- 當輪再現初始模型過小。候選修復在新 IFC Stage 的 ASSETS_LOADED 時僅 frame `/World/Elements`，於 session layer 操作，再保存 reset camera；相同 Stage 後續事件不奪走使用者視角，取景不可用不保存錯誤 baseline。新增兩項回歸在修正測試 stub 後確認原程式失敗、候選通過；`test_stage_management_runtime_authority.py` 共 46 項通過，`git diff --check` 通過。
- **候選尚未在 Kit 重啟後驗證，未提交／推送**。保持當前紅門展示不受重啟打斷，待使用者確認此畫面後續驗清除／還原、取景修復與其餘待驗項目。此項不等於自動無遮擋聚焦或精確端點量測已完成。

#### 展示中熱重載導致高亮／剖切失效的修復（2026-09-14）

- 使用者要求當場拍照時，`pr835-user-confirm-current-dark.png` 顯示紅色消失、屋頂重新遮住門，但 UI 保留先前的成功提示；未把此圖當通過。已查明不是 MinIO 或 IFC 損壞：generation-2 日誌在 `2026-09-14T14:23:54.228Z` 記錄 messaging shutdown，`.379Z` 再 startup，與本代理編輯 `stage_management.py` 時間一致。Kit 檔案監看觸發熱重載，StageManager shutdown 清除 overlay／剖切／trace binding，舊瀏覽器成功狀態未同步失效。這是代理在展示中改碼造成的中斷，不是使用者操作錯誤。
- 最小修復：messaging `config/extension.toml` 明確 `[core] reloadable=false`；此 stateful 擴充改碼須受控重啟 Kit，再建立新 viewer binding，不允許開發用檔案熱重載清掉 live 狀態。依據 [NVIDIA Kit extension 官方契約](https://docs.omniverse.nvidia.com/kit/docs/kit-manual/107.2.0/guide/extensions_advanced.html)。這不禁止顯式 API unload，也不宣稱所有程序崩潰／外部停用都會同步更新 UI；未新增 public API／schema／環境變數。
- `test_messaging_reload_policy.py` 在舊設定回 default true 而失敗，修復後通過。最終 Python reload-policy／Stage authority／highlight／section／distance／measurement-runtime 共 **190 項通過**；`git diff --check`、canonical `scripts/deploy.ps1 -DryRun` exit 0。未重新跑完整前端 verify；產品前端未改，舊 1,942 項不算本輪新結果。DryRun 不是部署。
- generation 3 真實檔案變動驗證：紅門＋剖切套用後，撤回無效取景候選造成 watched `stage_management.py` 實際內容變動；後續測試及目視期間仍紅、剖切維持，Kit 日誌只有一次 startup、無 shutdown／重載。保存 `pr835-hot-reload-fixed-probe.png`。**初始取景候選實機仍過遠，因此撤回候選程式與其兩個測試，未把單元成功當取景修復成功**；前一節候選紀錄僅為歷史 checkpoint。
- 依 manifest、listener、exe、PID creation UTC 與 Kit 父鏈只停止本輪 generation 2、3，各有 `stopped-2.clixml`／`stopped-3.clixml`。啟動 generation 4 載入不含無效取景候選的最終程式；同一資料根、IFC、USDC、獨立測試埠，不重轉、不改 Linux／main／既有 env。`processes-4.clixml` 保留。
- 最終 Chrome `http://127.0.0.1:5183/ui#a1`：MinIO 圖書館 → 選取已下載模型 → 手動啟動 → 真實規則檢核 `rr_388bedf5aaa8`（68 問題、0 無法定位）→ 在模型中顯示問題（A1 回覆套用 68 個）→ 定位門 `3$xKPHQlD10AG1nzmJabuU` → Z／反向／8.2 剖切，等待實際回覆後拍照。
- session `review_session_ad0fe6e23fac`、lease `viewer_lease_24752d2e6fcaa5af`、Kit `kit_local_001`；UI first frame observed、DataChannel observed、expected == loaded `stream_conv_20260914133221_b64798ff/model.usdc`、三項 artifact health true。通用 Pane 的單項 `highlight ack=not_sent` 仍不是 A1 批次高亮回覆，沒有改寫成兩者一致。
- 對照截圖 `pr835-repaired-red-g4.png`（紅門／橘框／剖切）、`pr835-repaired-selection-clear-g4.png`（清框保持紅）、`pr835-repaired-restored-g4.png`（關高亮恢復深灰、剖切保持）。再開高亮供使用者確認；Chrome 與 generation 4 留開，不在等待確認期間編輯 live runtime。尚未取得使用者目視核准；PR 維持 Draft，未 merge／部署。初始取景、自動無遮擋聚焦、精確端點量測及映射缺口維持待驗，不宣稱整體收工。

#### 逐項使用者確認與重置取景缺口（2026-09-15）

- 使用者要求再操作 Chrome，確認一項 OK 後才繼續下一項。從現有新分頁重新選取 MinIO 圖書館、鎖定 downloaded job、手動啟動，session `review_session_ad0fe6e23fac`、lease `viewer_lease_8e92e932fa65e756`。真實 for-session 規則檢核 `rr_66d5caf129e0`（2026-09-15T02:13:01Z）68 問題、0 無法定位；實際關閉高亮恢復灰色，再啟用變紅。新圖 `pr835-repeat-20260915-gray.png`／`pr835-repeat-20260915-red.png`。
- 使用者隨後明確回覆「確認ok」：只將上述高亮／還原循環列為使用者確認，不能推定初始取景、精確量測、自動無遮擋聚焦或整份 PR 通過，也不構成 GitHub counted approval。
- 下一項按 UI 關閉高亮、關閉剖切、重置視角，模型縮成中央小塊；`pr835-reset-baseline-20260915.png` 為當輪失敗證據。reset 原本只還原 ASSETS_LOADED 保存的相機屬性，未重新取景。
- 候選改為等實際 viewport 影格後 frame `/World/Elements` 再保存相機，reset 也重做 model fit；新增四個案例先紅後綠，Python 相同六組套件共 **194 項通過**。正常 UI 離開 Viewer、核對 g4 PID／父鏈／creation／listener 後受控停止，`stopped-4.clixml` 證明測試 TCP／UDP 埠皆 0；沿用資料啟動 g5，未重轉、未改 Linux。輔助 shell 對 PowerShell helper 錯誤讀取舊 LASTEXITCODE，已改以停止收據及新啟動前 ownership 檢查裁決，沒有重複停止。
- **g5 實機候選仍讓建築過小，不算修復通過，候選程式／測試暫未提交或推送。** Kit 日誌已證實 `Model camera initialized after viewport frames`；載入 built 檔與 source SHA256 相同，排除未載入新版。直接以 OpenUSD 讀同一真實 USDC：`/World` 與 `/World/Elements` 範圍相同，約 246.37 × 233.08 × 25.05 m；IfcWall 範圍約 69.20 × 61.06 m，但 IfcBeam 延伸至 x=78.77、y=-57.81，IfcSite 延伸至 y=175.27。地理定位／Spatial 等容器為空幾何，不能把它們誤列為已證實原因。
- 全 IFC 範圍與建築主體範圍不同，已向使用者詢問重置預設採「建築主體優先，另保留全模型按鈕」或「整份 IFC 全部納入」。不擅自刪除／隱藏遠處構件來製造成功。等待取景語意選擇後再續修，g5 Chrome 保留；尚未 merge、未部署，下一驗收項目未提前進行。

#### 建築主體／全模型取景與真實完成回覆（2026-09-15）

- 使用者接續明確「同意」建築主體預設、另保留全模型按鈕。左側工具列增加短標籤，說明放 title；中央仍僅 Viewer。預設以有有效 bounds 的 IfcWall／IfcWallStandardCase／IfcCurtainWall／IfcRoof 取景，缺少外殼時依序使用 IfcColumn、完整 `/World/Elements`。只調整相機，不刪除／隱藏場地或遠處幾何；未保證多棟建築自動辨認與單棟隔離。
- `resetStage.payload.scope` 可省略（預設 building）或為 `building|all`；Python 將 scope 交 Coordinator strict schema 驗證，既有 trace／lease／操作 gate 不變。StageManager 等兩幀後初始化相機，重置／合法 focus／關閉取消未完成初始化；等待後核對 Stage、active viewport 與 camera path，防止舊工作蓋掉明確操作。同一路徑內原生 orbit 的極短初始化競態未驗收，不宣稱全相機競態已消除。
- g6 Chrome 真實近→遠→近已可見，但 DOM 的 resetStage lifecycle 仍 pending，未列為 ACK 通過。根因：已安裝 NVIDIA SDK 5.18.2 的 native callback map 攔截 `resetStageResponse`，formatter 去掉 request／trace，而 adapter 刻意不將這類回覆當完成。新增 **DataChannel `cameraFrameResult`** 保留真實 request／trace，僅配對 resetStage；保留原 native 回覆以結束 SDK callback。重複完成沿用 first-terminal 去重，不借 outbound trace、不把 generic ACK 當成功。JSON Schema 與兩端測試同步，無新增 REST route、環境變數、migration、排程或 Webhook。
- 核對 g5／g6 manifest、PID、建立時間、父鏈與 listeners 後受控停止，`stopped-5.clixml`／`stopped-6.clixml` 均為 TCP／UDP 測試埠 0；沿用同一 MinIO 產物與資料根啟動 g7。沒有重轉 IFC、改 `.env`／ACL、修改 MinIO 物件或部署 Linux。
- **g7 最終 Chrome 實測**：`http://127.0.0.1:5183/ui#a1` → MinIO 圖書館 → 選取已下載模型 → 啟動 A1 3D Session → 建築主體 → 全模型 → 建築主體。session `review_session_ad0fe6e23fac`、lease `viewer_lease_7ff970a1ccf17986`、Kit `kit_local_001`，first frame／DataChannel observed，expected == loaded `stream_conv_20260914133221_b64798ff/model.usdc`，artifact health 三项 true。三次 resetStage 的瀏覽器 DOM 均為 `pending → terminal (success)`，依序 request `cmd_1d62eb44-8c38-40ad-8835-ae424283dc0c`、`cmd_c686502e-517a-4bd3-bfec-0a34603bb99a`、`cmd_72be6ff4-8f59-4421-b1a3-dca6c577e883`；清選取亦各自 success。
- 原始截圖留於本機 visualizations：`pr835-framing-building-g7.png`、`pr835-framing-all-g7.png`、`pr835-framing-return-building-g7.png`。均為同一真實模型與正常 UI 操作，無生成／重繪圖片。Chrome 與本機 g7 留在建築主體供使用者确认；本次取景尚未取得使用者目視核准。
- 最新 deterministic checks：Python Stage authority／runtime command authority／highlight／section／measurement-runtime／reload-policy **179 passed**；DataChannel 契約 **32 passed**；前端 typecheck、build、完整 **138 檔／1,945 項 passed**，session-first passed；Coordinator build、相關 authority **43 passed**。完整 Coordinator 套件及 repository lint 未重跑。canonical deploy `-DryRun` exit 0（只讀／跳過執行；既有 5173 listener 未動），不是部署成功證據。Build chunk size、既有 pytest asyncio fixture 設定 warning 保留。
- Standards／Spec 分軸 advisory review 已補審本 delta；standards 找到 pending initial frame 覆蓋 focus 的 P2，已修復與補審，reviewer 自跑 18 tests passed。Spec 初次遇容量錯誤，一次新切片重試已完整完成；目前兩軸無新增 actionable finding，不代表 CODEOWNER／last-push approval。
- 已確認高亮／灰色還原保留；無遮擋自動聚焦、精確量測與 mapping 缺口仍待逐項驗收。g7 的舊 `makePrimsPickable` native 回覆仍 pending，未冒稱所有工具 ACK 完整；本輪只補相機完成路徑。PR 維持 Draft，未 merge、未 Linux 部署，等待取景確認後才操作下一項。

#### 取景使用者確認與下一項聚焦重現（2026-09-15）

- 使用者針對「建築主體」大小與「全模型」切換明確回覆「確認符合預期」：此項列為使用者目視確認，與先前高亮／灰色還原確認分開保留；不代表整份 PR 或 GitHub exact-head approval。
- 同一 Chrome `http://127.0.0.1:5183/ui#a1` 與 g7 `review_session_ad0fe6e23fac` 續驗，先從全螢幕退出；MinIO 圖書館與 Stage 未切換。按「執行規則檢核」產生 `rr_d94d24177d8e`，succeeded，68 個門失敗、0 無法定位。
- 展開 `3$xKPHQlD10AG1nzmJabuU` 並按「定位此構件」；`focusPrimRequest` 的 `cmd_56e40f16-88db-4561-9d97-ac5ca2bda03c` 為 terminal success，UI 選取 `/World/Elements/IfcDoor/G_3_xKPHQlD10AG1nzmJabuU`，但真實画面仍被周圍牆板遮擋。原始截圖 `pr835-focus-occluded-g7.png` 保存於本機 visualizations，不列無遮擋聚焦通過。
- 唯讀檢查同一 USDC：metersPerUnit=1、upAxis=Z，目標包含 1 個 mesh，world bounds 約 `(-83.591, 88.246, 5.830)` 至 `(-82.805, 89.032, 8.134)`，未見異常巨大範圍。目前 `_on_focus_prim` 與本機 SDK `frame_viewport_prims` 僅執行 framing／selection，沒有遮擋判斷；成功回覆不證明視線無遮擋。
- 本輪沒有變更 runtime 或模型幾何，未啟用額外剖切／隱藏；下一步需明確區分相機定位與遮擋時的剖切／隔離查看語意，再實作與重驗。精確量測尚未開始本輪驗收。Chrome／g7 保留；未 merge、未部署 Linux。

#### 主構件突出與可還原背景透明：使用者確認（2026-09-15）

- 使用者選定「定位構件作主角、其他構件作配角」，以背景透明及主構件短暫脈動輔助辨識；本次是 Kit 場景材質透明，不是 WebRTC 影片背景去背。參照 NVIDIA 官方 [OmniPBR](https://docs.omniverse.nvidia.com/materials-and-rendering/latest/templates/OmniPBR.html) 與 [RTX Real-Time fractional cutout opacity](https://docs.omniverse.nvidia.com/materials-and-rendering/latest/rtx-renderer_rt_legacy.html)；未採綠幕、Canvas 重繪或強制切換 Path Tracing。
- 新增 `focus_overlay.py`：背景以 OmniPBR 藍灰色、opacity 0.25 呈現，目標維持不透明亮色；匿名 session layer 與既有問題高亮分離，不寫入 IFC／USDC。保留 PreviewSurface fallback；啟用当前 renderer 對應 fractional-cutout 設定並保存原值，退出時按 ownership/readback 還原，不覆蓋外部已改變的設定。未知 renderer、設定 readback 或還原失敗均不假報成功。
- `focusPrimRequest` 增加可省略的 `emphasis`／`pulse` boolean，成功回覆增加 `focus_emphasis`／`context_opacity`；Coordinator 嚴格驗證與 trace／lease gate 保持，A1 必須收到對應成功證據才顯示已定位。未提供欄位的既有 client 保留原相機／選取語意。無新增 REST route、環境變數、資料 migration、排程或 Webhook。
- 左側加入小型「還原檢視」，沿用帶 request／trace 的清選取確認路徑。還原移除定位材質與選框，保留現有相機、剖切及底層問題高亮；失敗／斷線不維持假成功提示。主角模式下量測明確提示先還原，避免透明遮擋面被誤當目標量測點。脈動限定 4.5 秒、3 個平滑週期，目標不閃隱；遵守 reduced-motion，清除／切 Stage／關閉會取消。**可見脈動辨識度仍未驗收，不能以實作或 ACK 宣稱使用者已看到閃爍。**
- 真實 Chrome 嘗試分開記錄：g8 PreviewSurface 仍遮擋；g9 8% 背景經使用者回覆「背景太淡，希望保留更多輪廓」；g10 25% 與 g11 藍色 PreviewSurface 仍偏白，均未列通過。g12 改用 bundled OmniPBR 及 fractional cutout 後，牆板、窗框、樓板藍灰輪廓可見、中央门亮色。使用者針對當輪畫面明確回覆 **「這次符合預期」**，只將此主角／配角外觀記為目視確認，不擴大為整份 PR 或 exact-head GitHub approval。
- g12 真實路徑：Chrome `http://127.0.0.1:5183/ui#a1` → MinIO 圖書館 downloaded job `ifcready_1789392739240_25119efc` → 手動啟動 → for-session 檢核 `rr_178567ca4fd7`（68 門、0 無法定位）→ 在模型中顯示問題 → 定位 `3$xKPHQlD10AG1nzmJabuU`。session `review_session_ad0fe6e23fac`、lease `viewer_lease_a1cb1a63b486626d`、Kit `kit_local_001`；first frame／DataChannel observed，Stage expected == loaded `stream_conv_20260914133221_b64798ff/model.usdc`，三項 artifact health true。focus 命令 `cmd_0e5ff4a3-fbbb-4467-ae5b-b5fbe4785e4e`、`cmd_a2d68c47-f66a-4010-bb56-9dc004519fae` 為 terminal success。
- 原始照片 `pr835-focus-alpha-g12.png` 留在本機 visualizations；不是生成圖片。相同 USDC SHA256 再核對仍為 `78d2086aad51633d872fc5ca806e0725412c4b1a16b55729a108ff7b835c7d1a`。g9 的還原及量測 guard 已在 UI 實測，`pr835-focus-restored-g9.png` 保存還原後既有紅色問題高亮；g9 快速截圖 burst 不足以證明 4.5 秒脈動，不列通過。
- 最終審查修正：材質還原失敗須回 correlated error 與真實當前 selection，允許重試；Stage lifecycle 不能因還原例外跳過其餘 cleanup；只有成功清除後才設 selection external-update flag，避免吞掉下一次 native selection。上述後補錯誤路徑尚未載入 g12，不能將 g12 照片當成這些錯誤路徑的 RTX 驗證。Standards／Spec advisory review 的 P2／P3 已修正、補測及覆核，沒有新增 actionable finding；不取代人類核准。
- 當輪 deterministic：Python overlay／Stage authority／highlight／runtime authority **132 passed**；最後再补 native-selection assertion 的 Stage authority **67 passed**；前端完整 **138 檔／1,954 passed**，typecheck、build、session-first 通過；Coordinator build 與 authority **21 passed**；DataChannel contract **32 passed**；`git diff --check` 通過。完整 Coordinator suite／repo lint 未重跑；build chunk warning 保留。canonical `scripts/deploy.ps1 -DryRun` exit 0，只是 DryRun，未動既有 5173 listener，不是部署證據。
- 使用者已確認的紅色高亮／灰色還原、剖切、建築主體／全模型取景保持有效；脈動辨識度、精確端點量測、來源 mapping 缺口與新 Linux 最終截圖仍需分開完成。PR 保持 Draft，**未 merge、未部署 Linux**。

#### 已提交版本的定位／還原再驗（2026-09-15）

- 先提交並正常推送 `c430f801c1ee841e0722b3f097c89bc41a509b51`；遠端 PR #835 HEAD 相符、OPEN／Draft。最終四組 Python 再跑 **132 passed**，PR safety 自測 **8 passed**、本 delta **20 changed files passed**，工作區乾淨。未 force push／merge。
- 驗證 g12 manifest／Kit parent chain／建立時間／listeners 後只停止本輪程序；`stopped-12.clixml` 記錄測試 TCP／UDP 皆 0，資料保留。g13 manifest HEAD 為已提交版本，沿用同一 MinIO 產物與資料根；不是 Linux 重建。
- Chrome 同一路徑重新從 MinIO 選圖書館並手動啟動：session `review_session_ad0fe6e23fac`、lease `viewer_lease_5eabb30e818613db`、Kit `kit_local_001`；first frame／DataChannel observed、Stage matched、三項 artifact health true。新規則檢核 `rr_748764539262`：68 問題、0 無法定位，UI 回覆問題高亮套用 68 個。
- 正常 UI 定位目標門，`cmd_26a516a3-93c8-418e-ba16-f0f07a523e58` 的 focus terminal success；**命令完成早於影片更新**，初拍 `pr835-focus-alpha-g13.png` 仍是前一個遠景，不列外觀成功。串流更新後 `pr835-focus-alpha-g13-settled.png` 才顯示亮色門、藍灰牆板與窗框；與使用者已認可的 g12 視覺一致。
- 再按左側「還原檢視」，`cmd_d22d9a54-1d15-4e6e-8501-7664dc56486f` 的 selectPrims terminal success；`pr835-focus-restored-g13.png` 可見原本不透明牆板／樓板與下方紅色問題門，沒有定位橘框。最後再定位，Chrome／g13 留供下一輪；本輪 normal-path 可見還原不等於故意注入 renderer 失敗的 GPU 驗證。
- 此 checkpoint 補足已提交版本正常定位／還原，未新增對脈動或精確量測的通過判定。使用者 g12 外觀確認、g13 代理實測與 exact-head 人工核准仍是三種不同證據。
