# Stage Binding Execution bullet 1：181 真站 E2E（2026-09-24）

#940（`docs/architecture/stage-binding-execution-adr.md` tracer bullet 1）合併後，在 canonical Linux 181 上做 ADR 的 Verification 2，也就是 Grilling Record「Runtime evidence?」要求的真 Kit E2E。

- 部署：`87c1645`（#939、#940 合併後的 `origin/main`）。
- 操作方式：在 owner 看得到的 Chrome 裡，透過 console `http://<canonical-host>:8004/ui` 逐步操作，截圖逐步貼在對話中。
- 時間：06:31～06:38（UTC）。

主機一律寫成 `<canonical-host>`。本資料夾不含專案名稱、IFC 路徑、GlobalId、IFC／USDC 檔案，也不含截圖，因為截圖上有專案名稱。

## 部署與版本

- **VERIFIED**：
  - `rebuild-test-deploy.ps1 -Build` 結束碼 0，部署 tag `deploy-20260924-639258281867978075-003` → `87c1645`。
  - 三道 CFD run guard 都放行，部署前沒有進行中或排隊中的 run。
  - 本機留有這次部署的 effective-env 快照 `20260924T062946Z`。
  - 181 的 viewer（`:5173`）回應的 `src/stageBinding/execution.ts` 含 `createStageBindingExecution` 與審查後補上的 `disposed` 防護，所以執行中的 viewer 是 #940 的程式。
  - viewer 連上後，`/api/runtime/status` 的 `kit_local_001` `media_state` 為 `ok`。
  - 181 部署目錄的 HEAD 是 `87c16454`，`bim-streaming-server.params.json` 的 revision 是 `87c1645420c6…`（2026-09-24 補查，唯讀 SSH）。
  - 這次部署有重 build 並重啟 Kit：`_build` 的 Kit build log 在 06:28:42～06:29:26Z，新的 streaming Kit log 在 06:29:38Z 建立，06:29:40Z `app ready`。E2E 期間的指令都由這個新 Kit 處理（`kit-log-excerpt.txt`）。
- **更正**：本文件第一版寫「推論這次沒有重 build Kit」，這是錯的；上一點的 log 時間證實部署有重 build 並重啟 Kit。

## ADR 要求與結果

| ADR 要求 | 結果 | 證據 |
|---|---|---|
| A1 的 stage binding 套用 | 通過 | 選模型 → 開啟所選審查（既有 session）→ 啟動 A1 3D Session。primary lease claim 200；viewer 依序回報 `stage_loaded unproven` → `first_frame` → `stage_loaded active`，帶 `binding_rev_55908b37…` |
| first frame | 通過 | `first_frame` 訊息（06:32:55Z）與 `POST …/first-frame` 200；console 顯示「已收到畫面，載入模型與審查相符」 |
| `stage_loaded active` | 通過 | 三次 stage load 都先回報 unproven，由 Stage Proof 確認後轉為 active，各自帶新的 binding revision |
| CFD overlay 套用 | 通過 | 「顯示疊圖」→ `POST …/cfd-overlays` 200 → viewer 對 `…/stage-binding` 做預先授權（OPTIONS 204、POST 200）→ `stage_loaded active`（`binding_rev_77da7cbc…`）→ `stage_binding_result: applied`；console 顯示「Kit 已確認載入疊圖：binding_rev_77da7cbc…」，畫面出現行人面風速與流線疊圖 |
| DataChannel ACK | 通過 | Kit 端：`datachannel trace accepted for openStageRequest`（06:32:54Z）、兩次 `…for loadArtifactGroupRequest`（06:35:22Z、06:36:45Z），每次都接著 `forwarded loadArtifactGroupResult`／`forwarded openedStageResult via queue_event`（`kit-log-excerpt.txt`）。viewer 與 coordinator 端：primary lease `datachannel_ready: true`、`stage_match: true` |
| `bindingApplied` | **無法以目前 Kit 觀察** | 見下方「與 ADR 的落差」 |
| 每個 parent 請求只回一次 `stage_binding_result` | 通過 | 疊圖套用與關閉疊圖各一次 `applied`（06:35:22Z、06:36:45Z） |
| unconfirmed／resync 路徑（harness） | 通過（本機，輔助證據） | #940：`e2e/runtime-command-authority.spec.ts` 在本 branch 與改動前程式碼上都 6/6（headless Chromium、harness 模式），含「changed-unconfirmed 阻擋直到通過驗證的 resync」 |

`http-pairs.json` 記錄上述 request／response、viewer 傳給 console 的訊息序列，以及疊圖套用後的 runtime 狀態。

## 與 ADR 的落差：`bindingApplied`

ADR 的 runtime 證據清單列了 `bindingApplied`，但 `bim-streaming-server/source` 裡只有自動產生的命令詞彙表宣告這個事件，沒有任何程式會送出它（`git grep`，本 PR 的 base）。viewer 的 `applied` 也可以來自 `openedStageResult` 成功且 stage 證據吻合（`Window.tsx` 的 `binding 已套用（Kit openedStageResult 確認）`）。Kit log 證實這次 Kit 回覆的確認事件是 `openedStageResult`（三次）與 `loadArtifactGroupResult`（兩次），E2E 期間沒有任何 `bindingApplied`，所以三個 `applied` 都來自 `openedStageResult`（VERIFIED，`kit-log-excerpt.txt`）。

這需要 owner 決定：讓 Kit 送出 `bindingApplied`，或把 ADR 的證據項目改成 `openedStageResult`。

## 觀察到、但不是回歸的行為

- `POST …/activity` 回 409：181 的 idle policy 是關閉的，與 #931 相同。
- `POST …/cfd-overlays` 回 `idempotent_replay: true`：這個 run、這個風向的 overlay binding 是 #931 的 E2E 建立的。套用時仍然走了一次新的授權 stage load，產生新的 binding revision。
- 「關閉疊圖」會由 viewer 重送一次授權的 stage load（`binding_rev_693aca67…`），與 #931 觀察到的一致。

## 補查紀錄

第一版因為無法讀取 SSH 設定而沒有 Kit log 與 `params.json` revision。補查時改用 repo 正式部署流程的目標解析（`scripts/lib/deploy-target-registry.ps1` 的 `Get-DeployTarget -Canonical`，讀 repo 外的私有 inventory，只含 host 與 user）取得 SSH 目標，以唯讀指令讀取；host key 檢查維持開啟。

## E2E 在 181 上留下的資料

- 沒有建立新 session，使用既有的 `review_session_3ec3b3717674`。
- 沒有建立新的 CFD run，使用既有的 `cfd_20260924T025848Z_c69d41`。
- session 的 binding 歷史多了三個 revision：`binding_rev_55908b37…`、`binding_rev_77da7cbc…`、`binding_rev_693aca67…`。
- 疊圖套用後已關閉；離開 3D 檢視時 primary lease 已釋放（`POST …/release` 200）。
- 沒有關閉或刪除任何既有 session 或 run。

## 檔案

- `http-pairs.json`：request／response、訊息序列與 runtime 狀態。截斷或未擷取的部分都有標明，沒有任何內容是補寫的。
- `kit-log-excerpt.txt`：這次部署啟動的 streaming Kit 在 E2E 期間的 log 摘錄。
