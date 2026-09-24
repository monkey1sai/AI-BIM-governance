# 架構深化第二批：181 真站 Verification 3（2026-09-24）

本次驗證以下 PR 的 ADR Verification 3，在 canonical Linux 181 上執行：

- Mutation Gate bullet 2：#936，以及 review 後續 #937
- Viewport Slot bullet 2：#941，以及測試補強 #946
- Review Session Opening bullet 3：#949

執行條件：

- 部署：`72078f4`。
- 操作方式：在 owner 看得到的 Chrome 裡，透過 console `http://<canonical-host>:8004/ui` 逐步操作，截圖逐步貼在對話中。
- 時間：09:09～09:24（UTC）。
- 紀錄方式：09:09:58Z 在 console 頁面裝上 fetch 紀錄器與 vg01 訊息監聽器。

主機一律寫成 `<canonical-host>`。本資料夾不含專案名稱、IFC 路徑、GlobalId、IFC／USDC 檔案，也不含截圖，因為截圖上有專案名稱。

## 部署與 Kit 版本（VERIFIED）

**部署**

- `rebuild-test-deploy.ps1 -Build` 結束碼 0。
- 部署 tag `deploy-20260924-639258376591237089-004` → `72078f4`。
- 三道 CFD run guard 都放行，部署前沒有進行中或排隊中的 run。
- 181 部署目錄的 `git rev-parse HEAD` 是 `72078f4a…`。
- coordinator 與 viewer 容器在 09:07:37Z 左右重建。

**Kit**

181 的部署紀錄依序顯示：

1. `kitRuntime=NEEDS_BUILD`：Kit 輸入有變更。
2. `Phase 2 previous Kit tree released`：舊 Kit 的程序全部停掉。
3. `Kit runtime build artifacts ready`。
4. `Phase 4c Kit ready`：`:49100` LISTEN、`app ready`、primary stream server。
5. `Phase 4c Kit media gate passed on attempt 1: offer with video track in 45ms`。
6. 在新的 Kit 程序上偵測到 GPU context。
7. kit-manager-api 因部署版本改變而重啟，health 200。

新 Kit 程序在 09:07:29Z 啟動。部署後的原始碼含有 #936 新增的 `MutationGate.reauthorize`，Kit log 也有 bullet 2 之前不會出現的 `measurementRequest` trace 驗證行（見下）。兩者共同證明執行中的是新程式。

## Verification 3 結果

操作使用的是一個進行中、位於 request namespace 的 review-request carrier：`review_session_request_934d…a321c2`，ready model 為 `mw_01b2e0cb69640956`。

| ADR | 項目 | 結果 | 證據 |
|---|---|---|---|
| Mutation Gate | camera view 經授權後套用 | 通過 | 09:15:47Z `camera_view_result` applied（俯視）；Kit `datachannel trace accepted for cameraViewRequest` |
| Mutation Gate | camera view 因無效 lease 被拒 | 通過 | 做法與結果見下方「無效 lease 被拒」 |
| Mutation Gate | 開始量測（bullet 2：量測走 gate） | 通過 | start 後點兩點，得到 `result`，兩點直線距離 44.023 m。Kit 在 09:17:31、09:17:34、09:17:37Z 各記一行 `datachannel trace accepted for measurementRequest`，分別對應 start 與兩次點選 |
| Viewport Slot | 閘門各階段：session → lease → 第一幀 → ready | 通過 | 依序顯示「已取得操作權，等待 3D 畫面」、「已收到畫面，載入模型與審查相符」，流程列顯示「3D 就緒；命令通道可用」 |
| Viewport Slot | 相機、剖切、飛行、疊圖指令 | 通過 | 細項見下方「Viewport Slot 指令明細」 |
| Viewport Slot | lease 變更讓指令狀態失效 | 通過 | 注入假 lease 的當下（09:18:31Z），相機、相機狀態、飛行、剖切、量測五個狀態都變成 `unconfirmed` |
| Viewport Slot | A2 批次套用 | **未做** | 依 owner 決策 2A 延後 |
| Review Session Opening | open_existing（request namespace 的 carrier） | 通過 | 200，`session_status: active`、`session_replay: true`。bullet 3 起 open-existing 改用較嚴格的共用 predicate |
| Review Session Opening | viewer-lease claim（同一個 carrier） | 通過 | 兩次都是 200：09:14:47Z 與 09:19:34Z。bullet 3 起 lease claim 改用共用 predicate |
| Review Session Opening | create_new | 通過 | 200，`session_status: created`、`session_replay: false` |
| Review Session Opening | legacy | 通過 | 同一分頁以空 body 呼叫，200，`review_session_3ec3b3717674`，`session_status: active`、`session_replay: true`。console 沒有會送出 legacy 請求的按鈕 |
| Review Session Opening | recreate | 通過 | 201，由 `review_session_49957b6468d8` 建立 `review_session_2f288ee2e54ab15ee21635e4`，`idempotent_replay: false` |

### 無效 lease 被拒

**做法**：09:18:31Z 在 console 頁面，透過既有的 vg01 `viewer_lease_token` 通道，把一個刻意造的假 lease 字串 postMessage 給 viewer iframe。這個字串以 `e2e-invalid-lease-` 開頭，不是任何真憑證。之後按「前」。

**結果**：

- 09:18:44Z viewer 回 `camera_view_result` `error`／`rejected`。
- viewer 顯示「執行階段命令遭拒絕：檢視者 lease 無效或已過期（`lease_invalid`）（請勿盲目重試）」。
- 3D 畫面沒有轉動。
- Kit 同一秒先記 `datachannel trace accepted for cameraViewRequest`，再記 `forwarded commandRejected`。所以 trace 驗證通過，拒絕來自 coordinator 的授權。

**恢復**：

- 09:19:23Z「離開 3D 檢視」release 200。
- 09:19:34Z 重新 claim 200。
- 09:19:54Z「等角」`camera_view_result` applied。

### Viewport Slot 指令明細

| 指令 | 時間 | 結果 |
|---|---|---|
| 相機 | 09:15:47Z | 套用 |
| 剖切 | 09:16:25Z | 套用，Z・+・5 |
| 剖切 | 09:16:37Z | 關閉，`off` |
| 飛行 | 09:16:55Z | 速度 2，套用 |
| 相機狀態回讀 | 09:16:58Z | 回讀成功 |
| 疊圖 | 09:20:52Z | 用既有 run `cfd_20260924T025848Z_c69d41` 的 0° 方向，`POST …/cfd-overlays` 201 |
| 疊圖 | 09:20:53Z | `EmbeddedViewer.applyStageBinding` 收到 `stage_binding_result` applied，並列出 CFD layer |
| 疊圖透明度 | 09:21:25Z | `overlay_style_result` applied，透明度 0.15 |
| 關閉疊圖 | 09:21:52Z | `stage_binding_result` applied，沒有 secondary layer |

疊圖的兩次 `stage_binding_result` 都由 #941 移到 `EmbeddedViewer` 的對照邏輯結算。`clientRequestId` 為 32 位 hex，沒有舊的 `viewer_highlight_` 前綴。

## 未做的項目

- **#937：coordinator 無法建立 trace 時回 503**
  - 要在 181 觸發這條路徑，得讓 coordinator 讀不到某個 session 的 trace，例如損毀 session 檔。在共用的測試主機上不做這件事。
  - 這條路徑由 coordinator 與 Kit 的測試涵蓋，分別在 #937 與 #936 的測試中。
- **Viewport Slot：A2 批次套用**：依 owner 決策 2A 延後。

## 觀察到、未追查

- recreate 回應的 `activation_state` 是 `not_requested`、`kit_availability` 是 `unavailable`。本次沒有啟動這個新 session 的 3D，所以沒有追查原因。
- console 頂端的 GPU 狀態顯示「未取得」。部署紀錄顯示已在新的 Kit 程序上偵測到 GPU context，兩者為何不同沒有追查。

## E2E 在 181 上留下的資料

- 新建 session：
  - `review_session_request_64a8b5be…cb52bb`：create_new，尚未啟動。
  - `review_session_2f288ee2e54ab15ee21635e4`：recreate，尚未啟動。
- `review_session_request_934d…a321c2` 新增一筆 CFD overlay 登記：`binding_cfd_cfd_20260924T025848Z_c69d41_w000`。疊圖之後已從 stage 關閉。
- 本次使用的兩個 viewer lease 都已 release。
- 沒有關閉或刪除任何既有 session，也沒有建立 CFD run。

## 檔案

- `http-pairs.json`：
  - `pairs`：各步驟的 HTTP request／response。
  - `vg01_replies`：viewer 從 Kit 轉回的回覆。
  - 截斷或未擷取的部分都有標明，沒有任何內容是補寫的。
- `kit-log-excerpt.txt`：新 Kit 在 09:14～09:24Z 的 `mutation_gate` 授權行，以及 `commandRejected` 轉送行。原始的相對毫秒欄已移除，其餘逐字保留。
