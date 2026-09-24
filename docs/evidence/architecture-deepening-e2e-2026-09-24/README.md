# 架構深化整批：181 真站瀏覽器 E2E（2026-09-24）

2026-09-23～24 合併的架構深化 PR，在 canonical Linux 181 上執行各 ADR 的 Verification 3：#919、#926（CFD Run Workflow）、#921、#927（Review Session Opening）、#922、#925（Mutation Gate）、#923（Viewport Slot）、#924（Coordinator Browser Client）。

- 部署：`be07a97`。
- 操作方式：在 owner 看得到的 Chrome 裡，透過 console `http://<canonical-host>:8004/ui` 逐步操作，截圖逐步貼在對話中。
- 時間：02:55～03:08（UTC）。

主機一律寫成 `<canonical-host>`。本資料夾不含專案名稱、IFC 路徑、GlobalId、IFC／USDC 檔案，也不含截圖，因為截圖上有專案名稱。

## 部署與 Kit 版本（VERIFIED）

- `rebuild-test-deploy.ps1 -Build` 結束碼 0，部署 tag `deploy-20260924-639258146191682142-001` → `be07a97`。三道 CFD run guard 都放行，部署前沒有進行中的 run。
- 181 部署目錄的 `git rev-parse HEAD` 是 `be07a976…`，`bim-streaming-server.params.json` 的 revision 也是 `be07a976…`。
- 部署紀錄顯示這次部署：
  - 偵測到 Kit 輸入變更（`kitRuntime=NEEDS_BUILD`），停掉舊 Kit、釋放舊 build tree，重新 build。
  - `Phase 4c Kit media gate passed on attempt 1: offer with video track in 49ms`。
  - 偵測到新 Kit 的 GPU context。
- 新 Kit 程序在部署期間啟動（host 時間 10:43:29）。部署後從工作站跑 media 探針，206 ms 收到含 video 與 audio 的 offer。
- `kit-log-excerpt.txt` 的指令授權行來自 #922 新增的 `…messaging.mutation_gate` 模組，也證明執行中的是新程式。

## Verification 3 結果

| ADR | 項目 | 結果 | 證據 |
|---|---|---|---|
| Coordinator Browser Client | console A1 流程：選模型 → 開啟審查 → 啟動 3D | 通過 | `http-pairs.json` open_existing、stage-binding、first-frame |
| Coordinator Browser Client | viewer lease claim、heartbeat、release | 通過 | claim 請求本身沒有被擷取；之後 heartbeat 每 15 秒以 `viewer_lease_84e0d199…` 回 200，切換審查時 release 同一個 lease 回 200、`role: primary`、`status: released`，所以 claim 取得了 primary lease |
| Viewport Slot | session 選擇 → lease → 第一幀 → DataChannel → ready | 通過 | console 顯示「3D 就緒；命令通道可用」與「已收到畫面，載入模型與審查相符」；Kit 記錄授權的 stage load |
| Viewport Slot | 相機、剖切、飛行、疊圖指令 | 通過 | UI 顯示 Kit 的回覆：相機狀態回讀、「已回覆設定：Z・+・5」、「速度已套用 2」、「Kit 已套用透明度 0.20」；Kit log 的 `mutation_gate` 對 camera、clip ×2、fly、overlay style 記錄 `trace accepted` |
| Viewport Slot | A2 批次套用 | **未做** | 見下方「未做的項目」 |
| Mutation Gate | camera view 經授權後套用 | 通過 | 02:56:18Z `datachannel trace accepted for cameraViewRequest`；畫面切到俯視並回讀相機狀態 |
| Mutation Gate | camera view 因無效 lease 被拒 | **未做** | 見下方「未做的項目」 |
| Mutation Gate | 開始量測 | 通過（UI） | start 之後點兩點，得到「兩點直線距離 61.105 m」。measurement 要到 Mutation Gate bullet 2 才走 gate，所以不在 `mutation_gate` 的 log 行內 |
| Review Session Opening | create_new | 通過 | 200，`session_status: created`、`session_replay: false` |
| Review Session Opening | open_existing | 通過 | 200（UI 按鈕；body 在紀錄器安裝前，未擷取） |
| Review Session Opening | legacy | 通過 | 同一分頁以空 body 呼叫，200、`session_status: active`、`session_replay: true`；console 沒有會送出 legacy 請求的按鈕 |
| Review Session Opening | recreate | 通過 | 201，由 `review_session_7132b6266f36` 建立 `review_session_76dc62fb…`，`idempotent_replay: false` |
| CFD Run Workflow | 建立 run → findings → 套用 overlay | 通過 | 建立 202（`cfd_20260924T025848Z_c69d41`，03:03:38Z ready）→ findings 201（`iss_32644f3a17b4`；重送 200、`idempotent_replay: true`）→ overlay 201，Kit 確認載入疊圖（`binding_rev_e923…`） |

## 觀察到、但不是回歸的行為

- `POST …/activity` 回 409。這個路由要在兩道 lease 檢查都通過後，才會回「Session activity requires an enabled idle policy and a connected viewer.」；181 的 idle policy 是關閉的（`timeout_ms: null`、`enabled: false`、`source: environment`）。
- console 的「關閉疊圖」沒有呼叫 overlay 移除路由，而是由 viewer 重新送出授權的 stage load（03:05:21Z）。所以這次 E2E 沒有經過 `DELETE …/cfd-overlays`。

## 未做的項目

- **Mutation Gate：無效 lease 被拒**
  - console 送出的指令一定帶著有效的 lease，viewer 是跨源的 iframe（`:5173`），而且沒有測試掛鉤。
  - 181 只有一個 primary Kit；另開 primary viewer 搶 lease，會干擾正在使用的連線。
  - 要驗證這條路徑，需要另行設計不干擾 Kit 的方法。
- **Viewport Slot：A2 批次套用**
  - 181 的 MinIO 已下載模型都是同一個模型版本（加一個不同的測試模型），檔案庫只有 `manual-upload`，做不出有意義的版本差異。
  - A2 的「套用 3D Overlay」在 console 上標示「尚未提供」。
- **Coordinator Browser Client：A4 revalidation**。沒有 A4 handoff 的測試資料，這次未涵蓋。

## E2E 在 181 上留下的資料

- CFD run `cfd_20260924T025848Z_c69d41`（ready）。
- governance issue `iss_32644f3a17b4`：annotation，由 findings 建立。
- 新建 session：
  - `review_session_request_5a736cbc…`（create_new，尚未啟動）。
  - `review_session_76dc62fb…`（recreate，尚未啟動）。
- 沒有關閉或刪除任何既有 session 或 run。

## 檔案

- `http-pairs.json`：各步驟的 request／response。截斷或未擷取的部分都有標明，沒有任何內容是補寫的。
- `kit-log-excerpt.txt`：新 Kit 的 log 摘錄。
