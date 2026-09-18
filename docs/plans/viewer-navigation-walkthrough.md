# 3D 檢視與第一人稱遊走：設計

日期：2026-09-17。狀態：**設計已逐段確認，尚未實作**；本檔不是 runtime 完成證據。
衝突時依序採用：使用者最新指令、根目錄 `AGENTS.md`、設計正本、本檔。
與 CFD 的關係：本設計在 `building-energy-cfd.md` 的 CFD 工作之前進行；CFD 結果日後也在同一個工作台檢視。

## 1. 已確認的決策

| 項目 | 決策 |
|---|---|
| 套用範圍 | 只在統一工作台（`web-viewer-sample/src/console/unified/`）已啟動的 **primary viewer**；spectator 維持唯讀 |
| 遊走 | 分兩期：第一期接通 Kit 內建飛行，第二期做真實步行（固定眼高、貼地、碰撞、樓梯） |
| 第一期檢視功能 | 視角預設與投影切換、視角書籤、樓層與構件隔離、小地圖 |
| 書籤存放 | 存在審查紀錄，多人共用 |
| 裝置 | 只支援桌機鍵盤滑鼠 |
| 架構 | 方案 A：擴充 Kit 指令，由統一工作台控制，coordinator 提供書籤 API |
| 交付 | 第一期拆成 1a → 1b → 1c → 1d 四段，每段都要本機真實 Chrome 操作驗收 |

**非目標**：平板觸控、整套採用 USD Explorer 的 Kit 內介面、瀏覽器自製第一人稱、修改 governance-service、部署到 canonical Linux 測試機（需另外授權）。

## 2. 現況查證（main `dd1ad9b`）

| 項目 | 現況 |
|---|---|
| Kit 內建操作 | Alt＋左鍵旋轉、中鍵平移、Alt＋右鍵縮放、**按住右鍵＋WASD／QE 飛行、滾輪調速**（`web-viewer-sample/README.md:255`）。瀏覽器以官方串流元件轉送滑鼠鍵盤；**在統一工作台內嵌 viewer 是否可用尚未驗證** |
| 工作台預留按鈕 | 「相機視角」「投影模式」「書籤」已預留但停用（`WorkspacePage.tsx:287`、`:306`、`:349`） |
| 預留訊息 | `camera_view`、`toggle_projection` 已在型別中（`unified/viewportSlot.ts:39`），但 `Window.tsx:2632` 收到後不做任何事 |
| Kit 指令 | 現有選取、重置取景、高亮、聚焦、剖切、量測（`stage_management.py:109` 起的指令表）；沒有視角預設、相機讀取、步行 |
| 可沿用的模式 | 剖切的請求、回覆比對與狀態（`sectionPlaneBridge.ts:48` 的 `SectionPlaneExchange`）；會改變畫面的指令清單（`runtimeCommandProtocol.ts:12`）；操作權判斷（`unified/viewportSlot.ts:102`） |
| 剖切 | RTX 設定 `/rtx/sectionPlane/plane` 接受以 4 個係數為一組的平面清單（`section_plane.py:5`、`:20`）；目前只用一個平面，**多平面的實際效果未驗證** |
| BCF 視點 | 只記錄選取的構件，沒有相機（`governance-service/bcf/bcf_writer.py:86`） |
| 官方導覽套件 | app 只相依 `omni.kit.manipulator.camera`（`ezplus.bim_review_stream.kit:27`）。USD Explorer 的官方導覽說明只列出旋轉、觀看、飛行、平移、縮放、傳送，未提到重力、碰撞或固定眼高；`omni.kit.waypoint.core` 把書籤存在場景中（見 §10） |
| coordinator | 每個審查一個 JSON 檔，先寫暫存檔再改名（`sessionStore.ts:282`）；操作權驗證用 `X-Viewer-Lease-Token` 加 `viewerLeaseStore.authorizeActive`（`app.ts:3088`），回傳的 lease 帶 `role`（`viewerLeaseStore.ts:15`） |
| 樣本資料 | 真實建築樣本有 921 個名稱重複的 `IfcBuildingStorey`，樓層必須先整理 |

## 3. 方案比較

| 方案 | 內容 | 結論 |
|---|---|---|
| **A** | 擴充 Kit 指令；統一工作台提供按鈕與狀態；飛行沿用官方輸入轉送；coordinator 存書籤 | **採用**：符合官方 API 優先，權限與驗證沿用現有機制 |
| B | 瀏覽器鎖定滑鼠，把移動轉成高頻相機指令 | 不採用：延遲加倍，干擾官方輸入轉送，形同自製傳輸層 |
| C | 整套採用 USD Explorer 官方套件 | 不採用：介面畫在串流畫面內、不在工作台；書籤存在場景，和決策衝突；官方說明也未提到重力與碰撞 |

## 4. 元件與分工

**瀏覽器（`web-viewer-sample`，只在統一工作台生效）**

| 單元 | 職責 |
|---|---|
| `WorkspacePage.tsx` 工具列 | 接通「相機視角」「投影模式」「書籤」；新增「飛行」「樓層」「隔離」「小地圖」入口 |
| `CameraViewControls`、`FlyNavigationControls`、`BookmarkPanel`、`LevelControls`、`IsolationControls`、`MiniMap` | 各自一個檔案，只負責畫面與狀態顯示 |
| `cameraViewBridge.ts` 等指令模組 | 依 `sectionPlaneBridge.ts` 模式產生與解析指令、帶請求編號、依 Kit 回報值確認；純函式，可單元測試 |
| `Window.tsx`（iframe 內） | 接通 `camera_view`、`toggle_projection` 與新指令；一律檢查操作權（`canOperate`） |
| `bookmarksClient.ts` | 呼叫 coordinator 書籤 API |

**Kit（`ezplus.bim_review_stream.messaging`）**

| 單元 | 職責 |
|---|---|
| `camera_view.py` | 六個預設視角（依目前取景範圍）、透視與正交切換、讀取與套用相機狀態；優先使用官方 `omni.kit.viewport.utility` |
| `fly_navigation.py` | 飛行速度，沿用官方 `omni.kit.manipulator.camera` 的設定值 |
| `level_section.py` | 依樓層高度套用剖切面；和現有剖切共用擁有權判斷 |
| `isolation_overlay.py` | 隔離、隱藏、其餘半透明；沿用 `focus_overlay.py`、`highlight_overlay.py` |
| `stage_management.py` | 登記新指令；會改變畫面的指令經過 `_authorize_mutator`；換場景時清除上述狀態 |

**coordinator**

| 單元 | 職責 |
|---|---|
| `viewBookmarkStore.ts` | 每個審查一個 JSON 檔，先寫暫存檔再改名；以 `revision` 防止同時修改互相覆蓋 |
| `viewBookmarkRoutes.ts` | 書籤讀取、新增、改名、刪除；寫入需要 primary 操作權 |

**轉檔（只有 1c、1d 需要）**：`ifc_openusd_identity_author.py` 產生樓層索引，1d 另產生平面圖資料，兩者都登記成可下載產物。**不修改凍結的 `conversion_authority.py`**（`docs-plans-README.md` §3 第 4 點）。

**不修改**：governance-service、`governanceProxy.ts`，以及 spectator 的串流路徑。

## 5. 資料流與契約

### 5.1 相機狀態 `camera-state/v1`

Kit 回報、書籤儲存、小地圖共用同一份結構：

```json
{ "projection": "perspective | orthographic",
  "position": [0.0, 0.0, 1.6], "direction": [0.0, 1.0, 0.0], "up": [0.0, 0.0, 1.0],
  "target_distance": 12.5, "fov_deg": 60.0, "ortho_height": null }
```

- 單位公尺、Z 軸朝上，與轉檔產物一致。
- 欄位對齊 BCF 相機定義（位置、方向、上方向、視角或正交視野高度），日後可附在 issue 上。
- 透視時 `fov_deg` 有值、`ortho_height` 為 `null`；正交時相反。
- 前、後、左、右以**模型座標**為準，不是真北。

### 5.2 瀏覽器與 Kit 之間的指令

每個指令都帶請求編號，Kit 回報實際生效的值，UI 依回報值確認。

| 指令 | 內容 | 回報 | 需要操作權 |
|---|---|---|---|
| `cameraViewRequest` | `preset`（`top`、`front`、`back`、`left`、`right`、`iso`，加 `scope`）／`projection`／`apply_state`（書籤） | `cameraViewResult`，含套用後的相機狀態 | 是 |
| `cameraStateRequest` | 讀取目前相機 | `cameraStateResult` | 否 |
| `cameraStateSubscribe` | `enabled`；小地圖開啟時訂閱，每秒最多 5 次 | `cameraStateChanged`，含序號 | 否 |
| `flyNavigationRequest` | 飛行速度 | `flyNavigationResult` | 是 |
| `levelSectionRequest` | `enabled`、`level_id`、`cut_height_m`（預設 1.2） | `levelSectionResult`，含實際上下界 | 是 |
| `isolationRequest` | `isolate`／`hide`／`ghost_others`／`clear`；單次最多 4,096 個 prim 路徑（與 `highlight_overlay.py:25` 相同），可傳類別層路徑（例如 `/World/Elements/IfcSpace`）一次處理整類 | `isolationResult`，含找不到的數量 | 是 |

- **兩種剖切互斥**：套用樓層剖切會關閉手動剖切，反之亦然；回報帶出目前狀態，兩邊 UI 一起更新。
- 需要操作權的新指令加入 `runtimeCommandProtocol.ts` 清單與 Kit 權限檢查；spectator 送出時回 `spectator_readonly`。
- 換場景時，Kit 清除樓層剖切、隔離與相機訂閱。

### 5.3 coordinator 書籤 API

路徑：`/api/review-sessions/:sessionId/view-bookmarks`

| 方法 | 內容 | 權限 |
|---|---|---|
| `GET` | 回傳 `{ revision, bookmarks }` | 審查參與者，含 spectator |
| `POST` | `{ lease_id, name, camera, level_id?, expected_revision }` | `X-Viewer-Lease-Token` 通過 `authorizeActive`，且 `role` 為 `primary` |
| `PATCH /:bookmarkId` | `{ lease_id, name, expected_revision }` | 同上 |
| `DELETE /:bookmarkId` | `lease_id`、`expected_revision` | 同上 |

- **錯誤碼**：400 格式錯誤、401 操作權缺少或無效、403 操作權有效但角色不是 primary、404 找不到、409 版本衝突、413 超過每個審查 200 筆。
- **書籤記錄**：`bookmark_id`、`name`（限長度）、`created_by`、`created_at`、`updated_at`、`model_version_id`、當時場景的 USDC 產物識別與 SHA-256、`camera`、`level_id`（可省略）。
- 模型版本或產物不同時，UI 停用「套用」並說明原因。
- 存放位置：`<coordinator storage>/view-bookmarks/<session_id>.json`。

### 5.4 樓層索引 `level_index.json`（1c）

```json
{ "format_version": 1,
  "levels": [ { "level_id": "L03", "label": "FL2", "elevation_m": 4.85,
                "elevation_range_m": [4.5, 5.7], "source_storey_count": 139 } ],
  "warnings": [] }
```

- 依 `IfcBuildingStorey` 高度分群，名稱取該群最常見的樓層名；分群門檻在 1c 以真實樣本實測後定案。
- UI 列出每層包含的原始樓層名稱與高度範圍，讓使用者判斷；人工覆寫列為後續。

### 5.5 小地圖資料（1d）

格式由 1d 的小型驗證決定。候選一是用 IfcOpenShell 依樓層產生向量平面圖，候選二是用現有 `bbox_index.json` 畫構件外框示意。

## 6. 錯誤處理

- **UI 狀態沿用剖切**：idle → pending → applied／off，另有 unconfirmed 與 error。錯誤原因分為格式錯誤、忙碌中、不可用、被拒絕、傳送失敗、逾時、回報不符。同一控制項一次只送一個指令；逾時顯示「尚未確認，請看畫面」，不假設成功或失敗。
- **操作權**：`resolveViewerCommandGate` 不允許時，會改變畫面的按鈕全部停用，並寫明原因：等待 viewer、沒有操作權或 spectator 唯讀。
- **飛行**：瀏覽器無法得知 Kit 是否收到按鍵，UI 只顯示操作說明與「先點一下 3D 畫面」；速度以 Kit 回報值為準。飛行速度是 Kit 的全域持久設定（`/persistent/app/viewport/camMoveVelocity`），會沿用到之後的審查與 Kit 重啟。
- **速度 1 等於步行速度的 5 倍（7 m/s，步行以 1.4 m/s 計，容許 ±10%）**：Kit 內建飛行不依場景單位換算，原設定在公尺場景下速度 1 約每秒 415 公尺。每次開啟場景時，Kit 依 `metersPerUnit` 改寫官方設定 `/persistent/app/viewport/manipulator/camera/flyAcceleration`，公尺場景約為 16.854。換算依據：按鍵輸入為 5 × 速度、阻尼 10、每格時間上限 0.0166 秒、串流主迴圈 60 Hz。
- **書籤**：409 時重新載入清單並請使用者再試；套用後比對回報的相機，位置差 1 cm、方向差 0.1° 以內算成功，否則顯示尚未確認。
- **舊轉檔沒有樓層索引**：樓層選單停用，提示使用既有的「重新轉檔」產生新結果。
- **隔離**：回報找不到的 prim 數量，不假裝全部成功。
- **小地圖**：訂閱中斷時顯示「位置未更新」與最後更新時間，不顯示推測位置。
- **換場景、換審查或失去操作權**：衍生狀態一律重設或標為尚未確認，舊的剖切與隔離不套到新模型。
- **輸入驗證**：書籤名稱限長度；相機數值必須為有限值且在合理範圍；請求編號沿用現有格式檢查。
- **紀錄**：Kit 指令結果寫入現有 Kit 結構化 log；書籤異動寫入 coordinator 事件紀錄；兩者都不含憑證。

## 7. 分段交付與驗收

### 7.1 各段內容

- [ ] **1a 相機檢視**：先驗證內嵌 viewer 能收到右鍵加 WASD；六個預設視角、透視與正交切換；飛行按鈕、速度與操作說明。
- [ ] **1b 視角書籤**：Kit 讀取與套用相機；coordinator 書籤儲存與 API；工作台書籤面板。
- [ ] **1c 樓層與構件隔離**：樓層索引；樓層剖切；隔離、隱藏、其餘半透明。
- [ ] **1d 小地圖**：平面圖資料小型驗證；位置與朝向；點擊跳轉。

### 7.2 測試（每段先寫測試再實作）

| 範圍 | 測試 | 命令 |
|---|---|---|
| 瀏覽器 | 指令模組、控制項、`Window.tsx` 轉送、操作權判斷 | `npm test`、`npm run test:session-first`、`npm run typecheck`、`npm run build` |
| Kit | 控制器以注入的假物件測試（依 `tests/test_section_plane.py` 模式）；權限清單 | `.venv\Scripts\python.exe -m pytest tests/<對應檔> -q`、`repo.bat build` |
| coordinator | 書籤儲存（原子寫入、版本衝突、上限）；路由（401、403、404、409、413、primary 與 spectator） | `npm test`、`npm run build` |
| 轉檔（1c、1d） | 合成 IFC 的樓層分群；新附屬檔登記為可下載產物 | `pytest tests/test_conversion_authority_api.py` 與新增測試 |

Kit 端測試只證明設定與指令邏輯，**不證明 GPU 畫面**（`tests/test_section_plane.py` 檔頭已註明），畫面效果由 §7.3 驗收。

### 7.3 本機真實 Chrome 操作驗收（每段都做）

**環境**：本機獨立服務埠、真實建築 IFC、真實 Kit 與 WebRTC，在真實 Chrome 操作。Playwright 內建的 Chromium 不支援 H.264，不能作為畫面證據。

**共同證據**：first frame、Stage 與預期相符、每個指令的 DataChannel 回報、操作前後截圖。

| 段 | 驗收重點 |
|---|---|
| 1a | 六個預設視角、投影切換；按住右鍵加 W 後，截圖與相機回報都顯示前進；速度調整生效 |
| 1b | 建立書籤 → 移動 → 套用，回報一致；另一個瀏覽器 profile 看得到書籤；spectator 能看清單，新增得到 403，套用被 Kit 以 `spectator_readonly` 拒絕 |
| 1c | 樓層清單合理；樓層剖切畫面正確；兩種剖切互斥；隔離、隱藏、半透明、清除都可見 |
| 1d | 平面圖顯示；飛行時位置與朝向更新；點擊可跳轉 |
| 共同 | 換場景後狀態重設；失去操作權後按鈕停用 |

截圖與操作紀錄只存本機，不進公開 repo；PR 列出實際執行的檢查與未驗證項目。靜態檔案、測試替身或歷史紀錄不算通過。

## 8. 第二期：真實步行（大綱）

- 模式切換：「飛行」與「步行」二選一，步行時固定眼高（預設 1.6 m，可調）。
- 貼地：每次移動後向下偵測地面，相機高度＝地面＋眼高。
- 碰撞：移動前檢查前方障礙，牆體不可穿越；門洞可通過。
- 樓梯：只允許跨越不超過設定高度的台階。
- 需要在 Kit 端自製控制器，偵測方式（物理碰撞體或網格射線查詢）先做小型驗證，並量測 6 千多個構件時的效能。
- 第二期開始前另做一次設計確認。

## 9. 實作前待確認

| 編號 | 項目 | 何時確認 |
|---|---|---|
| V1 | 統一工作台內嵌 viewer 能否收到右鍵加 WASD 與滾輪 | 1a 第一步 |
| V2 | Kit 110 的官方相機狀態 API；正交投影做法（內建正交相機或修改投影屬性） | 已確認：以 `omni.kit.viewport.utility` 取得作用中相機、`TransformPrimCommand` 在 session layer 寫入相機位置，六個預設視角回報方向與預設方向一致；正交採修改投影屬性，光圈以每世界單位 10 換算。回報的正交高度等於透視在目標距離的可視高度，這只是換算公式本身的自洽性檢查，不是獨立證據；獨立證據為 A4 截圖比對（切換前後建物大小相近），切回透視後恢復原視角（2026-09-17 本機驗收 A2、A4） |
| V3 | 飛行速度的官方設定鍵 | 已確認設定可套用：`/persistent/app/viewport/camMoveVelocity`，設 3 後回報 3（A5）。速度 1 已校正為步行速度的 5 倍（見 §6），實際前進距離待 V1 以真實按鍵量測 |
| V4 | 多個剖切面同時作用的畫面效果 | 1c |
| V5 | 新附屬檔登記為可下載產物時不需修改 `conversion_authority.py` | 1c |
| V6 | 樓層分群門檻 | 1c |
| V7 | 小地圖資料來源 | 1d |
| V8 | 步行的地面偵測與碰撞方式與效能 | 第二期 |

## 10. 參考

- NVIDIA，USD Explorer 導覽：<https://docs.omniverse.nvidia.com/explorer/latest/features/navigate/viewport.html>
- NVIDIA，Kit Viewport Navigation：<https://docs.omniverse.nvidia.com/extensions/latest/ext_core/ext_viewport/navigation.html>
- NVIDIA，`omni.kit.waypoint.core`：<https://docs.omniverse.nvidia.com/kit/docs/omni.kit.waypoint.core/latest/omni.kit.waypoint.core.html>
- 相關規劃：`building-energy-cfd.md`、`ifc-usdc-reconversion.md`、`operator-model-workflow-ux.md`。
