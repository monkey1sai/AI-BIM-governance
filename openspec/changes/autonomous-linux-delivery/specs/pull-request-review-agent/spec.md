## ADDED Requirements

### Requirement: PR review agent evidence SHALL be exact-head and source-pinned

PR review agent SHALL build its decision from a bounded, immutable packet tied to repository、PR number、base branch／SHA、head branch／SHA、merge-base、complete changed-path digest、diff digest、policy digest、verification-manifest digest and required-check source map. Deterministic secret scan SHALL precede model invocation；L1–L3只能接收與packet完整review-semantic diff byte-identical的candidate bytes，任何需要redaction／omission的diff SHALL block而非交給model。Packet SHALL攜帶可驗證issuer／key ID、algorithm、nonce、issued／expires timestamps及payload／artifact digests；unknown／expired／revoked signer或artifact authentication失敗 SHALL fail closed。A source-pinned external GitHub App SHALL publish the required CheckRun only after validating this packet; candidate workflows、caller-supplied SHA、PR comments、reviews或同名commit statuses SHALL NOT constitute merge authority.

#### Scenario: Packet與server state一致

- **WHEN** collector完整取得server-authoritative PR、diff、checks、conversation與policy state
- **THEN** report SHALL保存exact tuple與immutable digests
- **AND** required CheckRun SHALL綁定同一head SHA與expected App source

#### Scenario: Evidence不完整或漂移

- **WHEN**pagination不完整、binary／submodule未被policy處理、evidence超限、digest不一致或base/head在run期間漂移
- **THEN** gate status SHALL為 `held`
- **AND** report SHALL列出缺失或漂移類型
- **AND**舊packet SHALL NOT被重用於新head

#### Scenario: Required CheckRun結論映射

- **GIVEN**expected external App是branch protection所pin的required source
- **WHEN**exact-head packet完整、所有required deterministic／machine gates通過且zero unresolved threads已由完整pagination證明
- **THEN**publisher MAY在該head發布actual `success`
- **AND**只有該source的actual `success` SHALL成為merge-eligible evidence

#### Scenario: HELD或不完整結果不得偽裝成GitHub pass

- **WHEN**gate status為 `held`／`blocked`／`failed`、publisher unavailable、collection incomplete或tuple drift
- **THEN**required CheckRun SHALL保持absent／pending或以blocking conclusion結案
- **AND**publisher SHALL NOT使用 `neutral` 或 `skipped`
- **AND**同名commit status、comment、review或wrong-source CheckRun SHALL NOT解鎖merge

#### Scenario: Candidate diff需要semantic redaction

- **WHEN**pre-model secret scan判定任何candidate diff byte不能安全地byte-identical提供給review layers
- **THEN**gate status SHALL為 `held`
- **AND**L1–L3 SHALL NOT執行partial或redacted review
- **AND**report SHALL只列non-secret path與rule ID

### Requirement: Every CI and review finding SHALL receive a closed evidence-bound disposition

PR review agent SHALL先驗證finding是否成立，再將每個CI、deterministic validator、machine reviewer或human reviewer finding對frozen exact head裁決為 `ACCEPTED`、`FIX_REQUIRED`、`FALSE_POSITIVE`、`DEFERRED` 或 `ESCALATE`。`ACCEPTED` SHALL要求confirmed，且finding已由current head上的既有commit處理，或屬immutable policy明定的non-blocking P3／MEDIUM／LOW／ADVISORY風險；`FIX_REQUIRED` SHALL要求confirmed、in-scope，且只有repair head、可重現regression evidence與independent re-review reference同時存在時才算已修復；`FALSE_POSITIVE` SHALL要求refuted與可重現反證；`DEFERRED` SHALL要求confirmed、out-of-scope、同repo follow-up Issue與policy依據；`ESCALATE` SHALL用於超出autonomous authority或屬security／ACL／architecture／schema migration／deployment／production／credentials risk class的finding，且該PR SHALL NOT autonomous-merge。Confirmed in-scope P0／P1／P2／BLOCKER／CRITICAL／HIGH SHALL只能 `FIX_REQUIRED` 或 `ESCALATE`。舊值 `FIX`／`REJECT`／`ACCEPT_RISK`／`DEFER` SHALL正規化為對應closed value。Unverified finding（`ESCALATE` 除外）、unknown disposition、缺evidence、自述已修復卻無fix evidence，或違反severity／scope／risk-class mapping SHALL fail closed。

#### Scenario: Finding經裁決後不需要code修改

- **GIVEN**finding已由exact-head evidence證明為false positive、已由current head既有commit處理、policy-eligible non-blocking risk或out-of-scope follow-up
- **WHEN**agent分別記錄 `FALSE_POSITIVE`、`ACCEPTED` 或 `DEFERRED`及其required evidence
- **THEN**conversation MAY被resolve且不要求新的code diff
- **AND**resolution SHALL表示disposition lifecycle完成，不得宣稱finding已被fix

#### Scenario: Confirmed in-scope blocker不能被接受或延後

- **WHEN**P0／P1／P2／BLOCKER／CRITICAL／HIGH finding已confirmed且in-scope
- **THEN**可通過的disposition SHALL只有 `FIX_REQUIRED`（附repair head、regression evidence與independent re-review）或 `ESCALATE`
- **AND**缺current-head修復或regression evidence SHALL保持thread unresolved並使gate `blocked`或 `held`

#### Scenario: 高風險finding必須escalate

- **WHEN**finding的risk class為security、ACL、architecture、schema migration、deployment、production或credentials
- **THEN**除非以可重現反證裁決為 `FALSE_POSITIVE`，disposition SHALL為 `ESCALATE`
- **AND**該transaction SHALL以 `HELD` 離開autonomous authority，thread SHALL保持unresolved

#### Scenario: Machine gate只能在finding convergence後發布

- **GIVEN**collector以完整pagination取得所有review threads與CI findings
- **WHEN**每個finding都有合法disposition、所有對應thread已resolve且server unresolved count為零
- **THEN**review convergence MAY成立
- **AND**source-pinned App只可在convergence後對相同frozen head發布actual `success`，且該CheckRun SHALL是expected source在該head的最新一筆並在convergence之後開始；同head完整CheckRun清單、convergence epoch與collected finding identity set SHALL由candidate bundle之外的trusted collector供給，bundle自述值沒有authority
- **AND**convergence前的success、stale-head success、被較新rerun取代的舊success、不完整thread集合或未涵蓋完整collected finding set的bundle SHALL NOT成為merge evidence

### Requirement: Merge queue agent SHALL act as the Review Disposition Agent with structured, loop-safe GitHub replies

Merge queue agent SHALL為每個finding在對應review thread留下structured GitHub reply，內含人類可讀理由、evidence位置與next action，以及隱藏machine-readable metadata（`<!-- ai-bim-review-disposition/v1 {...} -->`），至少綁定 `finding_id`、`thread_id`、`head_sha`、`base_sha`、`agent_run_id`、`sender`、`webhook_event_id`、`disposition`、severity、risk class、verification與evidence fingerprint。Agent SHALL以完整tuple（`finding_id`、`head_sha`、`agent_run_id`、`sender`、`webhook_event_id`）做idempotency，並在同一head已有相同disposition時skip。帶有metadata marker的comment SHALL視為agent output而非finding intake；rendered body SHALL NOT包含reviewer-bot mention。每次reply或resolution mutation前後 SHALL重讀exact PR tuple，漂移即 `HELD`／`resolution_race`。`FIX_REQUIRED` SHALL進入既有fix pipeline（disposition → repair worktree → targeted tests → affected integration tests → current-head CI → independent re-review → thread resolved → exact-head merge-policy check → counted adjudication → exact-head merge）；任何agent assertion SHALL NOT單獨滿足merge gate；`ESCALATE` 與未修復的 `FIX_REQUIRED` thread SHALL保持unresolved。

#### Scenario: 重複webhook或重跑不得重複處理

- **GIVEN**thread內已存在agent metadata且 `finding_id`、`head_sha` 與 `disposition` 相同，或完整tuple相同
- **WHEN**同一finding再次進入agent
- **THEN**agent SHALL skip且不得留下第二則reply
- **AND**新head或新disposition MAY產生新reply

#### Scenario: Agent自己的留言不得再次觸發agent

- **WHEN**collector讀取thread comments
- **THEN**帶marker的comment SHALL被排除於finding intake之外
- **AND**rendered reply SHALL NOT包含 `@codex`／`@claude` 等reviewer-bot mention

#### Scenario: FIX_REQUIRED進入既有fix pipeline

- **GIVEN**finding裁決為 `FIX_REQUIRED` 且reply已留下
- **WHEN**coordinator在repair worktree修復、targeted tests與current-head CI通過並取得independent re-review reference
- **THEN**finding MAY標記 `fixedOnHead` 並附fix evidence，thread MAY resolve
- **AND**僅有「fixed」留言而無repair head、regression evidence與re-review reference時，bundle SHALL保持incomplete且gate SHALL NOT通過

### Requirement: Critical PRs SHALL receive three-layer cross-adversarial machine adjudication

PR review policy SHALL將最高風險machine lane分類為 `critical_machine_adjudication`。此lane SHALL在deterministic gates後執行L1 finding、由不同模型以refute-by-default方式執行L2 cross-refutation，以及由apex model重讀raw immutable packet執行L3 synthesis。每層 SHALL輸出closed schema，並保存model、effort、prompt boundary、evidence、uncertainty、risk與next action。任一required layer unavailable、輸出無法解析、evidence無法重現或仍有unresolved HIGH／CRITICAL blocker時，gate SHALL為 `held`。

#### Scenario: 三層結果可重現且無blocker

- **GIVEN**PR被分類為 `critical_machine_adjudication`
- **WHEN**L1、L2與L3依序完成，且L3確認所有surviving findings已解決或有deterministic mitigation
- **THEN**gate MAY回傳 `passed`
- **AND**report SHALL列出killed、surviving與unverified findings

#### Scenario: 不同模型無法取得或L3仍有blocker

- **WHEN**L2未使用與L1不同的受允許模型、任一層unavailable或L3保留HIGH／CRITICAL blocker
- **THEN**gate status SHALL為 `held`
- **AND**其他model vote、deterministic pass或先前head verdict SHALL NOT覆蓋它

### Requirement: Review computation SHALL NOT hold merge or deployment authority

Deterministic validator、L1／L2／L3 reviewers與candidate-code verifier SHALL在無merge／check-write／deployment credential、deny-by-default egress、allowlisted inputs與bounded CPU／time／memory／output-byte環境執行。只有candidate-inaccessible external executor MAY消費authenticated immutable verdict並發布required check或執行exact-head merge；privileged executor SHALL NOT checkout或執行candidate-controlled code。Check、merge與deploy credential broker SHALL分離。

#### Scenario: Reviewer被prompt或code要求執行merge

- **WHEN**review input、candidate code或artifact要求GitHub write、merge、deployment、secret或private inventory access
- **THEN**reviewer SHALL拒絕該action
- **AND**attempt SHALL成為blocker evidence
- **AND**任何credential SHALL NOT進入review process、model context、log或artifact

## MODIFIED Requirements

### Requirement: PR review agent 發布可審查 evidence

PR review agent SHALL 為每次 run 發布 machine-readable report 與 human-readable summary。兩者都是可觀測 evidence，不是 human approval request 或 merge authority。

#### Scenario: Review report 被建立

- **WHEN** PR review agent 完成
- **THEN** 它會產生包含 `status`、`risk_level`、`base_sha`、`head_sha`、`changed_paths`、`evidence_digests`、`required_check_sources`、`openspec_changes`、`validation_commands`、`checks`、`blockers`、`warnings`、`machine_review_notes`、`adversarial_layers` 與 `gitnexus` 的 JSON report
- **AND** 它會將 sanitized markdown summary 發布為 PR comment、status check summary 或 workflow artifact
- **AND** report SHALL NOT包含credential、raw environment value、private inventory或private topology

#### Scenario: Report generation 失敗

- **WHEN** agent 無法產生可辨識已檢查項目的 report，或report schema／exact-head binding無法驗證
- **THEN** gate status MUST 為 `failed` 或 `held`
- **AND** PR output MUST 說明 review evidence unavailable
- **AND**系統 SHALL NOT沿用先前head的report

### Requirement: Deterministic checks 必須先於 optional AI judgment

PR review agent SHALL 先以 deterministic checks 作為 pass／block決策基礎，再依immutable risk policy執行optional或required machine reviewer。AI reviewer SHALL NOT覆蓋deterministic failure；policy要求的machine reviewer unavailable時 SHALL fail closed，不得以human approval替代。

#### Scenario: Deterministic checks 通過且 AI adapter unavailable

- **GIVEN**policy將PR分類為可省略model review的 `mechanical_only` 或其他明確optional lane
- **WHEN**所有required deterministic checks通過，且optional AI adapter unavailable
- **THEN**gate MAY依configured policy回傳 `passed` 或 `warning`
- **AND**report MUST記錄AI review被skipped、classification evidence與policy digest

#### Scenario: Required machine reviewer unavailable

- **GIVEN**policy將PR分類為需要一層或三層machine review
- **WHEN**任一required reviewer unavailable、output invalid或evidence無法重現
- **THEN**gate status SHALL為 `held`
- **AND**它 SHALL NOT降級為optional、沿用舊verdict或要求human approval補位

#### Scenario: Deterministic checks 失敗

- **WHEN** 任一 required deterministic check 失敗
- **THEN** optional或required AI reviewer output MUST NOT 將 gate 轉為 `passed`
- **AND** report MUST 將 failed command 或 check 列為 blocker

### Requirement: PR review agent 阻擋 secret 與 environment-value changes

PR review agent SHALL 阻擋 unsafe secret、credential、private key 與 real environment-value modifications，並以machine policy處理安全刪除或example contract，不要求逐PR human review。

#### Scenario: Secret-like file 被修改

- **WHEN** PR 修改 private keys、credentials、token files 或 existing `.env` secret values
- **THEN** gate status MUST 為 `blocked`
- **AND** report MUST 在不印出 secret value 的情況下指出 file path

#### Scenario: Secret-like file 被刪除

- **WHEN** PR 只刪除 private keys、credentials、token files 或 existing `.env` secret values
- **THEN** gate SHALL依immutable incident／rotation policy分類為 `blocked` 或 `warning`
- **AND** report MUST要求可機器驗證的rotation或incident-remediation evidence
- **AND**human approval SHALL NOT單獨把結果轉為 `passed`

#### Scenario: Environment example 被更新

- **WHEN** PR 修改 `.env.example` 或新增 documented placeholder variables 且沒有 real secret values
- **THEN** gate MAY 在其他 checks 通過時 pass
- **AND** report MUST 記錄 env contract change 供machine adjudication與delivery verification使用

### Requirement: PR review agent 一致分類 risk 與 blockers

PR review agent SHALL 將每次 run 分類為 `passed`、`warning`、`blocked`、`held` 或 `failed`，並將每個 risk 分類為 `low`、`medium`、`high` 或 `critical`。Classification SHALL綁定exact-head packet與policy digest，不得由human vote覆蓋。

#### Scenario: High 或 critical risk 未解決

- **WHEN** deterministic checks、GitNexus evidence、path policy 或 machine reviewer output 識別出 unresolved HIGH 或 CRITICAL risk
- **THEN** gate status MUST 為 `blocked` 或 `held`
- **AND** report MUST 列出 merge 前需要的 deterministic mitigation或repair action

#### Scenario: 只剩 non-blocking warnings

- **WHEN** required checks 通過且只剩 policy明定的 non-blocking warnings
- **THEN** gate status MAY 為 `warning`
- **AND** report MUST 列出warnings、machine disposition與它們不阻擋merge的policy依據

## REMOVED Requirements

### Requirement: PR review agent 保留 human approval boundaries

**Reason**：此 requirement 與 autonomous Linux delivery 的明示目標直接衝突。啟用後，per-PR human／CODEOWNER approval 與「agent不得自動merge」不再是merge authority；安全邊界改由candidate-inaccessible external machine trust root、source-pinned exact-head CheckRun、credential separation與post-merge canonical Linux delivery提供。

**Migration**：先在既有人類gate仍啟用時，以shadow mode建立external App、trusted verifier／executor、three-layer adjudication、single-flight merge/deploy transaction與live negative／positive attestation；先加入machine required check，最後一次性把required approving review count設為0、停用CODEOWNER review requirement與User approval broker。Activation完成前維持 `HELD`，不得由candidate或一般agent自行移除舊gate。
