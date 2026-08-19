# isolated-branch-stack-verification Specification

## Purpose
TBD - created by archiving change isolated-branch-stack-browser-e2e. Update Purpose after archive.
## Requirements
### Requirement: 未 merge branch 的 CPU governance/coordinator/browser operability evidence SHALL 在隔離 branch stack 取得

當一個 change 尚未 merge 進 `main`，而它需要 CPU governance／coordinator／browser operability evidence（visible route、按鈕打真實 backend API、observed runtime ID、screenshot／trace）時，該 evidence SHALL 在隔離 branch stack 上產生。隔離切片以本 branch checkout 啟動 governance 與 coordinator backend；viewer dev server 由 Playwright `webServer` 以同一份 stack manifest 的 resolved viewer port 啟動。Kit／WebRTC／GPU、first-frame、stage truth 與 DataChannel evidence 不在此 Requirement 範圍，仍須另依 host-native Kit 契約取得。

測試部署區 SHALL NOT 被用來驗證未 merge 的 branch。測試部署區的重建契約固定為 freshly fetched `origin/main`，因此把 branch 產物載入部署區會使該環境同時不代表 `main` 也不代表 branch。

本 Requirement SHALL NOT 放寬既有 Frontend Dual-Gate：隔離 stack 提供的是 operability／runtime vertical slice 的執行場所，design fidelity 仍由既有 design gate 獨立判定。

**備註（決策原因）:** `a4-console-convergence` tasks 4.1–4.4 已引用隔離 stack，但 repo 內既無 CPU/browser 切片定義、無 launcher、也無檢查，導致「打錯環境」與「skip 後宣稱通過」兩種失效沒有機器攔截點；Kit/WebRTC 部分不由本 change 承接。

#### Scenario: branch change 取得 CPU/browser operability evidence

- **GIVEN** 一個尚未 merge 的 change 需要 CPU governance／coordinator／browser operability evidence
- **WHEN** 它執行 browser E2E 並收集 screenshot／trace／console／network
- **THEN** 該 run SHALL 對隔離 branch stack 執行
- **AND** evidence SHALL 記錄 stack kind、resolved ports、base URLs 與 head commit sha

#### Scenario: 未 merge branch 不得使用測試部署區

- **WHEN** 一個未 merge 的 change 想在測試部署區驗證
- **THEN** 該驗證 SHALL 被視為不合法 evidence 來源
- **AND** 部署區驗證 SHALL 只在該 change 已 merge、且 commit 可由 freshly fetched `origin/main` 取得後才適用

### Requirement: 隔離 branch stack 的 port 集合 SHALL 與保留集合不相交且 fail closed

隔離 branch stack SHALL 使用固定 base port：coordinator `8005`、governance `49103`、viewer dev server `5180`。保留集合 SHALL 包含測試部署區 port（`8004`、`49102`、`49101`、`8010`、`5173`、`5174`）與 Kit runtime range（`49100` 與 `49110`–`49150`）。

隔離 stack SHALL 只接受整數 offset `0..4` 以支援 parallel session，resolved port SHALL 為 base 加 offset。負值、非整數或 `>4` SHALL 在 listener 查詢、cleanup 或服務啟動之前 fail closed。通過 domain 後，啟動流程 SHALL 計算 resolved port set 並與保留集合求交集；交集非空時 SHALL fail closed——回報衝突 port 與 owner，且 SHALL NOT 啟動任何服務、SHALL NOT 對任何 port 執行清理。

通過 offset domain 與保留集合檢查後，start SHALL 以 atomic create-new 取得該 change/run 與 resolved offset 的 reservation；manifest collision 與 listener preflight SHALL 在 reservation 持有期間重新執行，且 reservation SHALL 持續覆蓋 backend health 與 manifest commit，避免以 reservation 前的 stale preflight 啟動。正常成功或完整 rollback 後可釋放 reservation；若 startup rollback 仍有 `stop_failed`／ownership failure，launcher SHALL 寫出 recovery manifest、保留 reservation，直到同一 change/run 的 `stop` 證明所有本 run backend 已停止後才釋放。

啟動前的 port cleanup SHALL 只作用於 resolved backend port set，且只有 manifest 所記 PID、精確 launcher entrypoint 與 process creation identity 在 stop 前重驗全部一致時，才可停止該 repo-owned backend。未知 listener、缺少 manifest、PID reuse、entrypoint 不符或 creation identity 不符時 SHALL fail closed，SHALL NOT 停止任何 process。cleanup SHALL NOT 觸及 viewer port 或保留集合中的任何 port。

每個 run 的 governance DB/federation output、coordinator session/event、callback outbox、conversion/artifact-health ledger、IFC-ready intake store、mutable storage 與 service logs SHALL 全部位於該 run 的 `artifacts/e2e/<change-id>/<run-id>/state/` 或其 run directory 子路徑。launcher SHALL 明示覆寫這些 child-process environment，不得繼承另一 run 或 deployment 的 mutable path。worktree `storage/` 只可作 manifest 記錄的 read-only fixture root，不得與上述 mutable state 混用。

隔離 stack SHALL NOT 啟動 streaming server、Kit runtime 或 WebRTC；這些 runtime 的 evidence 仍由既有 host-native 契約提供。

**備註（決策原因）:** 固定 base 加明示 offset，讓 evidence 中的 port 可被 reviewer 以固定表比對；若改為自動挑選空 port，每份 evidence 的 port 都不同，就無法從 evidence 本身判斷有沒有打到部署區。

#### Scenario: 保留 port 被要求時拒絕啟動

- **GIVEN** 使用者或 agent 要求以會落入保留集合的 port 啟動隔離 stack
- **WHEN** 啟動流程計算 resolved port set
- **THEN** 流程 SHALL 以非零狀態結束並列出衝突 port
- **AND** SHALL NOT 啟動任何服務
- **AND** SHALL NOT 對任何 port 執行清理動作

#### Scenario: offset domain 在任何 listener 或 cleanup 前被檢查

- **GIVEN** offset 是負值、非整數或大於 `4`（包含 `5`、`48`）
- **WHEN** 啟動流程驗證輸入
- **THEN** 流程 SHALL fail closed
- **AND** SHALL NOT 查詢或停止 listener、靜默 wrap、重試或改用其他 port

#### Scenario: 未知 listener 不得被 cleanup

- **GIVEN** resolved backend port 已有 listener，但其 manifest PID、精確 launcher entrypoint 與 creation identity 無法全部匹配
- **WHEN** launcher 執行 start 或 stop ownership preflight
- **THEN** 流程 SHALL fail closed 並回報 occupied/ownership-unknown
- **AND** SHALL NOT 停止該 listener 或啟動任何新服務

#### Scenario: partial stop 後 process 已自行退出

- **GIVEN** recovery manifest 記錄某 backend 尚未停止，但 retry 時該 PID 已不存在
- **WHEN** launcher 重試 `stop`
- **THEN** 只有在該 PID 確認不存在且其 resolved backend port 也沒有 listener 時，才可記為 `already_stopped`
- **AND** PID 仍存在、listener lookup 失敗或該 port 出現任何 listener 時 SHALL fail closed，不得停止未知 process，也不得釋放 recovery reservation

#### Scenario: 隔離 stack 啟停不改動部署區

- **GIVEN** 測試部署區正在 `8004` 與 `49102` 上提供服務
- **WHEN** 隔離 stack 啟動、執行 E2E 後停止
- **THEN** 部署區 listener 狀態 SHALL 在啟動前、執行中與停止後保持一致

#### Scenario: 兩個 offset 不得共用 mutable backend state

- **GIVEN** 同一 worktree 以不同 run ID 或 offset 啟動兩個隔離 stack
- **WHEN** launcher 建立 child-process environment
- **THEN** 兩個 run 的 governance DB/federation output、session/event、outbox、ledger、IFC-ready store 與 mutable storage path SHALL 全部不同
- **AND** inherited deployment storage variables SHALL NOT 覆寫這些 per-run path

### Requirement: 隔離 backend SHALL 由 repo-owned script 管理，viewer SHALL 由 Playwright webServer 管理

隔離 governance／coordinator backend 的啟動、停止與狀態查詢 SHALL 由 repo 內受版本控管的 script 提供，並 SHALL 登記於 script registry 與 script contract。viewer dev server 的 lifecycle SHALL 由 Playwright `webServer` 唯一擁有；repo launcher SHALL NOT 啟動或停止 viewer。launcher SHALL NOT 成為 canonical operator entrypoint，也 SHALL NOT 取代 `deploy.ps1`、`verify-all.ps1`、`stop-all.ps1`。

隔離 stack 的任何必要步驟（含 port 清理）SHALL NOT 以 `.claude/**`、`.codex/**` 或其他 agent skill 目錄下的檔案作為唯一實作來源；installed skill 是 workflow helper，不是 product source of truth。

launcher 的三個 action SHALL 要求 caller 明示 `ChangeId` 與 `RunId`；兩者只允許安全的單一路徑 segment，並共同定位 `artifacts/e2e/<change-id>/<run-id>/stack-manifest.json`。start 發現同名 manifest 已存在時 SHALL fail closed，不得覆寫既有 run。backend 啟動成功時 manifest SHALL 至少包含 stack kind、change/run ID、offset、resolved ports、base URLs、head commit sha、啟動時間、backend ready state、lifecycle owners、read-only fixture root、per-run mutable state root，以及每個 backend 的 PID、精確 launcher entrypoint 與 process creation identity；startup rollback 不完整時，同一路徑 SHALL 保留 recovery manifest、start failure、per-process stop state 與 reservation-held 狀態。停止時 SHALL 保留 manifest 並補記停止時間；partial stop SHALL 原子保存已停止角色，retry SHALL 跳過已停止角色。`status` SHALL 回報 backend ready/ownership 狀態與 manifest 所期待的 Playwright-owned viewer port，不得把 viewer 未由 launcher 啟動誤報為 backend failure。直接執行 launcher SHALL 先在固定安全 log root 建立 logger；start/status/stop 成功、失敗或 safe-segment validation 拒絕 SHALL 透過 repo `StructLog.psm1` 發出 phase=`closed` 的 terminal `script_run` lifecycle。被拒絕的 raw segment SHALL NOT 進入 log path/data；dot-source functions 仍 SHALL 回傳原物件供 machine tests 使用。

#### Scenario: 啟動器登記於 script 契約

- **WHEN** 隔離 stack launcher 被新增或更名
- **THEN** script registry 與 script contract SHALL 同步登記其路徑與角色
- **AND** SHALL NOT 新增 root-level start script

#### Scenario: 同一 evidence run 不得被覆寫

- **GIVEN** 指定 change ID 與 run ID 的 stack manifest 已存在
- **WHEN** launcher 再次以相同識別執行 start
- **THEN** launcher SHALL fail closed 並回報 manifest collision
- **AND** SHALL NOT 覆寫 manifest、停止既有 process 或啟動新服務

#### Scenario: 契約不得指向 agent skill

- **WHEN** 有人以 agent skill 內的 helper 作為隔離 stack 的必要步驟
- **THEN** 該依賴 SHALL 被視為契約缺口
- **AND** 對應實作 SHALL 移入受版本控管的 repo script

### Requirement: 被引用為 evidence 的 browser E2E SHALL 以 require-real 模式對隔離 stack 執行

當 browser E2E 的結果被引用為 completion evidence 時，該 run SHALL 以 require-real 模式執行：任何缺失的前置條件（stack manifest 未指定、stack 未啟動、API 不可用、fixture 不存在、必要 surface 未 mount）SHALL 成為 hard failure。條件式 skip 後的綠燈 SHALL NOT 被引用為通過。

viewer bundle 的 coordinator base SHALL 綁定到隔離 coordinator origin。瀏覽器 SHALL NOT 直接連線 governance internal port 或任何非 coordinator 的 internal loopback service。

E2E run SHALL 在整場期間監看瀏覽器發出的 HTTP request 與 WebSocket connection；任何命中保留集合 port 的 URL SHALL 使該 run 失敗。malformed、`blob:`、`data:` 等非 network URL SHALL 被安全忽略，不得使 Playwright worker 因 listener callback 未捕捉例外而中止。

evidence run SHALL 以必填 `E2E_STACK_MANIFEST` 指向唯一 manifest；resolved path SHALL 位於目前 worktree 的 `artifacts/e2e/<change-id>/<run-id>/stack-manifest.json`，其 change/run ID SHALL 與內容相同，`head_sha` SHALL 等於目前 checkout HEAD。任一條件不符 SHALL 在啟動 webServer 或執行任何 spec 前中止。base URL 解析 SHALL 有唯一入口；manifest coordinator base SHALL 是 browser E2E authority。若 `E2E_COORDINATOR_BASE_URL` 存在，其值 SHALL 與 manifest coordinator base 完全相同；即使另一個隔離 offset 的 port 不在保留集合，mismatch 仍 SHALL 提前中止。解析結果落入保留集合時亦同。

require-real global setup 在 coordinator health 成功後 SHALL 重新取得 governance/coordinator 的 live process identity 與 resolved listener owner；PID、command line、creation identity SHALL 與 manifest 一致，且 listener PID SHALL 是該 manifest process 本身或其 descendant。lineage 的每一節 SHALL 記錄 PID、parent PID 與 creation identity；parent creation 晚於 child、節點重複、edge 不連續，或 snapshot 輸出前重新查詢發現 listener/lineage 改變時 SHALL 視為 PID reuse 或 ownership 無法證明。任一 backend 已退出、PID reused、listener 被其他 process 取代、provider lookup 失敗或 lineage 無法證明時 SHALL fail closed，不得開始 browser spec。

stack manifest 的 resolved viewer port SHALL 是 browser E2E 的 authority。若 `E2E_VIEWER_PORT` 存在，其值 SHALL 與 manifest viewer port 完全相同，否則 SHALL 在啟動 webServer 或執行任何 spec 前中止。require-real evidence SHALL 由 Playwright `webServer` 啟動 viewer；`E2E_DISABLE_WEBSERVER=1` 因無法證明外部 bundle 的 HEAD 與 coordinator binding，SHALL 在啟動任何 spec 前中止。

#### Scenario: 缺前置條件時 hard fail 而非 skip

- **GIVEN** 隔離 stack 未啟動或必要 fixture 不存在
- **WHEN** 以 require-real 模式執行 browser E2E
- **THEN** run SHALL 失敗並指出缺失的前置條件
- **AND** SHALL NOT 以 skip 結束後被計為通過

#### Scenario: manifest path 或 head identity 不可信時提前中止

- **GIVEN** `E2E_STACK_MANIFEST` 缺失、位於目前 worktree `artifacts/e2e` 外、path ID 與內容不符，或 manifest `head_sha` 不等於 HEAD
- **WHEN** Playwright config 解析 browser E2E 設定
- **THEN** 解析入口 SHALL 直接拋錯
- **AND** SHALL NOT 啟動 viewer webServer 或執行任何 spec

#### Scenario: 瀏覽器 request 或 WebSocket 打到保留 port 即失敗

- **GIVEN** 隔離 stack 已啟動且 E2E 正在執行
- **WHEN** 瀏覽器對保留集合中的任一 port 發出 HTTP request 或建立 WebSocket
- **THEN** 該 run SHALL 失敗並記錄違規 URL

#### Scenario: health 被其他 process 接管時提前中止

- **GIVEN** manifest backend 已退出，但另一 process 在相同 resolved port 回應成功 health
- **WHEN** require-real global setup 驗證 live backend
- **THEN** process identity 或 listener lineage 檢查 SHALL 失敗
- **AND** SHALL NOT 執行任何 browser spec 或產出成功 evidence

#### Scenario: base URL 落入保留集合時提前中止

- **WHEN** 設定解析出的 coordinator base 指向保留集合中的 port
- **THEN** 解析入口 SHALL 直接拋錯
- **AND** SHALL NOT 執行任何 spec

#### Scenario: coordinator env 與 manifest base 不一致時提前中止

- **GIVEN** stack manifest 的 coordinator base 與 `E2E_COORDINATOR_BASE_URL` 不同
- **WHEN** Playwright config 解析 browser E2E 設定
- **THEN** 解析入口 SHALL 直接拋錯，即使 env 指向另一個非保留的隔離 offset
- **AND** SHALL NOT 啟動 viewer webServer 或執行任何 spec

#### Scenario: viewer env 與 manifest port 不一致時提前中止

- **GIVEN** stack manifest 的 resolved viewer port 與 `E2E_VIEWER_PORT` 不同
- **WHEN** Playwright config 解析 browser E2E 設定
- **THEN** 解析入口 SHALL 直接拋錯
- **AND** SHALL NOT 啟動 viewer webServer 或執行任何 spec

### Requirement: 隔離 stack evidence SHALL 自我標示範圍且不得跨界推論

隔離 stack 產出的 evidence SHALL 標示 stack kind 為隔離 branch stack，並記錄 resolved ports、base URLs、head commit sha、執行時間窗、observed runtime／query／request ID 與 artifact 路徑。

PR body 引用隔離 stack evidence 時 SHALL 標明其 stack kind。隔離 stack evidence SHALL NOT 被用來宣稱下列任一項已通過：design gate（pixel diff 與 semantic states）、deploy path verification、Kit／WebRTC／GPU runtime evidence、以及測試部署區的可運作性。

若某項 gate 因隔離 stack 的範圍限制而未取得 evidence，PR body SHALL 誠實標示為未取得並列入 known gaps，SHALL NOT 以其他來源的通過結果替代。

#### Scenario: evidence 標明來源場所

- **WHEN** PR body 引用隔離 stack 產出的 screenshot 或 trace
- **THEN** 該引用 SHALL 標示 stack kind 與 resolved ports
- **AND** SHALL 附上可解析的 artifact 路徑或 CI artifact 連結

#### Scenario: 不得以隔離 stack 推論 design 或 deploy gate

- **WHEN** 某 PR 僅有隔離 stack 的 functional evidence
- **THEN** design gate 與 deploy path 欄位 SHALL NOT 標為通過
- **AND** 未取得的 gate SHALL 列入 known gaps

#### Scenario: 3D 與 WebRTC 結論不由隔離 stack 推得

- **GIVEN** 隔離 stack 不啟動 Kit runtime 與 WebRTC
- **WHEN** 有人以隔離 stack evidence 宣稱 first frame、stage truth 或 DataChannel 行為已驗證
- **THEN** 該宣稱 SHALL 被視為不成立
- **AND** 相關 evidence SHALL 另行依 host-native Kit 契約取得並分開標示

#### Scenario: harness fake 控制面之下的 run 須揭露且不得跨界引用

- **GIVEN** viewer bundle 以 `VITE_VIEWER_HARNESS=1` 建置且 E2E 以 harness route（`?harness=1`）執行，使 review socket／authority ack 由 fake 實作提供
- **WHEN** 該 run 的結果被引用為 completion evidence
- **THEN** evidence SHALL 標示 harness 使用狀態（build flag 與 query flag）
- **AND** 該 run SHALL NOT 被引用為 coordinator review socket／authority ack 真實控制面行為的證據

### Requirement: 隔離 stack 契約 SHALL 有 machine check

隔離 stack 的 port 表 SHALL 只有一份權威定義。文件中的 port 表、script registry 登記與 launcher 內的常數 SHALL 保持一致；三者漂移時 machine check SHALL 失敗。

machine check SHALL 驗證：resolved port set 的計算、offset `0..4` 的接受與 `5`／`48`／負值／非整數的前置拒絕、與保留集合的不相交檢查、未知 listener 不被停止、manifest process identity ownership gate、launcher 已登記於 script registry，以及文件中對應章節存在且與 launcher 常數一致。

machine check SHALL 在 PR 的自動化驗證流程中執行，SHALL NOT 只依賴人工執行。

#### Scenario: port 表漂移即 CI fail

- **GIVEN** 文件的 port 表與 launcher 常數不一致
- **WHEN** machine check 於 PR 驗證流程執行
- **THEN** check SHALL 失敗並指出不一致的項目

#### Scenario: 非法 offset 被拒絕

- **WHEN** 提供負值、非整數或使 resolved port 越界的 offset
- **THEN** machine check SHALL 確認 launcher 拒絕該輸入
- **AND** SHALL 確認拒絕發生在啟動任何服務之前
