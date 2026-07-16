## ADDED Requirements

### Requirement: 使用者確認的 A4 Issue SHALL 保存 structured search provenance，但不建立 query history

`governance-service` SHALL 提供 A4-specific Issue creation contract；每個 request 只處理一個 user-confirmed A4 row/draft，browser 只能經 session-scoped coordinator route（例如 `POST /api/governance/issues/from-a4-search/for-session/:sessionId`；internal governance path MAY 為 `POST /api/issues/from-a4-search`）到達。Coordinator SHALL 先由 `UserAuthProvider` 取得 server-authenticated principal，再重新授權 active Review Session 與 active primary lease，forward browser payload 無法 override 的 trusted session/principal context。Multi-row UI confirmation SHALL 使用 independent requests，使每筆 Issue create atomic 且 cross-request partial outcomes 明確。Server 只有在 trusted current context 與 row 的短效 opaque governance-signed `evidence_proof` 相符後，才 SHALL 設 `source_type=a4_search` 與 `source_ref=<query_id>`；caller-provided source label、actor/session fields、headers 或 schema-shaped evidence 都不得建立 A4 provenance。

每個 A4 Issue SHALL 綁定 real `ifc_guid`，並持久化 `model_version_id`、`primary_artifact_id`、search-time `active_binding_revision`、optional accepted real `usd_prim_path` 與 immutable structured `a4_evidence_snapshot`。Snapshot SHALL 至少包含：

- `schema_version`
- `query_id`
- confirmed query 文字
- validated `interpreted_filters`
- `interpret_source`、`degraded_to_deterministic` 與 unresolved terms
- search 所觀察到的 trusted primary artifact 與 active binding revision
- selected-row IFC identity、actual matched property values 與 predicate evidence
- mapping status，以及只有 mapping provenance accepted 時才保存的 real prim path

系統 SHALL 明確區分三個 digest：

- `snapshot_hash`：complete immutable A4 evidence snapshot 的 canonical hash，包含 model version、primary artifact、active binding revision、query ID/text、normalized filters、interpretation source、degradation state、unresolved terms、selected-row actual values/predicate evidence、mapping status 與 accepted prim path。
- `proof_digest`：exact signed proof envelope/token bytes 的 SHA-256，用來識別是否為完全相同 proof。
- `creation_request_hash`：server-normalized canonical Issue create payload 的 SHA-256，包含初始 title、description、severity、assignee、IFC GUID、accepted prim、model/artifact/revision、`snapshot_hash` 與 `proof_digest`。

Signed proof SHALL 把 unique proof ID、`kid`、expiry、verified Review Session 與 authenticated principal 綁到 `snapshot_hash`。Editable Issue fields 明確排除於 `snapshot_hash`，但納入 immutable initial `creation_request_hash`。首次 consume 時 governance-service SHALL 驗 signature／`kid`、trusted current session/principal、expiry 與 exact snapshot binding，並在同一 transaction 寫入 Issue、snapshot、proof ID、`proof_digest` 與 `creation_request_hash`；proof ID SHALL 有 uniqueness constraint。它 SHALL NOT 保存 unselected row proof 或 query-history record。

Proof signing SHALL 使用 dedicated server-only injected keyring 與唯一 active signing `kid`；SHALL NOT 使用 committed/default key 或重用 Ornith API token。正常 rotation 時 previous key SHALL verify-only 保留到該 key 最後簽發 proof 的 expiry 加 clock skew；emergency revocation MAY 立即拒絕未 consumed proof 並回 `proof_key_revoked`。Missing/invalid signing config SHALL 對 proof issuance、A4 Issue eligibility 與 full completion fail closed。

未 consumed 的 expired proof SHALL 被拒絕並回 `a4_proof_expired`、`retryable=true`、`recovery=rerun_query`、`draft_preserved=true`。若 proof ID 已 consumed，系統 SHALL 先重新授權 current session/principal，再 lookup proof ID，並 constant-time 比對 `proof_digest`、`snapshot_hash` 與 `creation_request_hash`；三者完全相同時，即使 proof 已過期或原 signing key 已退休也 SHALL 回 existing Issue ID。任一不符 SHALL 回 409 且不得改寫原 Issue。Unauthorized replay SHALL 先回 403，不得形成 proof-existence oracle。

Issue title、description、severity、assignee MAY 在 confirmation 前編輯；creation 後 normal Issue state transitions MAY 改 lifecycle fields，但 SHALL NOT 修改 source type/reference、evidence snapshot 或 immutable initial `creation_request_hash`。Normal `created` audit event SHALL 記 A4 source/query correlation。這些 storage 只屬 confirmed Issue record，不得建立 standalone query-history record。`source_ref=query_id` 只是 correlation，同一 query 的不同 row proof SHALL 可各自建立 Issue；A4 idempotency 以 unique proof ID 為準，不得沿用只按 `(source_type, source_ref)` 去重的 generic path。

**備註（決策原因）:** 現有 A4 把 query/evidence 拼成自由文字且單筆 API 固定 `source_type=manual`，日後無法可靠判斷 Issue 是哪次 search、哪些 filters 與實值所產生。`a4_search` 仍代表「使用者手動確認的 A4 來源」，不是自動 Issue；它只改善 provenance。把 immutable snapshot 掛在 Issue 上，能保存已採取行動的證據，同時遵守 v1 不保存所有 exploratory query history 的決策。僅驗 payload schema 仍可被任意 client 自造；完整 snapshot hash + trusted current session/actor + 專用 rotating keyring 才能提供 server authenticity，而只在 confirmed Issue 儲存 proof ID/hash 不會變成 query-history DB。單列 atomic request 則讓 multi-select partial failure 不與 batch all-or-nothing 混淆。

#### Scenario: Confirmed A4 Issue 保存 immutable provenance 與 audit

- **GIVEN** 使用者確認一個 GUID-bound A4 draft，具有 complete schema-valid evidence snapshot、signed model/primary-artifact/active-binding-revision context 與 unexpired server-signed row proof
- **AND** coordinator 重新授權 proof 所綁定的同一 active Review Session、authenticated principal 與 active primary lease
- **WHEN** browser 經 coordinator governance proxy 提交
- **THEN** governance-service SHALL 建立 `source_type=a4_search` 且 `source_ref` 等於 A4 `query_id` 的 Issue
- **AND** SHALL atomic 保存 structured snapshot、unique proof ID、`proof_digest`、`snapshot_hash`、`creation_request_hash`，並寫辨識 A4 source/query 的 `created` audit event
- **AND** response SHALL 回 Issue ID 與 stored provenance，不得含 credential 或 absolute host path

#### Scenario: Lifecycle transitions 不得改寫 A4 evidence

- **GIVEN** 既有 `source_type=a4_search` Issue
- **WHEN** assignee 或 status 經 normal Issue lifecycle 改變
- **THEN** transition SHALL 遵守 existing controlled state machine 與 audit rules
- **AND** `source_type`、`source_ref` 與 `a4_evidence_snapshot` SHALL 維持不變

#### Scenario: Invalid 或 incomplete A4 provenance 被 atomic reject

- **WHEN** A4 Issue creation 缺 `query_id`、real `ifc_guid`、model/artifact/revision context、schema-valid filters、selected-row evidence、valid signed proof，或 prim path 的 mapping status 未 accepted
- **THEN** governance-service SHALL 以 structured 4xx validation evidence 拒絕 affected create request
- **AND** SHALL NOT 建 partial Issue 或 orphan snapshot
- **AND** SHALL NOT silent downgrade 成 `source_type=manual`

#### Scenario: Forged、expired、stolen 或 cross-boundary proof 被拒絕

- **WHEN** caller 提交 forged/unconsumed-expired proof、從不同 current session/principal 提交 unchanged proof，或修改任一 signed snapshot field
- **THEN** governance-service SHALL 以 structured 4xx authenticity/expiry error 拒絕
- **AND** SHALL NOT 建 Issue、保存 snapshot 或指派 `source_type=a4_search`

#### Scenario: Exact replay 保持 idempotent，conflicting replay 被拒絕

- **GIVEN** A4 Issue 已以 unique signed proof ID 建立
- **WHEN** lost response 後，同一 authorized session/principal 在 proof expiry 前或後重送 exact same confirmed payload/proof
- **THEN** governance-service SHALL constant-time 驗三個 digest，回 existing Issue ID 與 replay status，且 SHALL NOT 建 duplicate
- **WHEN** 同一 proof ID 帶 altered draft/evidence、不同 proof bytes/signature 或不同 normalized request
- **THEN** governance-service SHALL 回 409 並保留 original Issue/snapshot

#### Scenario: Missing 或 invalid signing key 時 fail closed

- **WHEN** 沒有 configured dedicated active signing key、key material invalid，或 implementation 嘗試使用 committed/default/Ornith API key
- **THEN** governance-service SHALL NOT 發 valid A4 proof 或建立 `source_type=a4_search` Issue
- **AND** UI SHALL 標 Issue eligibility/full completion blocked，且不得暴露 key material

#### Scenario: Key rotation 遵守 kid、proof expiry 與 clock skew

- **GIVEN** proof 由 previous `kid` 簽發且仍未超過該 key 最後一張 proof expiry 加 clock skew
- **WHEN** rotation 把該 key 設為 verify-only
- **THEN** governance-service MAY 驗 proof，但 SHALL NOT 用 previous key 簽新 proof
- **AND** retention boundary 後 previous key SHALL 從 verification 移除；emergency revoked proof 則要求 rerun

#### Scenario: Generic manual 與既有 sourced Issues 維持 backward-compatible

- **WHEN** existing clients 建立 generic manual Issues，或使用 from-rule-run/from-diff flows
- **THEN** 現有 `manual`、`rule_result`、`diff_item` source semantics 與 state machine SHALL 保持不變
- **AND** 沒有 `a4_evidence_snapshot` 的舊 Issue rows SHALL 仍可讀
- **AND** 不得以 backfill 為 historical rows fabricated A4 provenance

#### Scenario: 未 consumed proof 過期時保留 browser draft

- **GIVEN** 使用者已編輯 title／description／severity／assignee，但 proof 在首次 consume 前過期
- **WHEN** A4 Issue create request 到達 governance-service
- **THEN** server SHALL zero-write 回 `a4_proof_expired`、`retryable=true`、`recovery=rerun_query`、`draft_preserved=true`
- **AND** UI SHALL 只在 browser memory 保留 draft，重跑原 query/mode 後要求使用者重新確認 current row/binding
- **AND** SHALL NOT 自動換 proof、建立 partial DB row 或遺失輸入

#### Scenario: 同一 query 的不同 rows 可建立不同 Issues

- **GIVEN** 同一 `query_id` 的兩個不同 matched rows 各有 unique proof ID
- **WHEN** 使用者分別確認兩個 drafts
- **THEN** governance-service SHALL 以 proof ID 分別建立兩個 Issues
- **AND** SHALL NOT 因 `source_type=a4_search` 與相同 `source_ref=query_id` 而把第二筆誤判為 duplicate

#### Scenario: A4 Issue persistence 不建立 query history

- **WHEN** query 的一個 selected row 被確認為 Issue
- **THEN** 只有該 Issue 的 evidence snapshot 與三個 idempotency digests SHALL 被持久化
- **AND** governance-service SHALL NOT 保存 unselected rows、其他 queries、raw model completion 或 separate query-history row
