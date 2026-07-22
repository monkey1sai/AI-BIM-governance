## MODIFIED Requirements

### Requirement: DataChannel 訊息 SHALL 全部具名並有 schema 定義

console↔Kit 的 DataChannel 訊息 SHALL 固定為 envelope `{event_type: string, payload: object}`，且每個訊息 SHALL 依 tracked `kit-datachannel-v1.schema.json` 定義欄位並由 contract test 驗證。訊息目錄封閉如下；新增訊息 SHALL 走 change 提案，MUST NOT 靜默擴充。

每個送達 production Kit 的 well-formed runtime mutator SHALL 帶 unique `request_id`。Stage mutator 的 browser payload MAY保留既有 URL 顯示欄位，但其 authority SHALL只來自 coordinator-issued transaction與exact canonical composition。

**OUT（console→Kit；★=runtime mutator）**

| event_type | payload 要點 |
|---|---|
| ★ openStageRequest | `request_id`、`stage_binding_authorization_id`、`binding_revision_id`、`stage_composition {primary, secondary_layers[]}`；`url`／`requested_stage_url`僅供顯示與相容，不構成authority |
| loadingStateQuery | `{}` |
| getChildrenRequest | `prim_path`（預設 `/World`）、`filters:["USDGeom"]` |
| ★ highlightPrimsRequest | `request_id`、`mode:"replace"`、`items[] {prim_path, ifc_guid?, color?, label?, source?, issue_id?, mapping_method?, mapping_confidence?}`、`focus_first` |
| ★ focusPrimRequest | `request_id`、`prim_path` |
| ★ clearHighlightRequest | `request_id` |
| ★ selectPrimsRequest | `request_id`、`paths[]`（空陣列=清空選取） |
| ★ composeStageRequest | `request_id`、`binding_revision_id`、`artifacts[]`（harness-only；production拒絕） |
| ★ loadArtifactGroupRequest | `request_id`、`stage_binding_authorization_id`、`binding_revision_id`、exact `stage_composition` |
| ★ makePrimsPickable | `request_id`、`paths[]` |
| ★ resetStage | `request_id` |

**IN（Kit→console）**

| event_type | payload 要點 |
|---|---|
| openedStageResult | `result:"success"|"error"`、`request_id?`、`url`、`error?`、`binding_revision_id?`；transaction path的success只可在coordinator confirmation後送出；exact composition部分套用的error另帶`runtime_state:"changed_failed"`、`partial_load:true`與`failed_bindings[]` |
| loadingStateResponse | `url`、`loading_state:"idle"|"busy"` |
| getChildrenResponse | `prim_path`、`children[] {name, path, children?}` |
| highlightPrimsResult | `result`、`request_id`、`selected_paths[]`、`missing_paths[]`、`fallback_paths[]` |
| focusPrimResult | `result`、`request_id`、`prim_path?`、`fallback_path?` |
| selectPrimsResult | `result`、`error`、`selected_paths[]`、`request_id` |
| makePrimsPickableResponse | `result`、`error`、`request_id` |
| resetStageResponse | `result`、`error`、`request_id` |
| clearHighlightResult | `result`、`applied_mode:"selection"`、`request_id` |
| stageSelectionChanged | `prims[]`（USD prim path 字串） |
| updateProgressAmount | 進度數值（Kit 內建） |
| updateProgressActivity | `text`（`"None"`=載入活動結束） |
| bindingApplied | `binding_revision_id`（legacy observation；不得取代coordinator active confirmation） |
| loadArtifactGroupResult | `result`、`request_id`、`binding_revision_id?`、`error?`；`accepted`為non-terminal |
| commandRejected | 見下方獨立 Requirement |

#### Scenario: 未知訊息前向相容

- **WHEN** console 收到目錄外的 `event_type`
- **THEN** console SHALL 忽略該訊息（不 crash、不誤路由）
- **AND** SHALL 記入觀測 log 供診斷

#### Scenario: well-formed mutator必須可關聯

- **WHEN** viewer送出任一allowlisted runtime mutator
- **THEN** payload SHALL帶該attempt的unique `request_id`
- **AND** command-specific success或唯一rejection SHALL回同一ID；缺ID的direct malformed call只能用server-generated `rejection_id`作diagnostic

### Requirement: runtime mutator SHALL 攜帶 runtime authority envelope

`runtimeMutatingEvents` 集合（`openStageRequest`、`loadArtifactGroupRequest`、`composeStageRequest`、`highlightPrimsRequest`、`focusPrimRequest`、`clearHighlightRequest`、`selectPrimsRequest`、`makePrimsPickable`、`resetStage`）的 payload SHALL 由送出端統一注入 `request_id`、`role:"primary"|"spectator"`、`source_client_id`、`viewer_lease_token?`（有 lease 才帶）與 `session_id?`。前端 SHALL 於送出前套 spectator view-only、session lifecycle、primary lease 三道 UX gate，並於攔下時誠實記事件；frontend gate SHALL NOT被視為安全邊界。

Production Kit SHALL在任何 USD、selection、highlight、pickability或stage state mutation前，即時向 coordinator internal authority驗證 exact session、source client、current primary lease、expiry、lifecycle、requested event與必要 command context，且 SHALL NOT使用positive authorization cache。`openStageRequest`與`loadArtifactGroupRequest` SHALL另帶 coordinator-issued `stage_binding_authorization_id`、`binding_revision_id`與exact canonical composition；valid lease、browser URL或payload bypass marker SHALL NOT取代stage transaction。Readonly query與video SHALL不受authority outage阻擋。

#### Scenario: spectator 送 mutator 被前端或Kit攔下

- **WHEN** spectator模式觸發 `highlightPrimsRequest`，或繞過frontend直接送入Kit
- **THEN** frontend SHALL不送出並記錄原因，或Kit SHALL在zero mutation下回唯一 `commandRejected {reason:"spectator_readonly", runtime_state:"unchanged"}`

#### Scenario: stage URL不能取代server transaction

- **WHEN** primary有valid lease但以browser URL送出缺transaction或tampered composition的stage mutator
- **THEN** Kit SHALL在stage mutation前拒絕，且active/last-good binding SHALL維持不變

### Requirement: commandRejected SHALL 為權威拒絕的唯一回饋訊息

Kit/streaming拒絕一個well-formed runtime mutator attempt時 SHALL只回一個terminal event，且 SHALL NOT dual-emit command-specific unauthorized result：

```json
{
  "event_type": "commandRejected",
  "payload": {
    "rejected_event_type": "<被拒的 OUT event_type>",
    "reason": "spectator_readonly | lease_invalid | session_lifecycle_blocked | unauthorized_source_client | unsupported_command | invalid_payload",
    "request_id": "<原請求的 request_id>",
    "rejection_id": "<僅缺request_id的malformed direct call使用>",
    "session_id": "<可判定時的safe correlation>",
    "retryable": false,
    "runtime_state": "unchanged | changed_unconfirmed",
    "detail_code": "<machine-safe detail，選填>",
    "detail": "<人可讀補充，選填且不含secret>"
  }
}
```

`reason`與`runtime_state` SHALL為封閉列舉。Pre-mutation denial與transport outage SHALL使用 `runtime_state:"unchanged"`。Authority timeout/network/redirect/non-JSON/non-2xx/malformed response SHALL使用 `reason:"lease_invalid"`、`retryable:true`、`detail_code:"authority_unavailable"`；真正 forged/released/expired lease SHALL `retryable:false`。只有runtime已觀察stage成功、但coordinator completion未被證實時 MAY使用 `changed_unconfirmed`。

`viewer_lease_token`、user credential、internal token、Authorization header、raw upstream response SHALL NOT出現在payload/log。Console與viewer origin收到 rejection後 SHALL顯示persistent、可存取的terminal回饋；`changed_unconfirmed` SHALL標記stage unproven並阻擋盲retry/A4 handoff直到authenticated status resync。FakeKit SHALL支援deterministic one-shot同形回放，且production build SHALL NOT只因query參數啟用harness。

#### Scenario: lease失效與authority outage可區分

- **WHEN** forged/released/expired lease被coordinator正常拒絕
- **THEN** Kit SHALL回HTTP-200 decision映射出的 `commandRejected {reason:"lease_invalid", retryable:false, runtime_state:"unchanged"}`
- **AND** coordinator不可達時 SHALL改回 `retryable:true, detail_code:"authority_unavailable"`，兩者不得混淆

#### Scenario: runtime已變但confirmation未證實

- **WHEN** Kit已觀察stage成功，但completion timeout、transport失敗或正常deny
- **THEN** Kit SHALL只回一個correlated `commandRejected {runtime_state:"changed_unconfirmed"}`
- **AND** viewer SHALL維持unproven阻擋，直到authenticated status證實同revision active
