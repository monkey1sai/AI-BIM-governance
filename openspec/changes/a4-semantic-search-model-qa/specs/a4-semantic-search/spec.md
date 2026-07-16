## ADDED Requirements

### Requirement: A4 v1 SHALL 將自然語言轉成已驗證 filters，再執行 deterministic IFC search

A4 v1 SHALL 實作有限流程 `natural-language query → schema-validated filters → deterministic IFC scan → structured Evidence Trace`。Interpreter MAY 為 deterministic 或 Ornith，但只有 governance-service 的 deterministic IFC execution SHALL 決定哪些元素符合查詢。A4 SHALL NOT 產生自然語言答案、法規 citation、compliance verdict，也不得宣稱模型或元素符合規則。

所有 user-facing result classification SHALL 使用 `matched_query`／`not_matched_query`（「符合查詢條件」／「未符合查詢條件」），SHALL NOT 使用「符合規範」／「不符合規範」或等價的 compliance 用語。

**備註（決策原因）:** 現況具備可重播的 IFC predicate search，但沒有法規 corpus/version、citation entity 或 compliance bridge。把 Ornith 限制為 filter interpreter，可用 schema 與 IFC 實值驗證；若直接生成答案或 verdict，會把模型語言流暢度誤當 BIM／法規事實。先交付這個可證明的 v1，也保留日後另案加入 RAG 的空間。

#### Scenario: 自然語言查詢產生已驗證 filters 與 deterministic matches

- **GIVEN** 一個 active Review Session 綁定可讀 IFC
- **WHEN** 使用者查詢「找 4F 防火門且 FireRating < 60」且 interpretation 成功
- **THEN** 回應 SHALL 包含符合 `a4_filters_v1` 的 class/storey/property filters
- **AND** 每個 returned row SHALL 由 deterministic IFC scan 產生並包含實際屬性值與 predicate evidence
- **AND** UI SHALL 將結果標為「符合查詢條件」，SHALL NOT 標為「不符合規範」

#### Scenario: 合規問句不產生 compliance verdict

- **WHEN** 使用者以法規或「是否合規」措辭提出 query
- **THEN** A4 MAY 將可支援的 IFC 條件解譯為 filters
- **AND** A4 SHALL 明確表態結果只代表 query predicate match
- **AND** A4 SHALL NOT 產生法條 citation、合規 verdict 或自動 defect classification

### Requirement: 完整 A4 SHALL 綁定 session，且 SHALL 拒絕 browser-controlled host paths

Canonical production flow SHALL 呼叫 `POST /api/governance/search/model/for-session/:sessionId`；browser 只能提供 `query`、`interpret_mode`、bounded `limit` 與 optional retry correlation。Coordinator SHALL 先由 `UserAuthProvider` 取得 server-authenticated principal，驗證 Review Session 為 active，再從 server-owned session/artifact state resolve IFC source、element mapping、model version 與 active stage，最後才 forward 至 governance-service。

Production browser code SHALL NOT 提交 `ifc_source_path` 或 `element_mapping_path`。Generic `POST /api/governance/search/model` SHALL 對 production browser disabled/gated，且 SHALL NOT 把 browser-controlled host path 當 production fallback。`POST /api/governance/search/model/for-ifc-ready/:jobId` MAY 保留為相容的 table-only flow，但 SHALL 省略 session-bound row proof、停用 Issue／3D actions，且 SHALL NOT 滿足完整 A4。

所有 session-scoped A4 search、Issue、handoff、consume、retry 與 viewer-lease claim SHALL 使用同一個 server-authenticated principal；browser body 的 `user_id`、actor、`X-Actor` 或 `X-Operator` 不得建立 authority。若暫時接受 legacy `user_id`，server SHALL 忽略其 authority，並在它與 principal 不一致時拒絕。Lease SHALL 綁定 principal；production profile 使用 `local-dev` provider 或 `sso_binding=pending_oq5` 時 SHALL fail closed 或停用 A4 mutation/full-completion routes。

**備註（決策原因）:** session 是唯一能同時證明 model version、IFC artifact、real mapping、active stage 與 viewer role 的 server-side unit。讓瀏覽器傳 host path 會跨越 trust boundary，也可能把舊 mapping 套到錯的 IFC；只靠 IFC-ready job 則無法證明目前 3D runtime 與 primary authority，因此只能保留為相容查表用途。

#### Scenario: Active session 由 server-side resolve

- **GIVEN** active Review Session 已綁定 IFC artifact、real mapping、model version 與 stage
- **WHEN** browser 對 `/api/governance/search/model/for-session/:sessionId` 送出 query controls
- **THEN** coordinator SHALL server-side resolve 並 forward 該 binding
- **AND** browser request/response SHALL NOT 暴露 absolute host IFC path、mapping path 或 model credential

#### Scenario: 缺少或 inactive session 時誠實拒絕

- **WHEN** browser 對不存在、closed、inactive 或缺必要 artifact binding 的 session 執行 full A4 query
- **THEN** coordinator SHALL 以可區分的 4xx/409 error 拒絕並提供可採取的 next action
- **AND** governance-service SHALL NOT 對 browser fallback path 執行搜尋
- **AND** UI SHALL 顯示可理解的 session/source unavailable state，SHALL NOT 顯示 fixture success

#### Scenario: IFC-ready 相容查詢只提供 table-only

- **GIVEN** 一個 ready IFC job 但沒有 active Review Session
- **WHEN** 使用者經 `for-ifc-ready/:jobId` 執行 query
- **THEN** 系統 MAY 顯示 filter、table result 與 Evidence Trace
- **AND** Issue/focus/highlight controls SHALL disabled 並說明需要 active Review Session
- **AND** table-only rows SHALL NOT 攜帶 session-bound `evidence_proof`
- **AND** evidence SHALL 標示 `completion_scope=table_only`，Full completion claimed SHALL 為 `no`

#### Scenario: Production generic path request 被阻擋

- **WHEN** production browser 嘗試對 generic search route 傳入 `ifc_source_path` 或 `element_mapping_path`
- **THEN** coordinator SHALL 拒絕或使該 route 對 production browser 不可達
- **AND** SHALL NOT 以傳入 path 呼叫 governance-service

#### Scenario: Browser identity 欄位不能提權

- **GIVEN** principal A 已由 coordinator 的 `UserAuthProvider` 驗證
- **WHEN** request body、`X-Actor` 或 `X-Operator` 宣稱 actor B，或攜帶屬於 B 的 lease identifier
- **THEN** coordinator SHALL 以 403／422 拒絕
- **AND** SHALL NOT 建立 proof、handoff、Issue、lease 或 outbound governance request

#### Scenario: Local-dev identity 只能證明 lab scope

- **WHEN** A4 在明確 local-dev/lab profile 使用 bearer-as-user-ID provider
- **THEN** evidence SHALL 標 `auth_scope=local_dev_lab`
- **AND** SHALL NOT 宣稱 production identity/security readiness 或 Full completion

### Requirement: Ornith 設定與 transport SHALL 明確、fail closed 且不洩漏 endpoint

`A4_LLM_ENABLED` SHALL 是明確 boolean，未設定時預設 `false`；credential 存在 SHALL NOT 自動啟用。啟用時 base URL、model、bounded timeout、credential、profile 與 transport mode 必須全部明確且有效，否則 SHALL 回 `llm_config_invalid` 且不得發出 outbound request。`A4_*` 與 `ORNITH_*` aliases 同時存在但 normalized values 不一致時 SHALL fail closed，不得以隱藏 precedence 猜測。

Transport mode SHALL 為 `verified_https`、`loopback_tunnel` 或 `trusted_lab_http`。`verified_https` 必須驗 hostname／CA，禁止 skip-verify；`loopback_tunnel` 的 HTTP endpoint 只能是 `127.0.0.1`／`::1`；`trusted_lab_http` 只限明確 local-dev/lab profile、explicit allow-insecure 與 allowlisted lab host，且只能作 lab semantic integration evidence。Production non-loopback HTTP SHALL fail closed。

Public status、Evidence Trace 與 structured error SHALL 只顯示 sanitized config state、config-source key name、transport class、model、freshness 與 error code，SHALL NOT 顯示 endpoint、credential、Authorization header、remote response body、raw probe 或 raw completion。

**備註（決策原因）:** Server-side only 可避免 browser 直接取得 token，卻不能阻擋 non-loopback HTTP 上的 sniffing／MITM；而「只要有 key 就啟用並回退到固定 lab URL」會讓 deployment 漏設 URL 時把 query 誤送到 lab。Explicit enable、完整 config validation 與 transport matrix 把 lab convenience 和 production security readiness 分開。

#### Scenario: Key 存在但未明確啟用時 zero outbound

- **GIVEN** process 有 A4／Ornith credential，但 `A4_LLM_ENABLED` 未設定
- **WHEN** service 載入 LLM config 或 UI 查詢 status
- **THEN** LLM SHALL 為 disabled 且不得發 outbound request
- **AND** response SHALL NOT 包含 endpoint 或 credential

#### Scenario: Conflicting aliases 或不安全 production transport 被拒絕

- **WHEN** required config 缺漏、aliases normalized values 衝突，或 production profile 指向 non-loopback HTTP
- **THEN** service SHALL 回 `llm_config_invalid` 並 zero outbound
- **AND** error/status SHALL 只包含 sanitized reason code

#### Scenario: Trusted lab HTTP 不等於 production readiness

- **GIVEN** explicit lab profile、allow-insecure 與 allowlisted host 都成立
- **WHEN** 非敏感 smoke 經 `trusted_lab_http` 完成
- **THEN** evidence MAY 標 lab semantic integration observed
- **AND** production transport/security readiness 與 Full completion SHALL 仍為 `no`

### Requirement: Interpretation modes SHALL 具備明確的 invocation、failure 與 degradation semantics

Search contract SHALL 支援 `deterministic`、`semantic` 與 `auto`。每個 candidate 在執行前 SHALL 暴露 `schema_valid`、`complete`、`usable` 與 `unresolved_terms`；這些 flags SHALL 由 governance-service validator 依原始 query、normalized filters 與可驗證的 consumed spans 計算，Ornith 自報值不得成為 execution authority。

`complete=true` 只有在 `schema_valid=true`、`usable=true`、全部 constraint-bearing segment 都已轉成 supported filter 或 harmless stopword、`unresolved_terms=[]`，且沒有矛盾／unsupported constraint 時才允許。`schema_valid=false` SHALL 導致 `complete=false` 與 `usable=false`；`usable=false` 在任何 mode 都不得呼叫 IFC scanner。`complete=false` 預設也不得執行、不得發 `evidence_proof`，且不得啟用 Issue／focus／highlight。

- `deterministic` SHALL 永不呼叫 Ornith；只有 complete + usable candidate 可直接執行。Incomplete but usable candidate SHALL 先回 `partial_fallback_confirmation_required` 與零 rows。
- `semantic` SHALL 呼叫 Ornith；只有 validator 判定 complete + usable 的 schema-valid candidate 可執行。Incomplete SHALL 回 `semantic_incomplete` 與零 rows；timeout、HTTP error、empty/length-truncated output、schema-invalid、unusable 或 contract violation SHALL 回 visible retryable `semantic_error`，且不得 fallback。
- `auto` 只有在 deterministic candidate complete + usable 時不呼叫 Ornith並直接執行；否則 SHALL 呼叫 Ornith。只有 complete + usable Ornith candidate 可直接執行。若 Ornith 非完整成功，而 deterministic candidate 為 incomplete but usable，系統 MAY 提供二階段 partial fallback confirmation，但第一次 response 必須是零 rows。

二階段確認 SHALL 使用短效 opaque `partial_fallback_id`，綁定原 `query_id`、exact normalized deterministic filters、`unresolved_terms`、query digest、Review Session、principal、model、artifact、`active_binding_revision` 與 expiry。只有同一 principal 在 binding 未變且 ID 未過期時另次明確確認，才 MAY 執行該 exact candidate；結果 SHALL 設 `degraded_to_deterministic=true`、`partial_execution_confirmed=true`、`complete=false`、`completion_scope=partial_table_only`，不得發 row proof，也不得啟用 Issue／3D 或 semantic/full completion。

**備註（決策原因）:** `usable=true` 只表示某些 filters 可安全執行，不表示已忠實表達完整 query。例如「找四樓的門且靠近逃生梯」若只執行 door/storey filters，會回傳不保證靠近逃生梯的 rows；即使 UI 顯示 degraded warning，rows 已可能被誤用於 Issue 或 3D 操作。預設零執行加二階段確認，讓使用者先看到 exact filters 與遺漏條件，再決定是否接受只供查表的 partial 結果，同時保留 Ornith unavailable 時有限但誠實的 deterministic utility。

#### Scenario: Auto 對完整 deterministic query 不呼叫 model

- **GIVEN** deterministic interpreter 對 `IfcDoor FireRating < 60` 產生 schema-valid、complete、usable filters
- **WHEN** query 以 `interpret_mode=auto` 執行
- **THEN** Ornith SHALL NOT 被呼叫
- **AND** `interpretation.source` SHALL 為 deterministic，`degraded_to_deterministic` SHALL 為 false

#### Scenario: Auto 在 deterministic interpretation 不完整時呼叫 Ornith

- **GIVEN** deterministic candidate 為 schema-valid 但 `complete=false`
- **WHEN** query 以 `interpret_mode=auto` 執行
- **THEN** governance-service SHALL 在 configured timeout 內呼叫 Ornith 一次
- **AND** 只有 validator 判定 schema-valid、complete、usable 的 Ornith filters 才可執行

#### Scenario: Partial deterministic parse 不得自稱完整或自動執行

- **WHEN** deterministic interpreter 把「找四樓的門且靠近逃生梯」解析為 door/storey filters，但不支援 proximity constraint
- **THEN** candidate SHALL 設 `usable=true`、`complete=false`
- **AND** `unresolved_terms` SHALL 指出 unsupported proximity intent
- **AND** 第一次 request SHALL NOT 呼叫 IFC scanner、不得回 rows 或 proof

#### Scenario: Schema-valid 但 incomplete 的 Ornith output 不執行

- **GIVEN** Ornith 回傳符合 JSON schema 且 `usable=true` 的 filters
- **AND** validator 發現至少一個 constraint-bearing segment 未被涵蓋，因此 `complete=false`
- **WHEN** query 以 `semantic` 或 `auto` 執行
- **THEN** governance-service SHALL NOT 呼叫 IFC scanner
- **AND** response SHALL 包含 `unresolved_terms` 與零 result rows
- **AND** SHALL NOT 發 evidence proof 或啟用 Issue／3D actions

#### Scenario: Unusable candidate 永不執行

- **WHEN** deterministic 或 Ornith candidate 為 schema-invalid、filters 為空、含 unsupported operator、互相矛盾或 `usable=false`
- **THEN** governance-service SHALL NOT 呼叫 IFC scanner
- **AND** response SHALL 是 structured interpretation error 且沒有 rows

#### Scenario: Explicit semantic failure 可見且可重試

- **WHEN** `interpret_mode=semantic` 遇到 timeout、HTTP error、invalid JSON、schema violation、empty content、incomplete/unusable 或 non-terminal/length-truncated output
- **THEN** system SHALL 回 structured retryable semantic error，包含 `query_id` 與 error code
- **AND** SHALL NOT 執行 deterministic fallback 或顯示 result rows
- **AND** UI SHALL 顯示 Retry 並保留 selected mode/query

#### Scenario: Auto timeout 需要二階段 partial fallback confirmation

- **GIVEN** deterministic candidate 為 `schema_valid=true`、`complete=false`、`usable=true`
- **AND** Ornith timeout 或回傳非完整成功
- **WHEN** 第一次 auto request 完成
- **THEN** response SHALL 為 `partial_fallback_confirmation_required` 且沒有 rows
- **AND** SHALL 顯示 exact deterministic filters、`unresolved_terms` 與短效 opaque `partial_fallback_id`
- **WHEN** 同一 principal 在 ID 未過期且 binding 未改變時另次明確確認
- **THEN** system MAY 執行該 exact deterministic candidate
- **AND** response SHALL 設 `degraded_to_deterministic=true`、`partial_execution_confirmed=true`、`complete=false`、`completion_scope=partial_table_only`
- **AND** SHALL NOT 發 evidence proof 或啟用 Issue／focus／highlight

### Requirement: A4 response SHALL 提供 structured trace 與 truthful counts

每次 execution attempt SHALL 取得 governance-service 產生的新 opaque `query_id`；retry MAY 攜帶 `retry_of_query_id`。成功或失敗 response SHALL 依 outcome 提供 selected mode、interpretation source、validated filters 或 structured error、degradation／partial-confirmation state、model invocation metadata、result rows 與 Evidence Trace。

當 Ornith 被呼叫時，`model_invocation` SHALL 包含 served model、latency、finish reason 與 sanitized error code，不得包含 raw completion 或 credential。Result statistics SHALL 包含 candidate `scanned`、`matched`、`not_matched`、returned-row `mapped`／`unmapped`、`returned` 與 `truncated`；`not_matched` SHALL 定義為 candidate-scope `scanned - matched`，不得當作 compliance result。`truncated=true` SHALL 表示 `returned` 之外仍有 matched rows。

Session-scoped full-flow response SHALL 包含 sanitized trusted `session_binding`，涵蓋 review session、authenticated principal ID 的 opaque reference、model version、primary artifact 與既有 `active_binding_revision`，但不得包含 host path 或 internal endpoint。每個 returned row SHALL 在可用時包含 real IFC identity/class/name/storey、predicate 使用的 actual values、per-predicate evidence、mapping status，以及只在 mapping provenance accepted 時提供 real `usd_prim_path`。只有 complete、non-partial row MAY 包含短效 opaque governance-signed `evidence_proof`，把 unique proof ID、`kid`、expiry 與 trusted review session/principal 綁到 complete immutable A4 snapshot 的 canonical hash。Fake/rejected mapping SHALL 被標示且不得 highlight；browser SHALL NOT mint／alter valid proof。Table-only 或 confirmed partial rows SHALL 省略 session-bound proof，並標 Issue／3D ineligible。

Proof signing SHALL 使用具有 active `kid` 的 dedicated server-only injected keyring；SHALL NOT 使用 committed/default key 或重用 Ornith API token。Normal rotation 時 previous verify-only key SHALL 保留至最後一張 proof expiry + clock skew；emergency revocation MAY 立即拒絕未 consumed proof。Missing/invalid signing config SHALL 對 proof issuance、A4 Issue eligibility 與 full completion fail closed，但 MAY 保留 honest table results。

`GET /api/governance/search/llm-status` SHALL 是 UI canonical model-readiness endpoint。Sanitized response SHALL 區分 configured、disabled、available 與 unavailable/unknown，並包含 `checked_at`、`check_source`、transport class 與 freshness/TTL metadata。`available`／`unavailable` 必須來自 TTL 內的 bounded probe 或 query observation；config-only 或 stale observation SHALL 為 `unknown`（explicit disabled 時為 `disabled`）。它 MAY 提供 configured model／timeout，但 SHALL NOT 提供 endpoint/base URL、credential、Authorization header、remote response body 或 raw probe。Configured model 不得當作 served model 證據；只有 per-query `model_invocation.served_model` 或 live-smoke observation 可證明。

**備註（決策原因）:** Structured fields 讓 contract tests 與 reviewers 可重播 row 為何 matched；raw model text 既不是 execution authority，也不是穩定 evidence，且可能含敏感文字。分開 `matched` 與 `returned` 可避免 result limit 隱藏 truncation；explicit candidate scope 也防止「未符合查詢」被誤讀成「違規」。

#### Scenario: 成功 response 不靠 raw model text 也可稽核

- **GIVEN** 一個 session-scoped full A4 flow
- **WHEN** A4 回 successful rows
- **THEN** response SHALL 包含 `query_id`、具有 `active_binding_revision` 的 sanitized `session_binding`、validated filters、interpretation/model metadata、truthful stats、row Evidence Trace 與 per-row opaque `evidence_proof`
- **AND** 只有 `truncated=false` 時 `matched` MAY 等於 `returned`
- **AND** response/log summary SHALL NOT 包含 Authorization header、token、raw model completion、endpoint、absolute host path 或 unredacted secret

#### Scenario: Mapping counts 與 truncation 保持誠實

- **GIVEN** matched results 同時有 mapped／unmapped rows，且超過 `limit`
- **WHEN** A4 回 limited page
- **THEN** `mapped + unmapped` SHALL 等於 `returned`
- **AND** `truncated` SHALL 為 true，且 `matched` SHALL 誠實表示完整 scanned candidate result count
- **AND** unmapped rows SHALL NOT 包含 invented prim paths

#### Scenario: LLM status 可用且 secret-safe

- **WHEN** canonical A4 UI 載入，且 model 為 configured、disabled 或 unreachable
- **THEN** UI SHALL 呼叫 coordinator `GET /api/governance/search/llm-status` 並 render 對應 sanitized readiness state
- **AND** `available`／`unavailable` SHALL 包含 fresh `checked_at`、non-config-only `check_source` 與 unexpired TTL；否則 UI SHALL render `unknown`
- **AND** status payload/UI SHALL NOT expose token、Authorization header、model base URL 或 raw probe response
- **AND** successful query/live smoke 前，configured model name SHALL NOT 標成 observed served model

### Requirement: Query trace SHALL 保持 transient，除非使用者確認 Issue

A4 v1 SHALL NOT 建立 persistent query-history table、analytics stream 或 saved-query record。`query_id` 與 optional retry correlation 只識別 request attempt。Current query/result/model metadata、unconsumed signed row proofs、`partial_fallback_id` 與 3D handoff intent MAY 只存在 active UI session 的 browser/coordinator/governance memory。Handoff SHALL 使用 opaque ID、在任一 proof 已過期時拒絕建立、設定 `expires_at = min(configured handoff TTL, every included proof expiry)`，依 bounded expiry/consumption policy purge trusted action/prim state，且 SHALL NOT 把 query/evidence 加入 durable session events。Invalid multi-row input SHALL 拒絕整組，不得 silent drop。只有 user-confirmed Issue MAY 依 governance Issue contract 持久化 selected A4 evidence snapshot 與 idempotency digests；unselected rows SHALL NOT 持久化。

**備註（決策原因）:** Query history 會立即引入 RBAC、retention、deletion 與 sensitive-project data policy，而這些都不是證明 v1 workflow 所必需。只在 reviewed Issue 上保存 snapshot，可在使用者有意建立紀錄時保留 durable evidence。

#### Scenario: Exploratory query 不建立 persistent history

- **WHEN** 使用者執行、retry、clear 或離開 A4，且未確認 Issue
- **THEN** governance-service SHALL NOT 建立 query-history database row 或 saved-query record
- **AND** query IDs MAY 隨 current UI/process state 消失

#### Scenario: Confirmed Issue 只保存 selected snapshot

- **WHEN** 使用者從 selected A4 result row 確認 Issue
- **THEN** Issue MAY 保存 `governance-issue-tracking` 所需的 query/filter/selected-evidence snapshot
- **AND** unselected rows 與 unrelated exploratory queries SHALL NOT 複製進 persistent history

#### Scenario: 3D handoff 過期也不形成 query history

- **WHEN** 使用者建立、consume、abandon 或讓 A4 3D handoff 過期，且未確認 Issue
- **THEN** coordinator SHALL 依 policy purge bounded handoff intent，且 SHALL NOT 由此建立 durable query/evidence/session-event record
- **AND** URL SHALL 只含 opaque handoff ID，不得含 query text、evidence snapshot、prim path 或 signed proof

### Requirement: Canonical A4 UI SHALL 可操作且接受誠實的 design gate

`#/workspace?dock=a4` SHALL 是 canonical production A4 surface，並 SHALL render 真實 session-scoped API flow。Legacy `#a4`、`#/a4` 與目前 `#semantic-search` SHALL 在保留 valid session context 下 redirect 到 canonical dock，或在 caller migration 後移除；它們 SHALL NOT mount 第二套 fixture/live implementation。

Canonical surface SHALL 提供 visible idle、source/session unavailable、loading、success、empty、uninterpreted、semantic error、partial-confirmation-required、confirmed partial、retrying、retry-failed、proof-expired-draft-preserved 與 3D-handoff creating/expired/rejected states。它 SHALL 顯示 validated filters、interpretation source、model/degradation status、Evidence Trace 與 mapped/unmapped/truncated counts。Fixed result counts、fabricated law citations 與 fake success states SHALL NOT 出現在 live flow。Console SHALL NOT host WebRTC/video 或送 DataChannel message；只能透過 coordinator-provided `/ui/open?session=` handoff URL 進入既有 session viewer。

因 truthful copy 與 live states 會實質改變核可的 `workspace.a4.default` screen，implementation SHALL 明確 re-approve/rebaseline，並通過 repo-pinned Windows Chromium DPR1 1440×900／1920×1080、pixel diff ≤1% 與 Playwright semantic 100% gates。Visual fidelity SHALL NOT 取代 API/runtime/model evidence。

**備註（決策原因）:** 兩個獨立 A4 pages 會形成兩套 product truth，並讓 fixture evidence 被誤認成 runtime evidence。保留 canonical approved route 可維持 information architecture；explicit rebaseline 則記錄從 compliance language 改為 neutral query-match semantics 的刻意修正，而不是把它藏成 visual drift。

#### Scenario: Canonical route 呈現 live states 而非 fixture counts

- **GIVEN** browser 具有 valid active Review Session
- **WHEN** operator 開啟 `#/workspace?dock=a4` 並執行 query
- **THEN** UI SHALL 呼叫 session-scoped A4 API，render returned `query_id`、filters、stats 與 evidence
- **AND** SHALL NOT render fixed `5 / 7`、fabricated citations 或 local-only success

#### Scenario: Legacy A4 routes 不得保留第二套 implementation

- **WHEN** operator 開啟 `#a4`、`#/a4` 或 `#semantic-search`
- **THEN** frontend SHALL 在保留 valid session context 下 redirect/converge 到 `#/workspace?dock=a4`；所有 callers migrate 後，retired route MAY unavailable
- **AND** legacy route SHALL NOT mount separate A4 state、fixture 或 API client behavior

#### Scenario: Empty 與 error states 提供 truthful recovery

- **WHEN** query 回 zero matches、無法 interpretation、失去 session binding 或收到 semantic/runtime error
- **THEN** UI SHALL render distinct state、cause 與 next action
- **AND** retryable states SHALL 提供保留 explicit user input 的 Retry action
- **AND** retry SHALL NOT silently change `interpret_mode` or filters

#### Scenario: Design fidelity 與 operability 維持獨立 gates

- **WHEN** A4 implementation 被提議為 complete
- **THEN** required viewport visual comparisons 與 semantic design cases 都 SHALL 對 re-approved baseline 通過
- **AND** real API/session/Ornith/Console-to-viewer handoff/DataChannel evidence SHALL 分開回報
- **AND** 一個 gate 通過 SHALL NOT 推論另一個 gate 通過

### Requirement: A4 3D handoff、focus 與 highlight SHALL 明確、可關聯且限 primary

Canonical A4 Console SHALL NOT host WebRTC/video、send DataChannel message，也不得假設 `console/unified/*` 已消費 legacy `mappingCache`。當 primary principal 點一個 mapped row 時，Console SHALL 以該 row signed proof 呼叫 `POST /api/review-sessions/:sessionId/a4-handoffs` 建立 `focus` action。Distinct explicit Highlight action SHALL 對 selected mapped rows 呼叫同一 route 並使用 `highlight`；search completion 或 row selection 本身 SHALL NOT 建立 highlight handoff。

Governance-service SHALL 驗每個 signed proof 的 signature/snapshot/model/mapping 與 accepted prim，但 SHALL NOT 被當作 current Kit stage authority。Coordinator SHALL 重新授權 current session、authenticated principal 與 active primary lease，resolve current primary artifact／`active_binding_revision`，並要求 requested set 的每個 proof 都未過期且綁定同一 session/principal/model/artifact/revision。任一 invalid／mismatched proof SHALL atomic reject 整個 focus/highlight handoff，不得 silent drop。Coordinator 只 SHALL 存 bounded transient trusted intent，設定 `expires_at = min(configured handoff TTL, every included proof expiry)`，並回 opaque `handoff_id`、expiry 與 `/ui/open?session=<sessionId>&a4_handoff=<opaque>` URL。URL SHALL NOT 含 query text、evidence snapshot、host/mapping/prim path 或 proof。Session viewer SHALL 經 consume route 取得 intent，對 expired/consumed/cross-session/cross-principal fail closed，並在每次 send 前比對 coordinator-bound model/artifact/revision 與 loaded stage。

Successful consume 且 DataChannel ready 後，viewer SHALL 對 focus handoff 只送一個 one-element `focusPrimRequest`，或對 explicit accepted set 只送一個 `highlightPrimsRequest`。每個 request SHALL 帶既有 protocol 的 unique `request_id`、active session/viewer identity 與 trusted real prim paths。Viewer UI SHALL correlate `focusPrimResult`／`highlightPrimsResult`，保存 handoff/connection/command pending 及 succeeded/rejected/timed-out evidence；explicit retry SHALL 產生新的 `request_id` 與 `retry_of_request_id`。Unmapped rows SHALL 以原因停用 handoff；truncated result SHALL NOT 暗示 unreturned matches 已被 highlight。

Spectator 在 Console 與 viewer SHALL 看到 `disabled` + `aria-disabled` 的 3D handoff/command controls 與原因；兩個 frontend 都 SHALL NOT 為 spectator 送 mutating A4 command。A4 full completion SHALL 依賴 shared runtime capability 已驗證 coordinator-issued primary lease authenticity 或等價 signed capability，不得只驗 `role==primary` 與 non-empty token shape。

A4 viewer 只 SHALL 消費 shared owner 已正式定義的 terminal result/rejection，並依 shared contract 顯示一致 outcome；本 change SHALL NOT 新增 `commandRejected` schema、Kit／`harness/fakeKit.ts` producer 或 dual-emission rollout。若 shared owner 尚未交付 authentic lease 與可關聯的可信 rejection，A4 MAY 保持 table/Issue partial capability，但 3D／Full completion SHALL 為 `no`。Full 3D completion SHALL 另有 observed handoff ID、first-frame、bound stage、DataChannel、command `request_id`、authentic lease/capability validation 與 real result/rejection evidence；mock echo 不計。

Initial send 與每次 retry 都是獨立 command attempt。每次 attempt 在 DataChannel send 前，coordinator SHALL 重新驗 authenticated principal、session active、同一 active primary lease、lease expiry/status、current primary artifact 與 `active_binding_revision`；viewer SHALL 再比對 loaded stage、`stage_match=true` 與 DataChannel readiness。任一 principal/lease/stage/binding 變動 SHALL zero-send fail closed；不得重用 cached frontend role 或前次 authorization result。若原 handoff／proof／lease 已過期、lease holder 更換或 binding 改變，系統 SHALL 要求新的 authorized handoff。

**備註（決策原因）:** Focus 是導覽單一構件，highlight 是改變共享視覺狀態；query 完成即自動 highlight 可能造成大量意外場景變更。Console 沒有真 WebRTC/video，Unified code 也未接 `mappingCache`，直接從 dock 發 DataChannel 會依賴不存在的接線並違反 `/ui/open?session=` 邊界。短效 opaque handoff 可保留 row-click focus 決策，又不建立 query history 或把 evidence 放進 URL。Runtime authorization 與 rejection 是 shared capability，A4 只消費正式契約，避免雙 owner；每次 retry 重新驗 current stage/lease，則避免 timeout 期間 stage 切換後重送 stale prim。

#### Scenario: Row click handoff 一個 focus 且不自動 highlight

- **GIVEN** primary principal 在 canonical Console 點一個 mapped A4 row
- **WHEN** coordinator/governance 驗 proof 並發 unexpired focus handoff
- **THEN** Console SHALL 經 returned `/ui/open?session=...&a4_handoff=...` URL navigate，且自身 SHALL NOT 送 DataChannel command
- **AND** authorized consume 與 readiness 後，viewer SHALL 以 unique `request_id` 對 trusted prim 只送並 correlate 一個 `focusPrimRequest`
- **AND** 使用者啟用 explicit Highlight control 前 SHALL NOT 送 `highlightPrimsRequest`

#### Scenario: Explicit highlight handoff 記錄 acknowledgement

- **GIVEN** primary principal 選 mapped rows 並在 Console 按 Highlight
- **WHEN** authorized viewer consume resulting highlight handoff，且 DataChannel ready
- **THEN** viewer SHALL 以 unique `request_id` 只送一個 `highlightPrimsRequest`，內容只含 handoff trusted real prim paths
- **AND** visible success SHALL 要求 matching `highlightPrimsResult`
- **AND** timeout/rejection SHALL 維持 visible，Retry SHALL 建 linked new `request_id`

#### Scenario: Multi-row handoff atomic 使用最早 proof expiry

- **GIVEN** selected mapped rows 的 proofs 有不同 expiry
- **WHEN** primary principal 請求一個 highlight handoff
- **THEN** 任一 proof 已 expired/mismatched 時 coordinator SHALL 拒絕 entire request
- **AND** 否則 SHALL 把 handoff expiry 設為 configured TTL 與所有 selected proof expiry 的最小值
- **AND** SHALL NOT silent omit invalid row 而只 highlight subset

#### Scenario: Invalid handoff 與 spectator actions 被阻擋

- **WHEN** row unmapped、current principal 是 spectator，或 handoff expired/consumed/cross-session/cross-principal/wrong-stage
- **THEN** Console/viewer SHALL 以 exact reason disable/reject action，且 SHALL NOT 送 mutating command
- **AND** forged spectator DataChannel request SHALL fail shared authentic lease/capability validation，並取得 shared owner 正式定義、可關聯的 terminal rejection
- **AND** shared authority 無法提供可信 rejection evidence 時 A4 3D/full completion SHALL 為 `no`
- **AND** invalid handoff recovery SHALL 要求 newly authorized handoff，不得使用 client-supplied prim 或 proof state

#### Scenario: Retry 前 stage 或 lease 改變時 zero-send

- **GIVEN** prior command timeout，且使用者按 Retry
- **WHEN** current `active_binding_revision`、loaded stage、authenticated principal 或 primary lease 任一已改變
- **THEN** coordinator/viewer SHALL 在 DataChannel send 前拒絕 retry
- **AND** SHALL 要求新的 authorized handoff，不得重用 stale prim/capability
- **WHEN** 全部 current state 仍相同
- **THEN** retry SHALL 使用新 `request_id` 與 `retry_of_request_id`，並只送一次

### Requirement: A4 Issue creation SHALL 要求 selection、editable draft 與 confirmation

A4 SHALL NOT 因 query match、search completion、selection、focus 或 highlight 而 side-effect create Issue／BCF。使用者 SHALL 選一個或多個 result rows、review editable draft（至少 title、description、severity、assignee），並在 persistence 前 explicit confirm。

Confirmation 時，UI SHALL 對每個 selected row 向 session-scoped coordinator A4 Issue route 送一個 independent atomic create request。Coordinator SHALL 重新授權 active session、authenticated principal 與 active primary lease，forward browser payload 無法 override 的 trusted context。每個 request SHALL 帶該 row 的 unexpired server-signed `evidence_proof`、model version、primary artifact、search-time active binding revision、real IFC GUID、optional accepted real prim path，以及 `governance-issue-tracking` 定義的 immutable structured A4 evidence snapshot。Governance-service SHALL 驗 trusted current session/principal、complete signed `snapshot_hash`、`proof_digest` 與 server-normalized `creation_request_hash`，再由 server 衍生 `source_type=a4_search`／`source_ref=query_id`。Creation SHALL 顯示 Issue ID(s) 與 per-row outcome，且 SHALL NOT auto-export BCF。

未 consumed proof 過期時，server SHALL 回 `a4_proof_expired`、`retryable=true`、`recovery=rerun_query`、`draft_preserved=true`；UI SHALL 只在 browser memory 保留 draft，重跑原 query/mode 後讓使用者重新核對 current row/binding，不得自動換 proof 或提交。已 consumed exact replay 則依 persisted digests 回原 Issue，不要求 rerun。

**備註（決策原因）:** match 只代表 query predicate 成立，不等於 defect。人工選取、編輯與確認保留 reviewer accountability；結構化 snapshot 比把 evidence 拼進 description 更可稽核，又不需要保存所有 exploratory queries。獨立單列 request 讓 partial failure 語意明確；signed proof 則防止任意 client 用自造 query/evidence 冒充 A4 provenance。

#### Scenario: 使用者確認 editable A4 Issue draft

- **GIVEN** 使用者選一個或多個 GUID-bound A4 rows
- **WHEN** 使用者編輯 draft 並 explicit confirm
- **THEN** UI SHALL 對每個 selected row 經 session-scoped coordinator route 送一個 independent single-row request 與 server-signed proof
- **AND** UI SHALL 顯示 returned Issue ID(s)，任一 row 失敗時顯示 honest partial failure

#### Scenario: Query match 永不自動建立 Issue 或 BCF

- **WHEN** search 回 matches，或使用者 focus/highlight/select rows 但未 confirmation
- **THEN** governance-service Issue count SHALL 維持不變
- **AND** SHALL NOT trigger BCF export

#### Scenario: Proof 過期時保留 draft 並要求重新核對

- **GIVEN** 使用者已編輯 A4 Issue draft，但 proof 在 confirmation 前過期且從未 consumed
- **WHEN** create request 到達 governance-service
- **THEN** server SHALL zero-write 回 `a4_proof_expired`、`retryable=true`、`recovery=rerun_query`、`draft_preserved=true`
- **AND** UI SHALL 保留 browser-memory draft、重跑原 query/mode 並要求重新核對 current row/binding
- **AND** SHALL NOT 自動以新 proof 提交或遺失使用者輸入

### Requirement: Semantic completion SHALL 要求 sanitized live Ornith evidence，CI 則維持 deterministic

CI SHALL 涵蓋 deterministic parser/executor 與 mocked Ornith contract cases，包括 valid JSON、schema violation、timeout、HTTP error、empty、incomplete/unusable、length-truncated/non-terminal、partial fallback confirmation 與 secret redaction。CI SHALL NOT 需要 live model endpoint 或 credential。

任何 live smoke 或 semantic/full completion claim 前，受影響的 A4/Ornith tracked sample configuration SHALL 只含 placeholders。曾 commit 或 otherwise exposed、且 owner 確認為實際 A4/Ornith credential 的值，在 rotation/revocation 前 SHALL 視為 potentially compromised；只刪除／redact working-tree value 不滿足 gate。Verification SHALL 只報 key/file names 與 status，永不報值；既有非 A4 development defaults 不構成本 requirement 的 credential cleanup。

要 claim semantic completion，implementation SHALL 另執行至少一次經 coordinator session-scoped route 的 live lab smoke，使用 governance-service 明確 server-side configuration（URL、model、profile、transport 與 injected credential）及 non-sensitive fixture/query。Sanitized evidence SHALL 記 timestamp、`query_id`、served model 必須正好為 `Ornith-1.0-35B`、interpretation source、latency、finish reason、structured filters、response status、config-source key names、transport class 與 secret-scan result。它 SHALL NOT 記 token、Authorization header、endpoint、absolute host path、raw completion 或 sensitive query text。

若 Ornith unavailable，deterministic mode MAY 維持 operational 並分開回報，但 `Semantic completion` 與 `Full completion claimed` SHALL 為 `no`。只有 `trusted_lab_http` evidence 時，lab semantic integration MAY 標 observed，但 production transport/security readiness 與 Full completion 仍 SHALL 為 `no`。

**備註（決策原因）:** mocks 可重現 error branches，但不能證明實際 endpoint、served model 與 response contract 相容；live smoke 提供這層證據，又不應讓每次 CI 依賴 LAN availability 或 secret。分開兩種 gate 可避免把模型停機誤報成 deterministic search 失敗，或把 mock pass 誤報成 live semantic pass。A4/Ornith 實際 credential 一旦進入 Git 可能仍存在於 history/clone，因此受影響 sample 改 placeholder 必須搭配 owner-side rotate/revoke；這個前置條件不等同於在 spec 或 log 公開值。

#### Scenario: CI 在沒有 token 時也驗證 model contract

- **WHEN** A4 CI suite 在沒有 Ornith credential/network 的 environment 執行
- **THEN** deterministic 與 mocked-model tests SHALL deterministic execute/pass/fail
- **AND** suite SHALL 驗證沒有 secret emitted
- **AND** CI SHALL NOT 因 live model absent 而 skip required contract assertions

#### Scenario: Live lab smoke 證明 served model 與 structured interpretation

- **GIVEN** authorized lab environment、active Review Session、non-sensitive fixture 與明確 LLM config
- **AND** affected A4/Ornith tracked samples 只含 placeholders，且先前 exposed actual credential 具 owner-confirmed rotation/revocation evidence
- **WHEN** semantic smoke 經 coordinator 執行
- **THEN** response SHALL 由 served model `Ornith-1.0-35B` 產生，且只有 validator 判定 complete + usable 的 schema-valid filters 才可驅動 deterministic search
- **AND** sanitized artifact SHALL 包含全部 required model/query trace fields、config-source key names、transport class 並通過 secret scan
- **AND** raw token/request/completion SHALL NOT 被提交

#### Scenario: Credential hygiene 在不暴露值下阻擋 semantic completion

- **WHEN** affected A4/Ornith tracked configuration 含 owner-confirmed actual credential assignment，或 owner-side rotation/revocation 未確認
- **THEN** semantic live smoke/full completion SHALL 被阻擋
- **AND** report SHALL 只列 affected key/file 與 remediation status，SHALL NOT echo credential
- **AND** tracked value 改 placeholder 本身 SHALL NOT 被回報為 rotation complete

#### Scenario: Model unavailable 只阻擋 semantic/full completion claim

- **WHEN** live Ornith smoke 因 endpoint、credential、timeout 或 contract failure 無法完成
- **THEN** report SHALL 以 concrete error class 標 semantic gate failed/blocked
- **AND** deterministic results MAY 以 honest label 維持 available
- **AND** `Full completion claimed` SHALL 為 `no`
