# viewer-runtime-command-bridge Specification

## Purpose
TBD - created by archiving change c-m4-runtime-command-bridge. Update Purpose after archive.
## Requirements
### Requirement: runtime mutator 指令 SHALL 經前端 UX 閘門與 Kit 端 defense-in-depth 授權檢查

治理面板送往 3D viewer runtime 的 mutating 指令（`openStageRequest`、`loadArtifactGroupRequest`、`composeStageRequest`、`highlightPrimsRequest`、`focusPrimRequest`、`clearHighlightRequest`、`selectPrimsRequest`、`makePrimsPickable`、`resetStage`）SHALL 先經前端中央 `_sendStreamMessage` 的 primary role、viewer lease token與 session lifecycle UX閘門。每個送達 production Kit的mutator SHALL 在任何 USD、selection或stage state改變前，再由Kit經coordinator internal authority即時驗證 exact session、`source_client_id`、active unexpired primary lease token、lease status/role、session lifecycle與必要event context；frontend UX gate SHALL NOT被視為安全邊界。

每個 well-formed mutator attempt SHALL 帶 unique `request_id`。成功 SHALL 只回既有 command-specific success event並 additive echo同一 ID；拒絕 SHALL 只回一個 `{event_type:"commandRejected", payload:{rejected_event_type, reason, request_id|rejection_id, session_id?, retryable, runtime_state, detail_code?, detail?}}`，不得 dual-emit legacy unauthorized result。`reason` SHALL 限於 `spectator_readonly`、`lease_invalid`、`session_lifecycle_blocked`、`unauthorized_source_client`、`unsupported_command`、`invalid_payload`；`runtime_state` SHALL 限於 `unchanged | changed_unconfirmed`。缺 request ID的 malformed direct call MAY以server-generated `rejection_id`關聯diagnostic，但不得偽稱為原attempt的完整 correlation。

Authority network/timeout/non-JSON failure SHALL zero mutation並使用 `reason:"lease_invalid"`、`retryable:true`、`runtime_state:"unchanged"`、`detail_code:"authority_unavailable"`；真正 forged/released/expired lease SHALL `retryable:false`。Internal authority的正常 allow/deny SHALL使用 HTTP 200 structured decision；non-2xx或invalid body才 SHALL分類為transport outage。Payload/log SHALL NOT含 raw user credential、viewer lease token、internal token、Authorization header或raw upstream response。Viewer SHALL顯示 persistent aria-live rejection；FakeKit SHALL可 deterministic one-shot回放同形 terminal，且production build SHALL NOT因query參數啟用harness。

Kit SHALL每個attempt即時驗證且 SHALL NOT使用positive authorization cache。Production `openStageRequest`與`loadArtifactGroupRequest` SHALL另要求 server-issued stage transaction與exact canonical composition；valid lease + browser URL SHALL NOT構成stage authority。Readonly DataChannel query與video SHALL不受mutator authority outage阻擋。Coordinator只 SHALL回authorization decision，SHALL NOT提供通用runtime operations proxy或控制viewport。

#### Scenario: spectator 明示唯讀角色的 mutating 指令被拒

- **WHEN** 一個 spectator（`role!=="primary"` 或缺 lease token）送出 mutating 指令
- **THEN** 前端 SHALL 略過送出並記錄阻擋原因，Kit 端 `is_authorized_mutator` SHALL 回 false 使 handler 拒絕

#### Scenario: primary 帶合法 lease 的 mutating 指令通過閘門

- **WHEN** primary viewer 已由 coordinator 取得 viewer lease token 且 session lifecycle 未阻擋，送出 `loadArtifactGroupRequest`
- **THEN** 指令 SHALL 通過前端 UX 閘門與 Kit 端授權檢查並套用，`binding_revision_id` SHALL 隨 `openedStageResult` 回傳供前端宣告 applied

#### Scenario: forged 或 released lease 被拒且 zero mutation

- **WHEN** caller繞過frontend gate，送入 `role:"primary"` 搭配偽造、過期、已釋放、跨session或wrong-source lease
- **THEN** Kit SHALL在任何runtime state改變前拒絕並回一個correlated `commandRejected {runtime_state:"unchanged"}`
- **AND** SHALL NOT回legacy command-specific unauthorized result或洩漏任何token/detail body

#### Scenario: current primary lease每次重新驗證

- **WHEN** current primary viewer對active session送出allowlisted mutator，且exact source client/lease仍為active、unexpired
- **THEN** Kit SHALL執行該mutator並回既有success event與同一 `request_id`
- **AND** lease若在下一attempt前release/expire，下一attempt SHALL立即被拒，不得沿用前次success

#### Scenario: authority unavailable可重試但不得誤判為expired lease

- **WHEN** Kit無法在bounded timeout內取得valid coordinator authorization response
- **THEN** mutator SHALL zero mutation並回 `commandRejected {reason:"lease_invalid", retryable:true, runtime_state:"unchanged", detail_code:"authority_unavailable"}`
- **AND** viewer SHALL顯示可重試的authority outage；video與readonly query MAY維持服務

#### Scenario: unsupported production command被明確拒絕

- **WHEN** production Kit收到harness-only `composeStageRequest`
- **THEN** SHALL回 `commandRejected {reason:"unsupported_command"}` 且 zero mutation
- **AND** unknown catalog外event仍 SHALL依forward-compatible規則忽略並記diagnostic

### Requirement: mapping table 選列 SHALL 為 UI-local，不觸發 runtime mutator

治理面板 mapping table 的選列 SHALL 只更新前端語意面板狀態（UI-local），SHALL NOT 送出任何 runtime mutator（如 `focusPrimRequest`）。USD tree node 的選取 SHALL 送出 `selectPrimsRequest` 與 `focusPrimRequest`（reverse-jump 到 3D focus）。

#### Scenario: 點擊 mapping row 更新語意面板但不送 runtime mutator

- **WHEN** 使用者點擊一列 mapping row
- **THEN** 語意面板 SHALL 更新，且對外 DataChannel log SHALL NOT 含 `focusPrimRequest`

### Requirement: coordinator SHALL NOT 提供通用 runtime operations endpoint

runtime mutator SHALL 只走 Kit 端 DataChannel + 授權閘門；coordinator SHALL NOT 提供通用 `/operations`、`/viewer-operations`、`/operation-log` 類 runtime operations 代理路由。此邊界 SHALL 有 committed 回歸測試守衛。

#### Scenario: 通用 operations 路徑未被路由

- **WHEN** 對 coordinator 送出 `GET` 或 `POST /api/operations`（或 `/operations`、`/viewer-operations`、`/operation-log` 等）
- **THEN** coordinator SHALL 回 404（未註冊），且既有合法路由（如 `/health`）SHALL 仍為 200

### Requirement: viewer lease claim 與 replay SHALL 綁 server-authenticated principal

Viewer lease claim SHALL在session lookup、body identity與conflict資料使用前經 `UserAuthProvider` authenticate。Legacy body `user_id` MAY暫留作mismatch guard，但實際lease principal SHALL只由server auth context產生；欄位存在且與principal不一致時 SHALL 403且zero claim/audit。Local-dev provider回傳的 raw carrier SHALL先以 domain-separated one-way normalization轉為固定長度 opaque lab subject，body guard亦以同一 normalization比較；raw Authorization／`X-User-Token`／body carrier bytes SHALL NOT成為 principal、lease欄位、public response、audit、event、log或UI。Bound OIDC SHALL使用stable subject claim而非 bearer bytes。Idempotent replay SHALL比較session、viewer、nonce、requested role與opaque principal；不同principal不得取得既有lease或token。

Primary conflict SHALL只回generic reason，不得附另一principal的lease/user/viewer/nonce/stream detail。Lease status SHALL先authenticate且只回caller自己的lease與redacted availability摘要。`local-dev`／`sso_binding=pending_oq5` SHALL只標 `auth_scope=local_dev_lab`；production mutation routes SHALL fail closed為 `production_identity_unavailable`，但readonly/control-plane routes MAY維持服務。本 requirement SHALL NOT把browser URL user id或bearer-as-user-ID宣稱production identity。

#### Scenario: cross-principal nonce replay不洩漏舊lease

- **GIVEN** principal A已用某viewer/nonce取得primary lease
- **WHEN** principal B以相同session、viewer、nonce與role claim
- **THEN** coordinator SHALL NOT回放A的lease/token或任何A的identity/stream detail
- **AND** MAY只回generic `primary_already_claimed`

#### Scenario: legacy body identity mismatch被拒

- **GIVEN** `UserAuthProvider`已驗證principal A
- **WHEN** claim body的legacy `user_id`宣稱B
- **THEN** coordinator SHALL 403且不得建立lease、append claim event或採信B

#### Scenario: lab credential sentinel不進產品資料面

- **WHEN** local-dev caller以唯一 sentinel作為lab identity carrier完成claim、status與stage preauthorization
- **THEN** lease principal MAY是固定長度 opaque lab subject，但response、audit、event、structured log與viewer UI SHALL NOT包含 raw sentinel
- **AND** tracked scan通過不得取代此動態 sentinel assertion

#### Scenario: production尚無bound IdP時mutation fail closed

- **WHEN** production profile只有 `local-dev`或 `sso_binding=pending_oq5`
- **THEN** lease claim與依賴user mutation authority的route SHALL回 `production_identity_unavailable`
- **AND**系統 SHALL NOT以URL user id、body actor或自選header宣稱production authentication

### Requirement: Stage/Artifact Binding SHALL使用完整pending transaction並只在Kit terminal success後active

Public stage-binding request SHALL由authenticated current primary lease建立bounded pending transaction。Request只 MAY提交ordered artifact IDs、role與load order；coordinator SHALL從session解析ready artifact與URL，要求恰一primary，並回server-generated `stage_binding_authorization_id`、`binding_revision_id`、exact resolved composition、pending expiry與 `status:"pending"`。Browser-supplied URL/revision SHALL NOT建立authority。Raw lab credential SHALL先轉opaque principal且不得進transaction/public/audit資料。

Production `openStageRequest`與`loadArtifactGroupRequest` SHALL帶同一authorization ID、revision與exact composition。Kit SHALL在mutation前經coordinator逐欄比對完整pending tuple；任何session artifact、primary/secondary/URL/order/ID/revision差異或缺transaction SHALL zero mutation。第一次 valid authorization SHALL原子 `pending -> executing`並綁 request ID；任何相同或不同 ID的 replay／parallel authorization SHALL deny且不得第二次 mutation。Pending TTL只在claim前生效；executing SHALL使用獨立 bounded deadline，且LoadingManager SHALL保存 per-attempt immutable context而非可被下一請求覆寫的 shared context。每session最多一個non-terminal transaction，所有in-flight/completed records SHALL有global/per-session capacity與bounded eviction。

每次新 exact composition SHALL先移除前一個attempt由同一LoadingManager加入、且屬於同一session layer的secondary sublayers，再依新tuple順序套用；不得保留舊manager-owned secondary，也不得清除其他subsystem擁有或不同stage/session layer既有的sublayers。

`active` SHALL只代表完整 exact composition。Primary stage雖已開啟但任一secondary layer compose失敗或被skip時，Kit SHALL以runtime failure完成transaction、保留`partial_load`／`failed_bindings` evidence並回`openedStageResult:error` terminal；該terminal SHALL帶`runtime_state:"changed_failed"`，表示coordinator已確認transaction失敗但GPU runtime已改變。Coordinator SHALL NOT把該revision寫成active或append `stageBindingApplied`。Viewer收到後 SHALL清除本地active evidence、向parent送`stage_loaded {status:"unproven"}`以阻擋handoff，但因failure已被authority確認，MAY允許使用新transaction明確重試。若failed completion本身未被coordinator證實，Kit SHALL改回唯一`commandRejected {runtime_state:"changed_unconfirmed"}`，不得把未知completion誤標`changed_failed`。

External `loadArtifactGroupRequest` SHALL只執行一次 coordinator authorization/consume，之後以 verifier成功後在程式內建立、不可由payload偽造的 immutable attempt context呼叫 internal stage-open primitive；該 internal delegate SHALL NOT再次 authorization。Direct external `openStageRequest` SHALL各自 authorization一次後呼叫同一 primitive。Payload supplied `already_authorized`或等價 bypass marker SHALL NOT被採信。

`loadArtifactGroupResult {result:"accepted"}` SHALL是non-terminal，不得寫active或向UI宣稱applied。Preauthorization或atomic claim的 HTTP response遺失 SHALL fail closed；transaction MAY保持executing直到deadline，但 authority SHALL NOT因重試而可重放。

只有Kit observed `openedStageResult:success`後的internal success confirmation MAY把executing transaction轉active。Coordinator SHALL重新驗current session/lease、request/revision與executing tuple，atomic更新active/last-good並append exactly one `stageBindingApplied`；duplicate exact completion SHALL idempotent回同一結果且不重複audit，runtime failure completion只轉failed。Internal正常 allow/deny SHALL用 HTTP 200 structured decision。

若 runtime尚未改變，confirmation/authorization拒絕 SHALL回單一correlated `commandRejected {runtime_state:"unchanged"}`。若GPU stage已觀察成功但confirmation無法證實，Kit SHALL回 `commandRejected {runtime_state:"changed_unconfirmed"}`；viewer SHALL把stage標unproven、阻擋盲 retry與A4 handoff，直到authenticated self-only status證實同revision active。Last-good SHALL保持不變，且系統不得宣稱applied或自動逆轉GPU stage。Process restart或missing/superseded/expired transaction SHALL fail closed；A4 consumer SHALL只讀active record，不得從browser request、`accepted`或changed-unconfirmed runtime推論active stage。

#### Scenario: preauthorization與accepted都不等於applied

- **WHEN** primary取得stage-binding authorization且Kit只回 `loadArtifactGroupResult:accepted`
- **THEN** coordinator SHALL只保留pending或executing transaction
- **AND** status、audit、viewer與A4 consumer SHALL NOT觀察到新的active revision

#### Scenario: composition tampering在mutation前被拒

- **WHEN** caller取得合法authorization後替換secondary artifact、URL、load order、revision或authorization ID
- **THEN** Kit/coordinator SHALL在stage mutation前拒絕並回correlated `commandRejected {runtime_state:"unchanged"}`
- **AND** active與last-good SHALL維持不變

#### Scenario: valid lease不可用direct open繞過artifact authority

- **WHEN** caller持有valid primary lease但以 `openStageRequest`提交缺transaction、wrong-session URL或改寫後composition
- **THEN** Kit SHALL在任何stage mutation前zero-mutation拒絕
- **AND** allowlisted storage URL SHALL NOT取代session-owned artifact authorization

#### Scenario: transaction replay或interleaving只可consume一次

- **WHEN** 兩個相同或不同request ID並行使用同一authorization，或第二個stage request在第一個executing期間到達
- **THEN** coordinator SHALL只允許第一個exact request原子進入executing，其餘一律deny
- **AND** LoadingManager SHALL以第一個immutable context關聯terminal，不得被後續payload覆寫

#### Scenario: slow load不受pending TTL誤殺

- **WHEN** transaction在pending TTL內成功claim為executing，stage load超過原pending expiry但仍在executing deadline內完成
- **THEN** success confirmation SHALL依executing deadline判斷而非原pending expiry
- **AND** 超過executing deadline才 SHALL轉failed且不得active

#### Scenario: artifact-group happy path只consume一次

- **WHEN** valid `loadArtifactGroupRequest`以exact transaction進入Kit並成功開啟stage
- **THEN** Kit SHALL只呼叫一次coordinator authorization、只執行一次stage mutation，internal open delegate不得再次consume
- **AND** attempt SHALL只有一次correlated terminal outcome

#### Scenario: observed success與idempotent confirmation後才applied

- **WHEN** Kit以exact authorized tuple成功載入stage並完成internal confirmation
- **THEN** coordinator SHALL更新active/last-good並append一次 `stageBindingApplied`
- **AND** duplicate confirmation SHALL回同一active result、不得再append audit；Kit才 MAY回 `openedStageResult:success`

#### Scenario: runtime成功但confirmation未證實

- **WHEN** Kit已觀察stage成功，但coordinator completion timeout、transport失敗或正常deny
- **THEN** Kit SHALL只回一個correlated `commandRejected {runtime_state:"changed_unconfirmed"}`，viewer SHALL標stage unproven
- **AND** 在authenticated status證實同revision active前，viewer/A4 SHALL阻擋盲 retry與handoff

### Requirement: embedded primary lease 晚到 SHALL恢復一次deferred stage open

Embedded viewer第一次auto-open因primary lease token尚未到達而無法send時，後續從trusted parent收到非空token SHALL在selected asset仍可開啟且stage尚未 `matched`時重排既有deferred-open流程。Scheduler SHALL取代舊timer並避免matched stage重開；它 SHALL NOT修改target stage、直接繞過central mutator gate或建立第二套open path。

#### Scenario: late token解除permanent stall

- **GIVEN** embedded viewer已有stream與selected stage，但第一次auto-open因缺lease token被擋
- **WHEN** trusted parent稍後傳入valid primary lease token
- **THEN** viewer SHALL重排deferred open，ready後只送一次 `openStageRequest`
- **AND** stage成功matched後相同或重複token message SHALL NOT再次開啟stage

