## ADDED Requirements

### Requirement: Autonomous delivery SHALL use an external machine trust root without per-PR human approval

啟用後，closed classification中每個可merge PR SHALL NOT 要求人類／CODEOWNER approving review、protected-environment reviewer、固定 User service-account review 或 Web UI 操作。Merge authority SHALL 由 candidate branch 與一般 agent session 無法修改、讀取 credential 或模擬的 external machine trust root 提供。CODEOWNERS MAY 保留作 ownership routing，但 SHALL NOT 作 counted merge authority。External trust root、required checks、merge App 或 runner 尚未完成 live attestation 時，系統 SHALL 回傳 `HELD`，不得退回 candidate self-approval、較弱 auto-merge、admin bypass 或逐 PR 人工 approval。

#### Scenario: 任一可merge class不需要人類review vote

- **GIVEN** autonomous delivery activation 已完成
- **WHEN** PR 的 exact-head machine gates 全部通過
- **THEN** branch protection SHALL NOT 要求 approving review 或 CODEOWNER review
- **AND** machine trust root MAY 進入 exact-head merge preparation
- **AND** 系統 SHALL NOT 建立或偽裝 human approval event

#### Scenario: External trust root 不可用

- **WHEN** expected GitHub App、required-check source、trusted executor、policy bundle或credential broker無法被 server-authoritative evidence驗證
- **THEN** terminal merge eligibility SHALL為 `HELD`
- **AND** candidate workflow、agent credential、PR comment或同名commit status SHALL NOT替代該trust root

### Requirement: Every protected-branch PR SHALL belong to one closed machine-governed class

Immutable base-owned policy SHALL依exact tuple與完整changed paths把每個targeting protected integration branch的PR恰分類為 `draft_report_only`、`ordinary`、`repair`、`reconciliation`、`activation_canary`、`activation_closure`、`revert` 或 `release_hotfix`。`draft_report_only` SHALL不得merge，ready後重新分類；`ordinary`走標準machine gates；`repair` SHALL綁定failed delivery ID；`reconciliation` SHALL綁定ambiguous merge／delivery ID，或在 `AUTONOMOUS_ACTIVE` 綁定 `DELIVERY_PENDING_FIXPOINT` debt與delivery ID的closure-only diff；`activation_canary`與 `activation_closure` 只在對應activation phase與manifest lease內合法；`revert`與 `release_hotfix` SHALL使用 `critical_machine_adjudication`。沒有任何class MAY導回human／CODEOWNER approval。零分類、多重分類、unknown class或缺少required lineage SHALL fail closed。

#### Scenario: PR無法唯一分類

- **WHEN**PR同時符合多個class、完全不符合closed class，或caller提供的class與base-owned classifier不一致
- **THEN**gate SHALL以 `HELD/PREMERGE_EVIDENCE_INVALID`結案
- **AND**系統 SHALL NOT把它稱為「非正常PR」並交回human approval

#### Scenario: Revert或release hotfix進入merge gate

- **WHEN**PR被base-owned policy分類為 `revert` 或 `release_hotfix`
- **THEN**它 SHALL執行deterministic gates與完整 `critical_machine_adjudication`
- **AND**unavailable或unresolved risk SHALL為typed `HELD`，不得用admin或human bypass

#### Scenario: Draft轉為ready

- **GIVEN**PR在 `draft_report_only` 只產生report且不得pass merge gate
- **WHEN**GitHub authoritative state顯示它ready for review
- **THEN**collector SHALL對current exact tuple重新執行closed classification與全部required gates
- **AND**draft期間的verdict SHALL NOT被沿用

### Requirement: PR finalization SHALL be draft-first, head-frozen and bounded to two review rounds

每個named PR在draft期間 SHALL只累積advisory findings與affected verification，不得取得passing merge verdict。PR ready後，coordinator SHALL先完成base update與scope確認，再將current exact head凍結為round 1；每個round SHALL對一個immutable exact head完成完整pagination、deterministic gates、適用machine review與finding disposition。Round 1如有confirmed in-scope blocker，coordinator MAY只推送一個包含全部修復的batch repair head；舊head evidence SHALL全部失效。Round 2 SHALL只review該batch repair exact head。Round 2仍有confirmed blocker、需要第三個candidate head、head freeze遭破壞或evidence不完整時，transaction SHALL以 `HELD/PREMERGE_EVIDENCE_INVALID`結案，不得自動啟動第三輪。只有新的使用者啟動與新的scope、evidence或hypothesis MAY建立新transaction。

#### Scenario: Draft期間先收集finding

- **GIVEN**PR仍為draft
- **WHEN**reviewer、CI或coordinator發現一個或多個問題
- **THEN**系統 SHALL保存sanitized advisory findings並允許author整理candidate
- **AND**不得發布passing required gate或消耗ready後的兩輪budget

#### Scenario: Round 1 findings以單一batch修復

- **GIVEN**ready PR的round 1已完成完整collection與finding disposition
- **WHEN**存在confirmed、in-scope且可修復的blockers
- **THEN**coordinator SHALL一次修復該round全部blockers並至多push一個batch repair head
- **AND**round 1的checks、review、threads與verdict SHALL對新head失效
- **AND**逐finding push或無關scope change SHALL視為head freeze破壞

#### Scenario: Final exact head通過後立即merge

- **GIVEN**round 1沒有blocker，或round 2已驗證唯一batch repair head
- **AND**final exact head的source-pinned required App CheckRun為actual `success`
- **AND**其他required checks符合policy允許的actual success、完整pagination證明unresolved threads為零，且protection、base、head與evidence未漂移
- **WHEN**privileged finalizer取得綁定同一tuple的single-use lease
- **THEN**finalizer SHALL在該lease內立即進入exact-head compare-and-swap merge
- **AND**不得再等待human／CODEOWNER approval、last-push approval、額外quiet period或另一個push

#### Scenario: Round 2仍有blocker或需要第三個head

- **WHEN**round 2仍有confirmed blocker、collection不完整、需要再push修復、發生第二個writer mutation或head再次漂移
- **THEN**transaction SHALL以 `HELD/PREMERGE_EVIDENCE_INVALID`結案
- **AND**report SHALL在namespaced `failure_detail`記錄 `review_round_budget_exhausted`、`head_freeze_broken` 或具體缺口
- **AND**系統 SHALL NOT busy-loop、自動開第三輪或以舊head verdict解鎖merge

### Requirement: Multi-PR merge order SHALL be produced by a machine-verifiable subagent plan

當同一repository存在兩個以上待交付PR，merge precedence SHALL由獨立唯讀subagent依server-authoritative exact heads、ancestry、changed-file overlap、declared dependency與machine-gate surface產生closed merge plan；不得由human-authored順序欄位或queue日期決定。Plan SHALL綁定repository、base OID、policy digest、subagent task／model identity、每個PR exact head、predecessors與dependency proof。每個predecessor SHALL在successor之前；被另一PR完整涵蓋的redundant PR SHALL記為 `SKIP_SUBSUMED`並綁定保留的successor與proof。Plan只決定候選順序，不授予merge authority；每次predecessor merge後，next PR SHALL重新收集base/head/checks/threads、重跑applicable gates並取得new exact-head lease。

#### Scenario: Subagent輸出dependency order與subsumed PR

- **GIVEN**多個open PR具有可重現的ancestry、overlap或explicit dependency evidence
- **WHEN**唯讀subagent輸出closed merge plan
- **THEN**所有predecessors SHALL在線性merge order中先於successors
- **AND**redundant PR SHALL以 `SKIP_SUBSUMED`保留proof而不得merge
- **AND**human MAY批次執行或停止該plan，但 SHALL NOT覆寫order或把skip改成merge

#### Scenario: Plan不是subagent產生或dependency順序錯誤

- **WHEN**plan宣稱human author、缺subagent identity／proof、predecessor出現在successor後、skip target不存在或任一head漂移
- **THEN**merge eligibility SHALL為 `HELD/PREMERGE_EVIDENCE_INVALID`
- **AND**系統 SHALL NOT以PR號、日期、人工偏好或舊plan替代

#### Scenario: 前一PR merge後重驗下一PR

- **WHEN**plan中的predecessor已merge並改變integration branch
- **THEN**下一PR SHALL對new server-authoritative base重新取得complete evidence、finding convergence與source-pinned actual success
- **AND**舊plan中的ordering MAY保留為candidate，舊exact-head gate／lease SHALL失效

### Requirement: Every adjudication SHALL bind an immutable exact-head evidence packet

Machine adjudication packet SHALL 綁定 repository、PR number、base branch／SHA、head branch／SHA、merge-base、完整 changed paths與digest、immutable diff digest、policy digest、verification manifest digest、required-check source map、OpenSpec alignment、conversation state與完整 evidence surface digest。Packet SHALL以external attestation envelope綁定issuer／key ID、algorithm、nonce、issued／expires timestamps與payload／artifact digests。Deterministic isolated scanner SHALL在任何model invocation前檢查raw candidate diff；提供給L1–L3的candidate diff bytes SHALL與packet中的完整review-semantic diff byte-identical。若任何secret-like value需要改寫、遮罩或刪除semantic bytes，gate SHALL直接block且不得把redacted partial diff交給model裁決。Collector SHALL 以 bounded pagination 取得 server-authoritative data；缺頁、未知欄位、binary／submodule未處理、evidence超限、base/head drift、unknown／expired／revoked signer、artifact authentication失敗或digest不一致時 SHALL fail closed。

#### Scenario: Exact tuple 在裁決期間保持不變

- **GIVEN** collector 已建立 immutable adjudication packet
- **WHEN** deterministic與machine review layers完成
- **THEN** privileged executor SHALL重新讀取base SHA、head SHA、changed paths、checks、conversation state與policy source
- **AND** 只有所有值與packet一致時才可繼續

#### Scenario: PR head 在裁決期間漂移

- **WHEN** server-authoritative head SHA、base SHA、changed-path digest或evidence digest與packet不一致
- **THEN** 此packet SHALL失效
- **AND** gate SHALL回傳 `HELD`
- **AND** 系統 SHALL針對新tuple重新開始，而非沿用舊verdict

#### Scenario: Secret redaction會改變review surface

- **WHEN**deterministic pre-model scan發現candidate diff含secret-like bytes，且任何redaction會使model input不再byte-identical
- **THEN**gate SHALL以 `HELD/PREMERGE_EVIDENCE_INVALID`結案
- **AND**L1、L2與L3 SHALL NOT接收redacted或partial candidate diff
- **AND**report SHALL只列non-secret path／rule ID，不得echo value

### Requirement: Critical machine adjudication SHALL use three-layer cross-adversarial review

Risk policy SHALL 將現行 `human_critical` 路徑遷移為 `critical_machine_adjudication`，而非逐 PR 人工審批。Critical machine adjudication SHALL 在 deterministic gates 後依序執行 L1 finder、使用不同模型且 refute-by-default 的 L2 cross-refuter，以及重讀 raw immutable evidence 的 L3 apex synthesizer。三層 SHALL 使用 closed output schema並保存model、effort、prompt boundary與evidence references；它們不是票數共識。任一 required layer unavailable、輸出無法解析、evidence無法重現或仍有 unresolved HIGH／CRITICAL blocker時，gate SHALL為 `HELD`。

#### Scenario: 三層對抗全部收斂

- **GIVEN** deterministic gates通過且policy將PR分類為 `critical_machine_adjudication`
- **WHEN** L1 findings由L2逐條反駁或確認，且L3重讀raw packet後輸出closed verdict
- **THEN** machine verdict MAY為 `passed`
- **AND** report SHALL保存surviving findings、killed findings、uncertainties與mitigations

#### Scenario: Reviewer unavailable或仍有高風險

- **WHEN** 任一required layer未執行、模型／effort／prompt boundary漂移、output schema不合法，或L3保留unresolved HIGH／CRITICAL finding
- **THEN** machine verdict SHALL為 `HELD`
- **AND** deterministic pass SHALL NOT覆蓋該結果

#### Scenario: Mechanical-only PR不需要model review

- **GIVEN** immutable policy將完整changed-path與diff surface分類為 `mechanical_only`
- **WHEN**所有required deterministic gates通過
- **THEN** policy MAY省略L1至L3
- **AND** report SHALL記錄classification evidence與policy digest

### Requirement: Privileged executors SHALL never execute candidate-controlled code

Verification computation、machine reviewers、merge executor與deployment transport SHALL採最小權限分離。執行candidate code的verifier SHALL無merge／check-write／deployment credential，使用deny-by-default egress與allowlisted inputs，並有bounded CPU、wall-clock、memory與output-byte budgets；持有短效credential的external executor SHALL只消費server state、authenticated immutable evidence與base-pinned policy，且 SHALL NOT checkout、import、source、evaluate或執行candidate-controlled workflow、script、module或artifact。Check、merge與deploy credential broker SHALL分離。Candidate process SHALL NOT繼承token、private inventory、SSH material或raw environment values；credential-bearing deployment transport SHALL只建立target-scoped opaque lease並執行attested transport bundle。

#### Scenario: Candidate修改merge或verification mechanism

- **WHEN** PR修改 `.github/**`、merge／verification／deploy scripts、contracts、manifest或CODEOWNERS
- **THEN** external trust root SHALL用先前已attest的immutable policy bundle裁決
- **AND** privileged executor SHALL把candidate版本視為data而非executable code
- **AND**無法在舊trust boundary內驗證時 SHALL回傳 `HELD`

#### Scenario: Candidate嘗試取得credential

- **WHEN** candidate test或artifact要求token、private inventory、SSH key或deployment environment value
- **THEN** verifier SHALL拒絕該access
- **AND** credential SHALL NOT出現在process environment、command line、log或artifact
- **AND**拒絕結果 SHALL成為blocker evidence

#### Scenario: Signed evidence的provenance不可驗證

- **WHEN**attestation issuer／key用途不符、key未知／過期／撤銷、nonce已使用、payload digest不符，或artifact reference的content digest、size、media type、ACL scope／authentication與retention class無法驗證
- **THEN**privileged executor SHALL拒絕該evidence
- **AND**transaction SHALL以 `HELD/PREMERGE_AUTHORITY_UNAVAILABLE`結案

#### Scenario: Verifier超過egress或resource budget

- **WHEN**candidate verifier要求非allowlisted network destination，或超過CPU、wall-clock、memory、input／output bytes budget
- **THEN**verifier SHALL被bounded termination
- **AND**result SHALL為blocker而非truncated pass

#### Scenario: Merged candidate runtime嘗試存取production secret或外連

- **WHEN**canonical test target上的candidate runtime要求production credential、raw broker value或非allowlisted egress destination
- **THEN**test-scoped sandbox SHALL拒絕該access
- **AND**attempt SHALL以 `FAILED/MERGED_NOT_DELIVERED`結案並保存sanitized security evidence
- **AND**deployment transport credential SHALL NOT暴露給candidate runtime

### Requirement: Merge sink SHALL perform an exact-head compare-and-swap and authoritative reread

Privileged merge executor SHALL 在取得passing exact-head verdict後向external broker取得single-use、short-expiry merge-authorization lease；lease SHALL綁定repo／PR／base／head、protection／ruleset epoch與digest、required-check sources、conversation state、policy／evidence digests與nonce。Owner-controlled protection／ruleset mutation SHALL透過同一broker序列化。Executor在lease內重新讀取所有state；GitHub branch protection SHALL在merge時server-enforce required checks、conversation resolution與exact head。它 SHALL只呼叫GitHub Pull Request Merge REST endpoint，request綁定 `sha=<preparedHead>`與repo政策允許的merge method；SHALL NOT使用 `--admin`、bypass、force push或mutable PR-number-only merge。API回應後 SHALL以bounded authoritative reread確認同一PR已merge、取得valid merge commit且settings epoch未漂移；無法確認時 SHALL以 `HELD/MERGE_OUTCOME_UNVERIFIED`結案並停用該lease。

#### Scenario: Exact-head merge成功

- **GIVEN** final reread與prepared packet完全一致
- **WHEN** REST merge compare-and-swap接受 `sha=<preparedHead>`
- **THEN** executor SHALL重新讀取PR state與merge commit
- **AND**只有server確認相同PR已merge且settings epoch未漂移才可記錄phase `MERGED`

#### Scenario: Merge前狀態漂移

- **WHEN** final rere讀發現head/base、check source、ruleset、conversation、policy或evidence任一不一致
- **THEN** executor SHALL NOT呼叫merge endpoint
- **AND** delivery transaction SHALL以 `HELD/POLICY_OR_SETTINGS_DRIFT`結案

#### Scenario: Final reread後發生non-head state mutation

- **WHEN**lease期間required check source／conclusion、conversation、policy、protection或ruleset epoch在REST merge前後漂移，或out-of-band settings mutation未經broker序列化
- **THEN**GitHub server enforcement或post-sink reread SHALL阻擋／揭露該mutation
- **AND**executor SHALL撤銷lease、disable sink並以 `HELD/POLICY_OR_SETTINGS_DRIFT` 或 `HELD/MERGE_OUTCOME_UNVERIFIED`結案
- **AND**系統 SHALL NOT以僅head SHA相等宣稱完整authorization仍有效

#### Scenario: Merge API結果不可確認

- **WHEN** merge request發生timeout、ambiguous response或post-sink reread無法確認結果
- **THEN** terminal class SHALL為 `HELD` 且reason code SHALL為 `MERGE_OUTCOME_UNVERIFIED`
- **AND**系統 SHALL先恢復GitHub authoritative state，不得猜測成功、重複merge或開始部署

### Requirement: Delivery transaction SHALL use a closed phase, terminal-class and reason-code schema

Transaction phase SHALL只允許 `COLLECTING`、`VERIFYING`、`READY_TO_MERGE`、`MERGING`、`MERGED`、`DEPLOYING`、`VERIFYING_DEPLOYMENT`、`RETRYING_DEPLOYMENT`與 `CLOSED`。只有 `CLOSED` SHALL帶有對使用者公開的terminal class，且terminal class SHALL只允許 `DELIVERED`、`FAILED` 或 `HELD`。Reason code SHALL只允許 `DELIVERY_VERIFIED`、`PREMERGE_EVIDENCE_INVALID`、`PREMERGE_AUTHORITY_UNAVAILABLE`、`POLICY_OR_SETTINGS_DRIFT`、`MERGE_OUTCOME_UNVERIFIED`、`DEPLOYMENT_BLOCKED`、`MERGED_NOT_DELIVERED`、`DELIVERY_PENDING_FIXPOINT` 或 `ACTIVATION_UNATTESTED`。Failure details MAY使用namespaced detail欄位，但 SHALL NOT擴充或取代closed state fields；任何新值需要新的OpenSpec delta。每個 `delivery_id/attempt_id` SHALL只close一次；resume、retry、fixpoint closure或repair SHALL建立帶 `supersedes_attempt_id` 的新append-only attempt，不能改寫舊terminal event。使用者看到的delivery summary SHALL由同一lineage最新、已驗證event推導。

#### Scenario: Transaction成功完成

- **WHEN**exact commit identity與所有required deployment gates通過
- **THEN**phase SHALL為 `CLOSED`
- **AND**terminal class SHALL為 `DELIVERED`
- **AND**reason code SHALL為 `DELIVERY_VERIFIED`

#### Scenario: Internal reason被發布成未知terminal state

- **WHEN**producer嘗試把 `MERGE_OUTCOME_UNVERIFIED`、`MERGED_NOT_DELIVERED`、`DELIVERY_PENDING_FIXPOINT`或任意unknown value寫入terminal-class欄位
- **THEN**schema validation SHALL失敗
- **AND**publisher SHALL NOT發布passing terminal record

#### Scenario: Queue lock依terminal class與merge boundary處理

- **WHEN**transaction在pre-merge以 `HELD`結案
- **THEN**該exact tuple SHALL保持不可merge且不得造成main mutation
- **AND**`HELD/MERGE_OUTCOME_UNVERIFIED` 或 `HELD/DELIVERY_PENDING_FIXPOINT` 只允許綁定相同lineage的 `reconciliation` PR；其他post-merge `HELD`不得讓任意PR進入sink
- **AND**`FAILED/MERGED_NOT_DELIVERED` 只允許綁定相同failure delivery ID的 `repair` 或 `revert` PR
- **AND**只有 `DELIVERED` SHALL釋放 `ordinary` delivery queue

### Requirement: Each repository SHALL serialize merge through terminal delivery state

同一repository SHALL只有一個single-flight delivery lock，涵蓋 `READY_TO_MERGE → MERGING → MERGED → DEPLOYING → VERIFYING_DEPLOYMENT → CLOSED`。上一筆post-merge transaction尚未依closed schema成為 `DELIVERED`，或已以 `FAILED`／post-merge `HELD`結案但對應 `repair`／`revert`／`reconciliation` lineage尚未完成前，下一個 `ordinary` PR SHALL NOT進入merge sink。Delivery record SHALL精確綁定 `PR head → observed merge commit = freshly fetched origin/main = deployed commit`；v1 SHALL NOT以coalescing、ancestor包含或任何未列舉的terminal state取代逐筆歸因。

#### Scenario: 前一筆delivery尚在部署

- **WHEN** repository已有持有delivery lock的 `MERGED`、`DEPLOYING`或 `VERIFYING_DEPLOYMENT` transaction
- **THEN**另一 `ordinary` PR即使checks通過也 SHALL保持queued／`HELD`
- **AND**它 SHALL NOT進入merge sink

#### Scenario: Delivery lineage不一致

- **WHEN** fetched `origin/main`、merge commit與deployed commit任兩者不完全相等，或另一merge／out-of-band ref movement已污染該transaction的歸因
- **THEN**post-merge result SHALL NOT為 `DELIVERED`
- **AND**queue SHALL freeze並以 `HELD/POLICY_OR_SETTINGS_DRIFT`輸出commit mismatch evidence

### Requirement: Post-merge deployment SHALL consume freshly fetched origin/main on the canonical Linux target

只有GitHub authoritative reread確認phase `MERGED` 後，trusted deployment host MAY使用owner-controlled repo-external inventory解析唯一 `role=canonical_test_deploy` Linux target，並執行attested transport bundle中的 `scripts\dev\rebuild-test-deploy.ps1 -Build -InventoryPath '<repo-external target.local.json>'`。Credential-bearing broker SHALL只向transport提供target-scoped opaque lease；candidate runtime不得取得raw inventory／SSH／broker environment。Transport SHALL freshly fetch `+refs/heads/main:refs/remotes/origin/main`、證明其commit完全等於delivery merge commit、使用owner-controlled deployment checkout、保留必要production assets、排除agent/tooling與root planning artifacts，並在target內執行 `scripts\deploy.ps1 -Build`。未merge branch、額外main commit、目前worktree、stale `origin/main`、`local-windows`、`-DryRun`、`-Force`或替代啟動命令 SHALL NOT產生delivery evidence。

#### Scenario: Merge後dispatch canonical Linux rebuild

- **GIVEN** transaction已以authoritative reread確認merge commit
- **WHEN**取得delivery lock並解析唯一canonical Linux target
- **THEN**transport SHALL freshly fetch `origin/main`
- **AND**fresh `origin/main`與deployed source SHALL都完全等於該merge commit
- **AND**target SHALL只以 `scripts\deploy.ps1 -Build` 啟動

#### Scenario: Canonical target或fresh fetch不可證明

- **WHEN**inventory缺失／歧義、target不是Linux、fresh fetch失敗、deployment checkout ownership不可證明或commit不匹配
- **THEN**因command尚未在authenticated exact target上啟動，attempt SHALL以 `HELD/DEPLOYMENT_BLOCKED`結案
- **AND**transport SHALL NOT使用local Windows、當前worktree或stale ref補位

### Requirement: DELIVERED SHALL mean verified canonical Linux runtime outcome

`MERGED`、wrapper exit 0、log存在、單一health response或artifact可讀 SHALL NOT單獨構成完成。`DELIVERED` SHALL至少綁定repository、PR、base/head、完全相等的merge／fresh `origin/main`／deployed commits、non-secret target ID、delivery／attempt／run IDs、timestamps、command IDs／exit codes、service health，以及依changed paths與product contract適用的API、integration、browser、design-fidelity、Kit／WebRTC first-frame／stage／DataChannel與artifact readback結果。Pre-merge Windows protected runner SHALL執行Chromium DPR1、1440×900＋1920×1080 design／semantic gates；post-merge Windows protected runner SHALL透過owner-approved跨網段通道對相同canonical Linux target ID執行browser operability。Linux trusted runner SHALL執行build、service health、Linux API／integration、Kit／WebRTC與artifact readback。External App SHALL只在兩種runner的所有required gates成功後於exact merge commit發布sanitized terminal record。

#### Scenario: 所有適用Linux runtime gates通過

- **GIVEN**exact merge、origin/main與deployed commit identity已驗證
- **WHEN**build、service health與適用post-deploy verification plan全部成功
- **THEN**terminal class SHALL為 `DELIVERED` 且reason code SHALL為 `DELIVERY_VERIFIED`
- **AND**record SHALL列出每個required gate、result、runtime ID與redacted artifact reference

#### Scenario: 只有部分服務或artifact成功

- **WHEN**任一required service、API、integration、browser、Kit runtime或artifact readback失敗、缺失或不可判定
- **THEN**terminal class SHALL NOT為 `DELIVERED`
- **AND**record SHALL明確區分passed、failed、held與not-applicable gates

#### Scenario: Required Windows runner或跨網段path不可用

- **WHEN**適用的pre-merge Windows design／semantic authority、runner、DPR／viewport或fixture任一無法驗證
- **THEN**pre-merge attempt SHALL以 `HELD/PREMERGE_AUTHORITY_UNAVAILABLE`結案
- **AND WHEN**merge後的Windows browser runner、owner-approved跨網段path、fixture或target identity在authenticated canonical target command啟動前無法驗證
- **THEN**post-merge attempt SHALL以 `HELD/DEPLOYMENT_BLOCKED`結案
- **AND**Linux runner success SHALL NOT替代缺失的Windows evidence，producer亦 SHALL NOT跨merge boundary交換兩個reason code

### Requirement: Failed delivery SHALL freeze the queue and enter a bounded repair lineage

已mergecommit若部署或post-deploy驗證可重現地失敗，attempt SHALL保留原始merge與deployment evidence並凍結 `ordinary` merge queue。若attempt開始前已有provenance與digest驗證完成的pinned known-good immutable artifact，系統 SHALL先以相同target identity執行rollback；只有rollback artifact readback、health與required smoke全部成功才可輸出 `ROLLED_BACK`，並以outer `FAILED/MERGED_NOT_DELIVERED`結案。Operator command啟動前缺少pinned artifact、provenance／digest／target／credential漂移 SHALL以 `HELD/DEPLOYMENT_BLOCKED`結案；command啟動後rollback command或驗證無法形成可信terminal evidence SHALL以 `HELD/ACTIVATION_UNATTESTED`結案。只有原始root attempt為同一merge與target的 `FAILED/MERGED_NOT_DELIVERED`、owner policy broker以短效簽章將closed `network_transient` class綁定parent digest、failure evidence、artifact、target fingerprint、deployment command與policy digest，且輸入與commit未漂移、不需code change時，系統 MAY對該exact commit建立總計一次 `RETRYING_DEPLOYMENT` attempt並執行相同command。Retry-of-retry、改名failure class、`DELIVERED`／`HELD` parent、缺少外部分類authority或任一binding漂移 SHALL拒絕；否則 SHALL建立綁定原delivery ID與failure evidence的新exact-head repair／revert PR。系統 SHALL NOT reset／force-push main、重新build舊source作rollback、把last-known-good runtime冒充本次成功、改寫原attempt為 `DELIVERED`或無限重試。

#### Scenario: 同一commit的transient redeploy成功

- **GIVEN**第一輪失敗被deterministic evidence分類為transient，且source、inventory descriptor與command均未漂移
- **WHEN**唯一允許的same-commit redeploy通過全部required gates
- **THEN**新attempt MAY以 `DELIVERED/DELIVERY_VERIFIED`結案
- **AND**append-only lineage SHALL保存原failure attempt、retry attempt與classification理由

#### Scenario: 需要code repair

- **WHEN**失敗需要code、config contract或deployment mechanism變更，或same-commit retry已用盡
- **THEN**`ordinary` merge queue SHALL保持凍結
- **AND**系統 SHALL只允許綁定failure delivery ID的repair／revert PR進入machine gates
- **AND**修復成功 SHALL以新delivery lineage記錄，不得改寫原始failure evidence

### Requirement: Self-referential delivery mechanism changes SHALL close a post-merge fixpoint debt

修改gate、merge executor、deployment path、evidence harness或其policy／contract的PR SHALL在merge前登記immutable self-referential bootstrap debt，並由先前已attest的external mechanism裁決。Merge與canonical Linux runtime通過後，新mechanism SHALL以其自身canonical path重跑verification contract並產生closure evidence。Debt未關閉時，當次attempt SHALL以 `HELD/DELIVERY_PENDING_FIXPOINT`結案，delivery lineage不得宣稱 `DELIVERED`；closure以新linked attempt／PR記錄。在 `AUTONOMOUS_ACTIVE`，closure PR SHALL分類為 `reconciliation`、綁定該debt與delivery ID，changed paths只允許 `scripts/self-referential-bootstrap-ledger.json` 與該entry新／更新的fixpoint evidence refs；它可在ordinary queue凍結時取得machine lease。Closure authority／evidence／command尚未能啟動時只可續走相同debt的reconciliation lineage；authenticated fixpoint command已啟動後產生可重現negative conclusion時才轉入綁定failure delivery ID的repair／revert lineage。兩者皆 SHALL凍結後續mechanism changes與ordinary queue。

#### Scenario: Mechanism PR完成post-merge fixpoint

- **GIVEN**mechanism PR已由先前trusted版本merge並在canonical Linux通過runtime gates
- **WHEN**新canonical mechanism重跑exact verification contract且closure ledger確認相同subject
- **THEN**新closure attempt MAY以 `DELIVERED/DELIVERY_VERIFIED`結案
- **AND**opening、held attempt與closure evidence SHALL保持append-only可追溯

#### Scenario: Fixpoint authority或evidence不可取得

- **WHEN**required runner／authority／artifact不可取得，或fixpoint command尚未能在authenticated exact subject上啟動
- **THEN**新attempt SHALL以 `HELD/DELIVERY_PENDING_FIXPOINT`結案
- **AND**後續mechanism PR SHALL被阻擋
- **AND**只有綁定相同debt與delivery ID的 `reconciliation` closure MAY取得machine lease

#### Scenario: Fixpoint gate產生可重現negative conclusion

- **WHEN**fixpoint command已在authenticated exact subject上執行，並因subject mismatch、invalid closure或verification command nonzero產生可重現negative conclusion
- **THEN**新attempt SHALL以 `FAILED/MERGED_NOT_DELIVERED`結案
- **AND**後續mechanism PR SHALL被阻擋
- **AND**只有綁定failure delivery ID的repair／revert PR MAY進入machine gates

### Requirement: Activation SHALL add and attest machine authority before removing human requirements

Autonomous mode SHALL只在一次性owner-controlled provisioning與activation完成後啟用。Activation SHALL使用closed phases：`LEGACY_GUARDED`、`SHADOW_DUAL`、`CUTOVER_ARMED`、`CANARY_ACTIVE`與 `AUTONOMOUS_ACTIVE`。Mechanism implementation PR在 `LEGACY_GUARDED` 依現行canonical gate merge；`SHADOW_DUAL` 建立agent-inaccessible App／runner／artifact store／credential boundary、完成negative matrix並先加入source-pinned machine check，但machine sink保持disabled。`CUTOVER_ARMED` SHALL由owner broker取得settings lease與exact rollback snapshot，在sink disabled時一次性將required approving review count設為0、停用CODEOWNER review requirement與User approval broker，並立即authoritative reread。`CANARY_ACTIVE` 只允許ordered `activation_canary` 與 `activation_closure`：plan先綁定disposable canary exact tuple；canary `DELIVERED` 後broker才可從authoritative canary merge commit與open debt導出single-use closure exact tuple。Closure changed paths SHALL只包含 `scripts/self-referential-bootstrap-ledger.json` 與該closed entry新／更新的 `docs/evidence/**/self-referential-bootstrap/**` refs，一次只關oldest open root，不得修改其他mechanism。Canary與closure各自machine-only merge並完成exact-commit delivery、settings維持相等且fixpoint closed後，才可進入 `AUTONOMOUS_ACTIVE`。這是一次性bootstrap，不是未來逐PR approval。

#### Scenario: Negative與shadow attestation尚未完成

- **WHEN**expected App source、wrong-source rejection、head drift rejection、candidate mechanism mutation rejection、signer／credential isolation、artifact auth或runner boundary任一未被live evidence證明
- **THEN**required human gate SHALL NOT被移除
- **AND**autonomous merge sink SHALL保持disabled

#### Scenario: Cutover或canary失敗

- **GIVEN**owner broker已取得settings lease與exact rollback snapshot
- **WHEN**cutover reread不一致，或pinned canary未完成machine-only exact-head merge與全部delivery gates
- **THEN**broker SHALL先disable sink、撤銷未消費lease與短效credential，再依snapshot恢復 `LEGACY_GUARDED`
- **AND**activation attempt SHALL以 `HELD/ACTIVATION_UNATTESTED`結案
- **AND**系統 SHALL NOT宣稱machine-only active或把rollback描述為逐PR fallback

#### Scenario: Canary完成後產生closure-only PR

- **GIVEN**manifest-pinned `activation_canary` 已以 `DELIVERED/DELIVERY_VERIFIED`結案，且opening debt仍為唯一oldest open root
- **WHEN**external broker從authoritative canary merge commit與ledger導出closure lease
- **THEN**closure PR SHALL分類為 `activation_closure` 並綁定single-use exact tuple
- **AND**changed paths SHALL只包含ledger與該entry新增／更新的fixpoint evidence refs
- **AND**closure PR SHALL各自完成machine gates、REST CAS與exact-commit delivery
- **AND**任何其他path、額外closed entry或ordinary PR SHALL無lease並以 `HELD/ACTIVATION_UNATTESTED`結案

#### Scenario: Activation完成

- **GIVEN**machine required check已先加入、shadow evidence穩定，且cutover settings authoritative reread相等
- **WHEN**pinned canary與derived closure-only PR皆以machine-only exact-head path成為 `DELIVERED` 且fixpoint closure完成
- **THEN**未來PR SHALL走machine-only path
- **AND**系統 SHALL NOT再要求owner逐PR review或Web UI操作

### Requirement: Activation readiness SHALL pass the G1 through G12 adversarial rubric

Activation L3 apex SHALL對G1至G12逐項輸出 `pass|fail|uncertain`及path:line evidence：canonical delta reconciliation、pre-merge／post-merge分層、closed PR population＋one-time bootstrap、external trust root、deterministic＋independent machine gate、exact-head lease／CAS、per-PR commit attribution、canonical Linux fresh main＋no automatic owner-runtime stop、complete delivery attestation、failure／repair lineage、ordered self-referential closure lane，以及lossless review surface／secret／runner／deployment sandbox boundary。任一項為 `fail` 或 `uncertain` 時，activation readiness SHALL為 `HELD/ACTIVATION_UNATTESTED`。

#### Scenario: G1至G12全部有可重現pass evidence

- **WHEN**L1 finder、不同模型L2 refuter與L3 apex均完成，且L3重讀raw artifacts後將G1至G12全部標為 `pass`
- **THEN**spec MAY進入activation implementation readiness
- **AND**此verdict SHALL NOT替代未來live negative／positive attestation

#### Scenario: 任一rubric項目未知或失敗

- **WHEN**任一G1至G12缺exact evidence、為 `uncertain`或為 `fail`
- **THEN**activation readiness SHALL以 `HELD/ACTIVATION_UNATTESTED`結案
- **AND**vote majority或OpenSpec parse success SHALL NOT覆蓋該結果

### Requirement: Delivery evidence SHALL be secret-safe and append-only

GitHub CheckRun、PR summary與對話回報 SHALL只包含sanitized terminal evidence：delivery／attempt／run IDs、PR、base/head、merge/deployed commits、non-secret target ID、Linux／Windows runner IDs、command results、runtime IDs、attestation issuer／key ID、payload／artifact content digests、redacted artifact references、known gaps、phase、terminal class與reason code。Raw token、private key、credential、repo-external inventory、env value、proxy／CA內容、host、user、internal path或private topology SHALL NOT出現在model context、GitHub output、terminal record或一般log。Detailed evidence SHALL留在authenticated owner-controlled artifact store；reference SHALL驗證content digest、size、media type、ACL scope與retention class。既有terminal event SHALL append-only；retry、repair或fixpoint SHALL建立linked attempt而非覆寫failure。

#### Scenario: Terminal result發布到GitHub

- **WHEN**external App發布delivery CheckRun
- **THEN**output SHALL通過secret redaction與schema validation
- **AND**只包含non-secret identifiers、results與redacted references

#### Scenario: Evidence含敏感值

- **WHEN**collector或runtime output偵測到token、private inventory、raw env、host/user/path或其他private topology
- **THEN**publisher SHALL拒絕發布原文
- **AND**result SHALL標示evidence redaction failure且不得宣稱 `DELIVERED`

### Requirement: Linux Continuous Deployment SHALL start only from a trusted merged event

Dispatcher SHALL只接受server-observed、closed且merged、base為 `main`、repository在allowlist內，且merge前 `source_head_sha = fresh_ci_convergence_head_sha` 的事件；merge後另由trusted observation固定唯一 `merge_commit_sha`，兩個identity不得混用。Event contract SHALL closed；wrong repository、stale convergence SHA、partial pagination、未知欄位或candidate自述的trusted flag SHALL fail closed。

#### Scenario: Stale merge event嘗試啟動deployment

- **GIVEN**PR已merged但collector保存的fresh convergence SHA與observed merge commit不同
- **WHEN**dispatcher驗證事件
- **THEN**不得build artifact或取得target lease
- **AND**attempt SHALL以 `HELD` 結案並保存sanitized drift evidence

### Requirement: One immutable artifact SHALL cross build, canary, promotion, and verification

Artifact authority SHALL為exact merge commit建立一次immutable artifact，closed provenance SHALL綁定source commit與tree、content digest、builder identity、policy digest、issuer／key、nonce、expiry、payload digest、signature與attestation reference。Repo-local request或schema自述不得取代owner executor注入的external verifier結果。Canary、promotion、post-deploy verification與terminal attestation SHALL引用同一content digest；任何artifact mismatch、unknown provenance field或readback drift SHALL不得進 `ACTIVATED`。

#### Scenario: Promotion digest與canary digest不同

- **GIVEN**canary以artifact digest A完成health、smoke與E2E
- **WHEN**promotion readback回報digest B
- **THEN**promotion SHALL失敗
- **AND**attempt SHALL進入pinned known-good rollback路徑，不得輸出 `ACTIVATED`

### Requirement: Deployment target and single-flight ownership SHALL be exact and secret-safe

Target resolver SHALL只接受owner-controlled inventory唯一解析的 `target_id=canonical-linux`，對contract只揭露target ID、kind、role、fingerprint與opaque lease ID；request不得覆寫repository或target allowlist，opaque lease亦必須由external verifier驗證payload binding與有效期。Single-flight key SHALL為 `environment + service`；active lock SHALL綁定delivery ID、replay key、artifact digest、environment、service、target fingerprint與deployment method。只有全部欄位相同的tuple MAY辨識為idempotent active ownership，但 SHALL以typed non-terminal `idempotent_active` response停止、不得append新transition或terminal failure，且不得重跑deployment；任一欄位不同 SHALL被拒絕且不得平行部署同一service。

#### Scenario: Duplicate controller races for the same service

- **WHEN**兩個controller以不同delivery ID要求相同environment與service
- **THEN**只有既有lock owner可繼續
- **AND**第二個controller SHALL fail closed，不得取得deployment credential或覆寫ledger

### Requirement: Canary promotion SHALL use a closed success path

Linux CD success state sequence SHALL精確為 `TRUSTED_MERGED → BUILD_IMMUTABLE_ARTIFACT → VERIFY_ARTIFACT_PROVENANCE → RESOLVE_DEPLOYMENT_TARGET → PRE_DEPLOY_CHECK → DEPLOY_CANARY → VERIFY_HEALTH_SMOKE_E2E → PROMOTE → POST_DEPLOY_VERIFY → ACTIVATED → TERMINAL_DELIVERY_ATTESTATION`。任一required state、health、smoke、E2E或readback缺漏 SHALL不得跳到後續state。

#### Scenario: Canary驗證全部成功

- **WHEN**trusted event、artifact provenance、target、preflight、canary health／smoke／E2E、promotion與post-deploy readback全部對同一digest成功
- **THEN**attempt SHALL進入 `ACTIVATED`
- **AND**sanitized terminal attestation SHALL映射outer `DELIVERED/DELIVERY_VERIFIED`

### Requirement: Failed canary or promotion SHALL rollback only to a pinned known-good artifact

Canary、promotion或post-deploy failure SHALL進入 `ROLLBACK_TO_PINNED_KNOWN_GOOD_ARTIFACT → VERIFY_ROLLBACK`。Rollback artifact SHALL在attempt開始前已pinned、provenance可驗證且content digest immutable；不得以branch checkout、重新build舊source、reset或force-push main代替。Readback、health與required smoke全部成功時 SHALL輸出 `ROLLED_BACK` 並映射outer `FAILED/MERGED_NOT_DELIVERED`；operator command前的known-good／target evidence不完整 SHALL輸出 `HELD/DEPLOYMENT_BLOCKED`，command後rollback evidence無法可信結案 SHALL輸出 `HELD/ACTIVATION_UNATTESTED`。

#### Scenario: Pinned rollback artifact不可驗證

- **WHEN**failure發生後known-good artifact缺失、digest不符、signer revoked或target readback不完整
- **THEN**系統 SHALL NOT猜測runtime已恢復
- **AND**attempt SHALL以 `HELD/DEPLOYMENT_BLOCKED` 結案並凍結ordinary queue

### Requirement: Retry and terminal delivery history SHALL be bounded and append-only

同一exact event、artifact、target與command只允許policy明定的bounded transient retry；主controller path SHALL消費single-flight結果、retry history與candidate event，並為每個state transition append previous-digest-linked record。Retry SHALL建立linked attempt，outer record SHALL通過既有attempt append validator並保留前一筆terminal evidence，不得改寫。Terminal attestation SHALL closed且sanitized，至少包含delivery／attempt IDs、repository／PR、merge commit、artifact／provenance digests、non-secret target descriptor、state sequence、retry lineage、rollback result、terminal mapping與known gaps。

#### Scenario: Retry budget耗盡

- **WHEN**同一exact input已用完允許的transient retry
- **THEN**dispatcher SHALL拒絕新的automatic attempt
- **AND**既有attempt與ledger SHALL保持append-only

### Requirement: Missing external CD provisioning SHALL be explicit HELD evidence

Repo-local workflow與controller SHALL NOT持有live deployment credential或讀取private inventory。External artifact store、trusted runner、credential broker、protected GitHub Environment或canonical target live attestation任一尚未由owner provision時，workflow SHALL產生sanitized internal `PROVISIONING_REQUIRED → HELD` state sequence，且不得執行production或把contract test描述為deployment。已有independently verified `fetched origin/main == merge commit` 的trusted request SHALL以outer `HELD/DEPLOYMENT_BLOCKED`一致結案；direct GitHub event boundary尚無該proof時 SHALL以outer `HELD/ACTIVATION_UNATTESTED`一致結案，不得讓attestation與outer terminal reason互相矛盾。

#### Scenario: Repository workflow在未provision狀態執行

- **WHEN**trusted merged event觸發repo-local workflow但external capability descriptor不完整
- **THEN**workflow SHALL驗證contracts與negative tests後輸出 `PROVISIONING_REQUIRED → HELD`
- **AND**不得呼叫production target、揭露secret或宣稱 `ACTIVATED`
