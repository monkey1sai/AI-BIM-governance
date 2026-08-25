## MODIFIED Requirements

### Requirement: iframe 進場 URL SHALL 使用固定參數集且不承載 secret

EmbeddedViewer SHALL以 `{viewerOrigin base}/?{params}` 直連viewer origin（非經 `/ui/open`；凍結面照舊併存供外開）。URL參數集封閉為 `session`（必填）、`coordinatorApiBase?`、`coordinatorSocketUrl?`、`streamRole?`、`kitInstanceId?`、`userId?`、`displayName?`、`sourceClientId?`；其中 `userId` 只可作opaque display/correlation hint，MUST NOT被viewer當成authentication carrier。

`viewer_lease_token`與local-dev／future production user auth token皆為bearer secret，MUST NOT出現在URL query、history、referrer或log。兩者 SHALL只在 `viewer_ready` 後經受限targetOrigin、驗證source/origin的既有 `viewer_lease_token {token, user_token?}` postMessage交付；viewer只可ephemeral保存並用於coordinator header，不得寫入UI、structured log或artifact。`viewerOrigin` SHALL取自 `runtimeStatus().configured_endpoints.viewer.browser_url_base`（可含路徑前綴）；origin比對與postMessage targetOrigin SHALL使用normalize後的純origin。

#### Scenario: lease token 不落 URL

- **WHEN** console掛載EmbeddedViewer且已持有viewer lease與lab user carrier
- **THEN** iframe src SHALL不含任一token；兩者 SHALL於 `viewer_ready` 握手後以受限 `viewer_lease_token {token, user_token}` postMessage交付
- **AND** iframe URL的opaque `userId` SHALL NOT被重用為 `X-User-Token`

### Requirement: vg01 postMessage 訊息目錄 SHALL 封閉且雙向驗 origin

雙向訊息 SHALL一律帶 `protocol:"vg01"`；未知type SHALL忽略（前向相容）。接收端 SHALL同時驗證 `e.origin`（normalize後精確比對）與 `e.source`（iframe contentWindow）；targetOrigin MUST NOT為 `"*"`。

**console→viewer**：`viewer_lease_token {token, user_token?}`、`highlight {items[] {ifc_guid, severity?, label?, rule_code?}}`（逐筆replace語意，每item一request一ack）、`highlight_batch {items[]}`（聯集裝進單一highlightPrimsRequest、回單一帶計數ack）、`focus {ifc_guid}`、`clear {}`。

**viewer→console**：`viewer_ready`、`first_frame {stageUrl}`、`stage_loaded {stageUrl?, status:"active"|"unproven", binding_revision_id?}`、`highlight_result {requestId, ok, reason?:"unmapped"|"datachannel_not_ready", sent_count?, unmapped_count?, unmapped_guids?[]}`（批次ack才帶計數欄）、`selected_guid {ifcGuid|null}`。

`highlight`與`highlight_batch`語意 MUST NOT混用；viewer端mapping解不出prim的GUID SHALL誠實計入 `unmapped_*` 回報。Parent SHALL只在 `stage_loaded.status=="active"` 時保存loaded stage並允許A4 handoff；收到 `unproven` 或缺少proof status時 SHALL清除loaded stage、維持handoff blocked並要求authenticated resync。

#### Scenario: 跨 origin 訊息被拒收

- **WHEN** 非viewerOrigin的來源對console發出vg01形狀訊息
- **THEN** console SHALL拒收（origin或source比對失敗），不觸發callback或保存任何token

#### Scenario: 批次高亮誠實計數

- **WHEN** console送 `highlight_batch` 含10個GUID而viewer mapping只解出7個
- **THEN** viewer SHALL送單一 `highlightPrimsRequest`（7筆）並回 `highlight_result {sent_count:7, unmapped_count:3, unmapped_guids:[...3]}`

#### Scenario: unproven stage傳到parent並阻擋handoff

- **WHEN** viewer收到 `commandRejected {runtime_state:"changed_unconfirmed"}` 或authenticated resync仍未證實active revision
- **THEN** viewer SHALL送 `stage_loaded {status:"unproven", binding_revision_id}`，且parent SHALL清除任何先前loadedStageUrl並阻擋A4 handoff
- **AND** 只有後續authenticated status證實同revision active後，viewer才 MAY送 `status:"active"`

## ADDED Requirements

### Requirement: trusted viewer lease晚到 SHALL只恢復一次既有deferred stage open

Embedded viewer第一次auto-open因primary `viewer_lease_token`尚未由受限targetOrigin的vg01 postMessage送達而被中央mutator gate攔下時，後續收到trusted non-empty token SHALL只重排既有deferred-open scheduler，不得建立第二套open path。重排只可在embedded mode、selected asset仍可開啟、stage尚未 `matched`且中央 `_canOpenSelectedAsset()` gate通過時發生；scheduler SHALL先取代舊timer，且 SHALL NOT修改target stage、直接呼叫DataChannel send或繞過runtime authority。

#### Scenario: late token解除permanent stall

- **GIVEN** embedded viewer已有stream與selected stage，但第一次auto-open因缺lease token被擋
- **WHEN** trusted parent稍後以合法origin/source送入non-empty `viewer_lease_token`
- **THEN** viewer SHALL重排既有deferred open，ready後只送一次有correlation與authority envelope的 `openStageRequest`
- **AND** stage成功matched後，相同或重複token message SHALL NOT再次開啟stage

#### Scenario: late token不繞過中央gate

- **WHEN** selected asset已不可開啟、stage已matched或viewer不是embedded mode
- **THEN** trusted token到達 SHALL NOT直接send、改target或排入新的open timer
