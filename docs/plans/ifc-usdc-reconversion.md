# 既有 IFC 重新轉 USDC：本次開發與完工規範

狀態：2026-09-15 已實作，核心本機真實操作閉環通過；故障恢復的現場重演與使用者畫面確認仍待完成，不標示全部驗收完成。使用者已授權 commit、push、開 PR、受保護合併與 canonical Linux 部署；本紀錄隨功能提交，實際 PR 狀態與部署結果以交付回報為準，不預先宣稱合併或部署完成。

## 本次功能範圍

在「模型資料與轉檔 → 選取 IFC → 模型詳情」提供「使用目前部署版本重新轉檔」，保留結果歷史，完成後由使用者明確選擇新結果建立／開啟審查。中央 3D 區不增加管理文字面板。

程式更新不等於舊 USDC 已更新；轉檔成功不等於 Viewer 已切換；命令 ACK 不等於可見效果已驗收。

## Coding 規範

1. **隔離與最小改動**：從 freshly fetched origin/main 以 repo helper 建立新 sibling worktree；main 與先前 worktree 不作功能修改。保留既有檔案；commit、push、PR、merge 與部署依當次明確授權執行，不以測試通過取代授權或人類核准。
2. **責任分界**：前端只經 Coordinator 呼叫轉檔控制；Streaming server 執行轉檔；Kit 負責載入與渲染。沿用 React / TypeScript / Vite 與既有設計 token，不新增第二套狀態或樣式系統。
3. **先定契約再修改**：先核對現有 source / tests，寫出來源、attempt、產物、審查及 Viewer 的精確對應。缺少來源或版本資料明示「未知」，不得推算、以本機 HEAD 冒充 converter 的實際版本。
4. **來源與產物不可混用**：保留 IFC 來源身分、可取得的 object version / ETag / checksum。來源已改變時不得聲稱重轉同一份 IFC。每次新的轉檔意圖有獨立 attempt，原 IFC、舊產物與舊審查不被覆寫；USDC、mapping、entity index、metadata 必須來自同一成功結果。
5. **提交安全**：前端防重入，後端對同一意圖重試保持冪等；重新整理、重複點擊、網路回覆不確定不得產生不明重複工作。排隊中／處理中不再重複排入；失敗可明確重試，且保留舊成功結果。
6. **版本可追溯**：分開顯示既有產物產生時間／converter 版本，與目前服務可證明的版本。不將 Coordinator 或 frontend 的版本當成 conversion engine 版本。無歷史紀錄時顯示未知。
7. **狀態誠實**：依真 API 區分等待、排隊、處理中、成功、失敗、無權限、資料過期。不得用假進度、固定延時、樂觀修改 ledger 或 mock response 製造成功。重新整理失敗保留舊資料並標示非最新。
8. **Viewer 明確切換**：轉檔完成只代表產物可用，不自動中斷目前 Viewer。使用者按「以此結果建立並開啟審查」後，依既有 lease 規則切換，確認實際載入的新 Stage、第一幀與 DataChannel；不得重用指向舊產物的 session 並假稱已更新。清楚標示所選結果與目前觀看結果。
9. **權限不繞過**：沿用既有正常授權機制；不把 webhook / service token 放入前端，不要求一般使用者貼服務 token，不偽造操作者或只憑 client role 放行。403 明確解釋，且不得擅改 Linux allowlist、credentials、ACL 或從其他來源繞過限制。缺乏既有 operator 授權契約時列為待決，不自創放寬。
10. **可回復**：取消確認不送出工作；新轉檔失敗不破壞舊 Viewer／產物；可回看並明確開啟舊成功結果。不得提交 IFC、USDC 或機密到 Git。

## 本機真實驗收：全部必要項目通過才標示完成

- [x] 記錄測試 branch / base commit、服務實際版本、時間、獨立資料與埠，以及啟動程序 ownership；未提交 source SHA-256 清單保留在本機 evidence 目錄。
- [x] 受影響前後端 unit / integration / typecheck / build 通過；含冪等、來源變更、403、失敗、不完整產物及 session 綁定回歸測試。
- [x] 在本機 Chrome 操作實際功能；使用真實 MinIO IFC、Coordinator、conversion service、Kit / WebRTC，未使用 mock／靜態預覽代替。
- [x] 由模型詳情觸發已成功 IFC 的新轉檔，不重新上傳；取消未新增工作，雙擊確認只新增一筆。
- [x] 三筆真實獨立 attempt 成功，原結果仍可查；USDC、mapping、entity / pset / spatial / bbox index、metadata 保留於各次獨立目錄。
- [ ] 同意圖不確定回覆／重掛、403、來源變更及失敗狀態已通過 unit / HTTP integration；尚未在真實 MinIO 故障或真實未授權 operator 的 Chrome 情境重演。不得把測試 double 當成現場證據。
- [x] 新結果明確建立審查後才手動啟動 3D；三次結果的 Stage、first frame、DataChannel 均有本輪真實證據。
- [x] 實際可見模型、門構件亮黃定位與藍灰半透明背景；還原定位後可見紅色問題材質，再清除高亮。相機遮擋限制見下方，不宣稱完整取景驗收。
- [x] 切回第一次結果、重新整理及切到第三次结果後，Viewer 仍對應指定 Stage；舊 71 筆檢核結果清為 0，未自動套用舊 mapping / 高亮。
- [x] 保存關鍵步驟截圖與本輪操作紀錄；API、runtime、可見效果分開列出。

## 2026-09-15 本機操作與修復紀錄

### 環境與來源

- Worktree：`AI-BIM-governance.worktrees/ifc-usdc-reconversion`；branch：`feat/ifc-usdc-reconversion`。
- Base：`2bae4aa8ba79bbaaf66e8efb9b73cbd1f4d4fa29`；實機驗證時功能差異尚未提交，交付前已比對 21 個檔案的 SHA-256，與當輪 evidence 清單一致。
- Chrome route：`http://127.0.0.1:5184/ui#minio` → `#a1`。
- 本機獨立服務埠：Coordinator 8009、Governance 49107、conversion 49170、Kit signal/media 49171/48071、Kit manager 8019。舊 PR835 本機服務及 Linux 未修改。
- MinIO bucket：`bim-control`；object：`ifc-test/architecture/v1/model.ifc`；ETag：`7c5a1638bd699be671dbc5efe78be9dc-11`。真實 HEAD 後，下載 GET 以 `If-Match` 鎖定同一來源；不修改來源物件。
- Artifact metadata 回報 converter：`host-native-ifc-adapter/v2`。目前服務沒有 build identity 端點，因此 UI 明示版本未知；不以 worktree HEAD 冒充部署版本。
- 正式實際轉檔採 `ifcopenshell_openusd_identity`。先前單獨 HOOPS adapter preflight 的 ACL 失敗不代表這個實際 profile 失敗；未變更任何 ACL。

| 次數 | result ID | conversion ID | 實機結果 |
|---|---|---|---|
| 1 | `mw_bb0d78e13e583bda` | `stream_conv_20260915081906_96e89c27` | 成功；後續切回此結果，Stage 相符；真實檢核與定位／高亮操作 |
| 2 | `mw_3bddb3305cb7a3f2` | `stream_conv_20260915082649_bbdd5242` | 成功；明確建立新審查並載入此結果；第一次产物仍保留 |
| 3 | `mw_912c5a3b7d182a5a` | `stream_conv_20260915094906_54813240` | 雙擊確認只新增這筆；處理中重整後成功；最新 Viewer Stage 相符 |

最新 Viewer：`review_session_request_87c82f0e3748054d036e296be6ef2f7a71e0dfd2ca6ebfeda99b23ba2b82ad23`，lease：`viewer_lease_f7653fbc54f2e55b`，Kit：`kit_local_001`。預期與實際皆為 `http://127.0.0.1:49170/artifacts/stream_conv_20260915094906_54813240/model.usdc`，first frame / DataChannel 為 observed。

### 真實操作發現後修復

1. 左側來源狀態仍依原始 watcher ID 查詢而顯示未轉：改以 bucket、object key、ETag 對應新 attempt 並刷新。
2. A1 收到新審查連結卻顯示「無需重驗」：改依 runtime active/created session 驗證，只消費一次 handoff，後續手動改選仍優先，不自動 claim lease。
3. 新 attempt 無法在 A1 找到下載紀錄：以選定審查的 ready result、來源 key 與 ETag 精確對應，不回退另一筆 attempt。
4. 同一結果的新審查不是 intake 原始 `review_session_id`，舊 for-session 入口回 404：新審查的 CPU rule-run 使用現有 for-ifc-ready 精確 job 入口，保留目前 Viewer 審查，未修改後端 session 權限契約。
5. 新結果面板不顯示可能含 signed URL 的原始錯誤；使用安全 failure code。未使用的確認理由欄位移除，避免讓使用者以為會記錄到後端。

真實 rule-run `rr_33723d78028a` succeeded：72 次評估、1 passed、71 failed。這是規則檢核完成且發現問題，不是轉檔失敗。67 個問題構件有對應，4 個無法定位；未偽造這 4 個的高亮。門 GUID `3$xKPHQlD10AG1nzmJabuU` / prim `/World/Elements/IfcDoor/G_3_xKPHQlD10AG1nzmJabuU` 的亮黃定位、半透明背景及紅色問題材質均在 Chrome 可見。

### 當輪 checks

- Coordinator：`npm test -- --silent`，125 files / 2163 tests passed；`npm run build` passed。
- Frontend：`npm test -- --silent`，139 files / 1968 tests passed；`npm run test:session-first`、`npm run typecheck`、`npm run build` passed。
- Kit：此 worktree `repo.bat build` passed；真正的 runtime 證據另由 Chrome first frame / Stage / DataChannel / 命令回覆與截圖取得。
- `git diff --check` passed。主 checkout HEAD 與本機 `origin/main` 相等，tracked files 未修改；另出現 `%SystemDrive%/ProgramData/Microsoft/Windows/Caches` 未追蹤目錄，未確認 producer，未刪除或搬動，不宣稱主 checkout 完全無 untracked files。
- 交付前重跑 Coordinator 全套 2163 tests 與 build、Frontend 全套 1968 tests、session-first、typecheck 與 build；PR safety 的 8 項測試通過。commit range safety 與遠端 CI 於提交後另行核對。
- 本輪尚未部署 Linux 或驗證 Linux 畫面；不能用本機證據代替。

### 截圖與可重現步驟

本機 evidence root：`C:/Users/IOT/.codex/visualizations/2026/09/14/01a09db3-50be-7022-8b4a-687b67edfc71/ifc-reconversion-validation/`。

- `09-clean-confirmation.png`：保留舊資料的簡短確認視窗。
- `10-single-pending-attempt.png`：雙擊後只有一筆 pending，新的重新轉檔按鈕停用。
- `11-three-successful-results.png`：三筆成功結果，来源 ETag 一致。
- `12-latest-result-stage-matched.png`：第三次結果 expected == loaded、first frame / DataChannel observed。
- `05-old-result-live-3d.png`：第一次结果仍可觀看。
- `06-reconverted-result-focus.png`：亮黃色門與半透明背景。
- `07-restored-view.png`：退出定位強調後保留紅色問題材質。
- `08-highlight-cleared.png`：清除高亮後畫面仍在原近距離視角；被恢復不透明的遮擋構件遮住，不能以此截圖宣稱灰色外觀已完整驗收。
- `processes.g3.clixml`、`restart-g2-ownership.clixml`：只保留本輪程序 creation identity / owner 證據；無機密值。

重現：模型庫 → `ifc-test/architecture/v1/model.ifc` → 重新轉檔 → 確認 → 等待成功 → 指定結果「以此結果建立並開啟審查」→ A1「啟動 3D」→ 連線診斷比對 Stage。A1 如需規則檢核，再選同一 MinIO IFC → 選取已下載模型 → 執行規則檢核；新審查不會被改回 intake 原始審查。

### 已知限制與後續

- 真實 403、下載失敗／來源變更及回覆遺失恢復，尚需受控實機故障情境；已有 deterministic tests，不列為當輪現場通過。
- Renderer 正常全景偏亮；定位退出保留相機，恢復不透明背景後可能遮住鏡頭。此輪未改 rendering / camera 演算法；可用「建築主體」重新取景，不能將近距離黑畫面誤當 WebRTC 斷線。
- 4 個門構件缺 mapping，保留明確不可定位狀態；未擴大修正 conversion geometry coverage。
- 使用者尚未逐項確認這版結果歷史與操作介面。後續已授權交付，但此紀錄及本機通過均不是新 PR exact-head CODEOWNER approval；故障情境仍保留未驗證標示。

## 完工與交付用語

- 「實作完成、尚未真實驗證」不等於「功能完工」。
- 任一必要項目失敗或受環境／權限阻擋，標示未完成，寫明重現方式、已排除原因與下一步。
- 不把 Windows 本機通過當成 Linux 已通過；merge 與 Linux 部署須另外依當次授權與保護規則辦理。
- 本規範是本次功能驗收契約，不新增通用治理框架，也不取代 repo 的安全與人類核准規則。
