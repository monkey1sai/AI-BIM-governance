# isolated-branch-stack-verification（本 change 的 delta）

本 delta 定義「未 merge branch 如何取得 user-facing runtime evidence」的執行場所契約。它不涵蓋 evidence 的內容分級（屬 `runtime-verification-evidence`）、測試部署區重建（屬 `test-deploy-rebuild-workflow`）、design fidelity 判定（屬既有 design-system gate），也不涵蓋任何 A4 功能行為（屬 `a4-semantic-search`）。

## ADDED Requirements

### Requirement: 未 merge branch 的 user-facing runtime evidence SHALL 在隔離 branch stack 取得

當一個 change 尚未 merge 進 `main`，而它需要 user-facing runtime evidence（visible route、按鈕打真實 backend API、observed runtime ID、screenshot／trace）時，該 evidence SHALL 在隔離 branch stack 上產生。隔離 branch stack 的定義是：以本 branch 的 checkout 啟動的 governance、coordinator 與 viewer 三層，且其對外 listener SHALL 全部落在專供隔離使用的 port 集合。

測試部署區 SHALL NOT 被用來驗證未 merge 的 branch。測試部署區的重建契約固定為 freshly fetched `origin/main`，因此把 branch 產物載入部署區會使該環境同時不代表 `main` 也不代表 branch。

本 Requirement SHALL NOT 放寬既有 Frontend Dual-Gate：隔離 stack 提供的是 operability／runtime vertical slice 的執行場所，design fidelity 仍由既有 design gate 獨立判定。

**備註（決策原因）:** `a4-console-convergence` tasks 4.1–4.4 已把 A4 的全部 runtime evidence 押在隔離 stack 上，但 repo 內既無定義、無 launcher、也無檢查，導致「打錯環境」與「skip 後宣稱通過」兩種失效沒有任何機器攔截點。

#### Scenario: branch change 取得 runtime evidence

- **GIVEN** 一個尚未 merge 的 change 需要 user-facing runtime evidence
- **WHEN** 它執行 browser E2E 並收集 screenshot／trace／console／network
- **THEN** 該 run SHALL 對隔離 branch stack 執行
- **AND** evidence SHALL 記錄 stack kind、resolved ports、base URLs 與 head commit sha

#### Scenario: 未 merge branch 不得使用測試部署區

- **WHEN** 一個未 merge 的 change 想在測試部署區驗證
- **THEN** 該驗證 SHALL 被視為不合法 evidence 來源
- **AND** 部署區驗證 SHALL 只在該 change 已 merge、且 commit 可由 freshly fetched `origin/main` 取得後才適用

### Requirement: 隔離 branch stack 的 port 集合 SHALL 與保留集合不相交且 fail closed

隔離 branch stack SHALL 使用固定 base port：coordinator `8005`、governance `49103`、viewer dev server `5180`。保留集合 SHALL 包含測試部署區 port（`8004`、`49102`、`49101`、`8010`、`5173`、`5174`）與 Kit runtime range（`49100` 與 `49110`–`49150`）。

隔離 stack SHALL 接受非負整數 offset 以支援 parallel session，resolved port SHALL 為 base 加 offset。啟動流程 SHALL 在啟動任何服務之前計算 resolved port set 並與保留集合求交集；交集非空時 SHALL fail closed——回報衝突 port 與 owner，且 SHALL NOT 啟動任何服務、SHALL NOT 對任何 port 執行清理。

啟動前的 port 清理 SHALL 只作用於 resolved port set。清理 SHALL NOT 觸及保留集合中的任何 port。

隔離 stack SHALL NOT 啟動 streaming server、Kit runtime 或 WebRTC；這些 runtime 的 evidence 仍由既有 host-native 契約提供。

**備註（決策原因）:** 固定 base 加明示 offset，讓 evidence 中的 port 可被 reviewer 以固定表比對；若改為自動挑選空 port，每份 evidence 的 port 都不同，就無法從 evidence 本身判斷有沒有打到部署區。

#### Scenario: 保留 port 被要求時拒絕啟動

- **GIVEN** 使用者或 agent 要求以會落入保留集合的 port 啟動隔離 stack
- **WHEN** 啟動流程計算 resolved port set
- **THEN** 流程 SHALL 以非零狀態結束並列出衝突 port
- **AND** SHALL NOT 啟動任何服務
- **AND** SHALL NOT 對任何 port 執行清理動作

#### Scenario: offset 越界被同一檢查擋下

- **GIVEN** offset 使 governance resolved port 進入 Kit range
- **WHEN** 啟動流程執行不相交檢查
- **THEN** 流程 SHALL fail closed
- **AND** SHALL NOT 靜默 wrap、重試或改用其他 port

#### Scenario: 隔離 stack 啟停不改動部署區

- **GIVEN** 測試部署區正在 `8004` 與 `49102` 上提供服務
- **WHEN** 隔離 stack 啟動、執行 E2E 後停止
- **THEN** 部署區 listener 狀態 SHALL 在啟動前、執行中與停止後保持一致

### Requirement: 隔離 stack SHALL 由 repo-owned script 啟停，不得依賴 agent skill

隔離 stack 的啟動、停止與狀態查詢 SHALL 由 repo 內受版本控管的 script 提供，並 SHALL 登記於 script registry 與 script contract。它 SHALL NOT 成為 canonical operator entrypoint，也 SHALL NOT 取代 `deploy.ps1`、`verify-all.ps1`、`stop-all.ps1`。

隔離 stack 的任何必要步驟（含 port 清理）SHALL NOT 以 `.claude/**`、`.codex/**` 或其他 agent skill 目錄下的檔案作為唯一實作來源；installed skill 是 workflow helper，不是 product source of truth。

啟動成功時 SHALL 產出 stack manifest，內容至少包含 stack kind、offset、resolved ports、base URLs、head commit sha、啟動時間與 process 識別；停止時 SHALL 保留 manifest 並補記停止時間。

#### Scenario: 啟動器登記於 script 契約

- **WHEN** 隔離 stack launcher 被新增或更名
- **THEN** script registry 與 script contract SHALL 同步登記其路徑與角色
- **AND** SHALL NOT 新增 root-level start script

#### Scenario: 契約不得指向 agent skill

- **WHEN** 有人以 agent skill 內的 helper 作為隔離 stack 的必要步驟
- **THEN** 該依賴 SHALL 被視為契約缺口
- **AND** 對應實作 SHALL 移入受版本控管的 repo script

### Requirement: 被引用為 evidence 的 browser E2E SHALL 以 require-real 模式對隔離 stack 執行

當 browser E2E 的結果被引用為 completion evidence 時，該 run SHALL 以 require-real 模式執行：任何缺失的前置條件（stack 未啟動、API 不可用、fixture 不存在、必要 surface 未 mount）SHALL 成為 hard failure。條件式 skip 後的綠燈 SHALL NOT 被引用為通過。

viewer bundle 的 coordinator base SHALL 綁定到隔離 coordinator origin。瀏覽器 SHALL NOT 直接連線 governance internal port 或任何非 coordinator 的 internal loopback service。

E2E run SHALL 在整場期間監看瀏覽器發出的 request；任何命中保留集合 port 的 request SHALL 使該 run 失敗。

base URL 解析 SHALL 有唯一入口；解析結果落入保留集合時 SHALL 在執行任何 spec 之前即中止。

#### Scenario: 缺前置條件時 hard fail 而非 skip

- **GIVEN** 隔離 stack 未啟動或必要 fixture 不存在
- **WHEN** 以 require-real 模式執行 browser E2E
- **THEN** run SHALL 失敗並指出缺失的前置條件
- **AND** SHALL NOT 以 skip 結束後被計為通過

#### Scenario: 瀏覽器打到保留 port 即失敗

- **GIVEN** 隔離 stack 已啟動且 E2E 正在執行
- **WHEN** 瀏覽器對保留集合中的任一 port 發出 request
- **THEN** 該 run SHALL 失敗並記錄違規 request URL

#### Scenario: base URL 落入保留集合時提前中止

- **WHEN** 設定解析出的 coordinator base 指向保留集合中的 port
- **THEN** 解析入口 SHALL 直接拋錯
- **AND** SHALL NOT 執行任何 spec

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

machine check SHALL 驗證：resolved port set 的計算、與保留集合的不相交檢查、offset 越界與非法值的拒絕、launcher 已登記於 script registry，以及文件中對應章節存在且與 launcher 常數一致。

machine check SHALL 在 PR 的自動化驗證流程中執行，SHALL NOT 只依賴人工執行。

#### Scenario: port 表漂移即 CI fail

- **GIVEN** 文件的 port 表與 launcher 常數不一致
- **WHEN** machine check 於 PR 驗證流程執行
- **THEN** check SHALL 失敗並指出不一致的項目

#### Scenario: 非法 offset 被拒絕

- **WHEN** 提供負值、非整數或使 resolved port 越界的 offset
- **THEN** machine check SHALL 確認 launcher 拒絕該輸入
- **AND** SHALL 確認拒絕發生在啟動任何服務之前
