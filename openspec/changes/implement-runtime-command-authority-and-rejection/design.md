## Context

Browser 中央 `_sendStreamMessage` 是必要 UX gate，但不是安全邊界；直接向 DataChannel 送入 `role:"primary"` 與任意非空 token 仍會通過 Kit 現行 `is_authorized_mutator`。Coordinator 已擁有 Review Session lifecycle、viewer lease token／expiry／role 與 primary holder，卻沒有 Kit 可呼叫的 narrow verification contract。

相鄰缺口包括：`ViewerLeaseStore.findReplay` 未比較 principal；claim conflict/status 會回其他 holder detail；stage-binding 只驗 primary artifact 且在 Kit terminal success 前記 active；embedded viewer 第一次 open 缺 lease 時清掉 pending，晚到 token 不會重排。這些缺口會使 A4 無法證明 current principal、active primary lease、observed stage 與 command terminal outcome 的同一性。

本 change 的控制流如下：

```text
browser UX gate + request_id
  -> Kit DataChannel mutator
     -> local payload/catalog validation
     -> coordinator internal authorize (session + current lease + event context)
     -> mutate only when authorized
     -> command-specific success OR exactly one commandRejected
     -> viewer-local visible aria-live state

stage-binding public preauthorization
  -> coordinator resolves full ordered artifact tuple and creates opaque pending id
  -> Kit authorizes exact pending tuple and atomically claims pending -> executing
  -> loadArtifactGroupResult:accepted (non-terminal)
  -> observed openedStageResult:success
  -> coordinator internal confirmation/audit
  -> active + openedStageResult:success (terminal)
  -> or failed / changed_unconfirmed (terminal truth preserved)
```

Persistent product metadata不新增。Coordinator 保存 process-local lease、bounded pending/executing/completed binding transaction與 active/last-good binding；Kit 保存 runtime state與每 attempt immutable correlation；viewer/FakeKit 只保存 display/test state。Raw user credential、lease/internal tokens 不進 principal/public response/audit/event/structured log/artifact。

## Goals / Non-Goals

**Goals：**

- 每個 production mutator 在任何 state mutation 前，由 coordinator 即時驗證 exact session、source client、active unexpired primary lease、status、lifecycle 與 event context。
- 對每個 attempt 提供唯一、可關聯、secret-safe terminal outcome；authority outage、真正 invalid lease與 runtime changed-but-unconfirmed 可由 machine fields 區分。
- Viewer lease claim/replay 使用 server principal，且不把其他 principal 的 lease detail回給 caller。
- Stage binding 以完整 server-resolved composition進行 pending -> Kit-confirmed active 交易。
- Late embedded lease 能恢復一次 deferred open，不重送 matched stage。
- 保持 service ownership、browser route、DataChannel transport與既有 success event type。

**Non-Goals：**

- 不實作或猜測公司雲端 OIDC issuer/audience/JWKS/subject。
- 不回寫 archived `viewer-redesign` source、不擴充 embedded vg01 catalog；本 change以 canonical delta spec承接現行 producer wire修改。
- 不新增 generic `/operations`、coordinator viewport control、success authorization cache或跨 restart durability。
- 不直接編輯手寫 design canon、manifest、visual baseline或 `support.js`。

## Decisions

### 1. Capability ownership維持單一，producer wire delta直接 reconcile canonical specs

`origin/main` 的 `99cd722` 已 archive `viewer-redesign`，其 `kit-datachannel-protocol`／`embedded-viewer-bridge`／`viewer-viewport` 已成 canonical capability；`viewer-runtime-command-bridge` 仍負責「何時可 mutate、誰是 runtime policy authority、何時 stage binding 可視為 active」。本 change 因此同時修改四個 capability：runtime bridge 定義authority transaction，protocol定義producer wire fields，embedded bridge在既有message type內安全傳遞ephemeral lab auth與active/unproven狀態，viewport定義generic conflict與可見阻擋。vg01 event type catalog不擴充，archive source不回寫，producer仍只有現有Kit DataChannel。更新後的可執行JSON schema落在`tests/contracts/kit-datachannel-v1.schema.json`與`tests/contracts/vg01-postmessage-v1.schema.json`，取代把archive內草案當live contract的做法。四份delta、schema、實作與contract test必須同一PR原子對齊。

### 2. Claim先驗 server principal，local-dev只算 lab seam

Viewer lease claim在 session lookup、body identity與 conflict判斷之前呼叫既有 `UserAuthProvider`。實際 `ViewerLeaseStore.claim.user_id` 只使用 provider `userId`；legacy body `user_id` 若存在且不一致，回 403且 zero claim/audit。

兩個既有 caller同步帶 `X-User-Token`。在 `local-dev` provider下，其值只允許是明示lab identity carrier；不得稱為authentication strength，且header/body仍一律按sensitive處理。Standalone viewer從其local review env取ephemeral carrier；embedded console保留identityRef raw carrier，但不得放iframe URL，而是在既有受限 `viewer_lease_token` postMessage payload內additive傳 `user_token?`，viewer只ephemeral保存供coordinator header使用。URL `userId`維持opaque display/correlation hint，不得當credential。Coordinator不得把provider回傳的raw carrier當principal保存，而是以domain-separated SHA-256產生固定長度opaque `lab_...` subject；legacy body identity也先做同一normalization後再比較。Raw carrier bytes不得進lease、public response、audit、event、structured log或UI，並以動態sentinel測試而非只靠tracked secret scan驗證。未來bound OIDC只採stable subject claim，不保存bearer bytes。

當 `NODE_ENV=production` 且 provider結果仍為 `sso_binding=pending_oq5`，claim、stage-binding與其他 user mutation route只回 `503 production_identity_unavailable`；coordinator readonly/control-plane route維持服務，避免整個 process因未決 IdP 無法啟動。

Idempotent replay比較 session、viewer、nonce、requested role與principal。不同 principal不得取得舊 lease/token；primary conflict只回 generic `primary_already_claimed`，不附 `primary_lease`。Lease status route同樣先 authenticate，只回 caller自己的 leases與不含 holder identity的 availability摘要。

### 3. Coordinator提供 narrow internal runtime authorization

沿用既有 `/api/internal` middleware與 `X-Internal-Token`：

```text
POST /api/internal/review-sessions/:sessionId/runtime-command-authorizations
X-Internal-Token: <existing service token>
X-Viewer-Lease-Token: <viewer lease token>
body: {
  source_client_id,
  requested_event_type,
  request_id,
  command_context,
  stage_binding_authorization_id?,
  binding_revision_id?,
  stage_composition?
}
```

Route不信任 payload `role`，只以 `SessionStore`、`ViewerLeaseStore.authorizePrimary` 與 event-specific context判斷。`openStageRequest`／`loadArtifactGroupRequest` 的 stage transaction為必填；其他 mutator不得附帶它取得額外 authority。所有正常 allow或deny一律回 HTTP 200 structured decision；403只代表 internal service auth失敗，其他 non-2xx、timeout或invalid body由Kit分類為 transport outage。Response只含：

```json
{"authorized":false,"reason":"lease_invalid","request_id":"...","retryable":false,"detail_code":"lease_expired"}
```

固定 reason沿用已核可六值：`spectator_readonly | lease_invalid | session_lifecycle_blocked | unauthorized_source_client | unsupported_command | invalid_payload`。真正 network/timeout/non-JSON由 Kit轉成 `reason:"lease_invalid", retryable:true, detail_code:"authority_unavailable"`；invalid/released/expired lease為 `retryable:false`。Response不回 token、principal、session detail或raw upstream body。

對 stage-load event，第一次 valid authorization必須在同一 coordinator critical section中把 exact transaction由 `pending` 原子轉為 `executing`並綁定 `request_id`；任何第二次 authorization（包含相同 ID的 replay、不同 ID或並行 race）均回 HTTP 200 deny且 zero mutation。若 HTTP response遺失，Kit fail closed且該 transaction留在 executing直到 bounded deadline；不得為可用性放寬成 replayable authority。

### 4. 每個有效 mutator有必填 request_id與單一 terminal

Viewer `_withRuntimeAuthority` 對每個 mutator補上未提供時的 unique `request_id`。Kit success result additive echo同一 ID；拒絕只 emit：

```json
{
  "event_type": "commandRejected",
  "payload": {
    "rejected_event_type": "focusPrimRequest",
    "reason": "lease_invalid",
    "request_id": "cmd_...",
    "session_id": "optional safe correlation",
    "retryable": false,
    "runtime_state": "unchanged",
    "detail_code": "lease_expired",
    "detail": "optional secret-safe text"
  }
}
```

若stage authorization request已被coordinator consume、但Kit在bounded timeout內沒有收到可驗證的allow response，Kit MUST在任何mutation前，以同一internal token、lease token與exact authorization body呼叫 `POST /api/internal/review-sessions/:sessionId/stage-binding-authorization-rollbacks`。Coordinator只允許該exact pending或executing tuple轉為`failed {failure_code:"authorization_unavailable"}`；duplicate rollback冪等，active/mismatched tuple拒絕。這避免response loss把session卡在10分鐘executing TTL；若coordinator整體不可達，rollback仍是best-effort residual risk，Kit維持zero mutation並回authority-unavailable。

Well-formed attempt不得 dual-emit legacy unauthorized result。Direct malformed request若缺 `request_id`，Kit產生 `rejection_id`並回 `invalid_payload`，但不得假稱它能完整關聯原 caller attempt。Unknown catalog外event仍 forward-compatible ignore + diagnostic；production收到 harness-only `composeStageRequest`回 `unsupported_command`。

`runtime_state`為必填封閉值 `unchanged | changed_unconfirmed`。所有pre-mutation denial/outage必須是 `unchanged`；只有runtime已觀察成功、但coordinator completion無法被證實時才可用 `changed_unconfirmed`。Viewer以persistent aria-live failure state呈現rejection並依request ID關聯；`changed_unconfirmed`時把stage標為 `unproven`、阻擋盲retry／A4 handoff並要求authenticated status resync。本 change不新增vg01 event type，而是在既有 `stage_loaded` additive傳 `status:"active"|"unproven"`與revision；parent只在active保存loaded stage，unproven或缺proof一律清除並阻擋。FakeKit提供deterministic one-shot rejection；其啟用沿用現有build flag/dev-only query守門，production build單靠query不得啟用。

### 5. Kit使用 bounded、no-cache coordinator verifier

`runtime_authority.py` 提供可注入 transport與 structured decision。Production transport使用 Python stdlib HTTP、`COORDINATOR_INTERNAL_API_BASE`、既有 `INTERNAL_API_AUTH_TOKEN`、300–500 ms timeout與拒絕 redirect的 handler；base URL只允許 explicit loopback HTTP/HTTPS、不得含 userinfo/query/fragment。

Spectator、missing request ID與明顯 invalid payload在 network前分別拒絕。其餘每個 mutator每次呼叫 coordinator，不做 positive cache；readonly query與video維持原路徑。Internal route的 HTTP 200 `authorized:true|false`是唯一正常 decision；401/403 internal-service auth error、其他 non-2xx、network exception、timeout、redirect、non-JSON與unexpected response一律視為 transport outage、fail closed且只輸出分類後 detail，不記 URL credential、headers、token或response body。Forged/released/expired等 business denial仍由 HTTP 200 body傳達，不能因403而誤標為 retryable outage。

### 6. Stage binding使用完整 server-resolved transaction

Public preauthorization route仍為：

```text
POST /api/review-sessions/:sessionId/stage-binding
X-Viewer-Lease-Token: <lease>
X-User-Token / future production credential
body: {
  source_client_id,
  role: "primary",
  artifacts: [{artifact_id, role:"primary"|"secondary", load_order}]
}
```

Coordinator要求 current authenticated principal等於 lease principal，selection無重複、恰一 primary，所有 artifact均屬 session、ready且有 server-known URL。Browser不得提交 URL或 authoritative revision。Coordinator建立 server-generated `stage_binding_authorization_id`與 `binding_revision_id`，回 exact resolved `stage_composition`、`pending_expires_at`與 `status:"pending"`。

`StageBindingAuthorityStore` 以 opaque ID保存完整 canonical tuple、opaque principal、lease/source、created/deadline與 `pending | executing | active | failed | superseded`。每 session只允許一個 non-terminal transaction：新 preauthorization可 supersede舊 pending，但 executing尚未結束時必須 generic拒絕，不得並行覆寫。第一次 valid Kit authorization以 authorization ID + revision + request ID + exact tuple原子 `pending -> executing`；所有 replay／race均deny。Pending TTL只在 claim前生效；executing改用獨立 deadline，避免正常長載入被短 preauth TTL誤殺。

Store使用 injectable clock/capacity，預設 pending TTL 60秒、executing deadline 10分鐘、completed replay retention 30分鐘、全域最多256個 non-terminal與每 session最多4個 retained completed record；測試可注入較小值。到期 executing轉failed，expired/superseded/completed均有 bounded eviction；active/last-good只保存必要revision摘要，不存 raw token或credential。任何新預設若實測 host-native stage P95不足，必須先以 evidence調整，不得取消 bound。

Production `openStageRequest`與`loadArtifactGroupRequest`都必須帶 coordinator回傳的 authorization ID、revision與 exact composition；不存在只靠 valid lease + browser URL的 direct-open例外。Kit在 mutation前把完整 event context送 authorization route逐欄比較；browser若換 session artifact、URL、secondary、order、ID或revision，zero mutation拒絕。Harness-only FakeKit可用本地 deterministic fixture，但 production Kit缺 transaction一律拒絕。

`LoadingManager`為每次 accepted stage attempt建立 immutable context（request ID、authorization ID、revision、canonical tuple、runtime-state flag），由 already-open、async-open與 load-status callback閉包／attempt registry持有；不得用可被下一請求覆寫的共用 `_requested_stage_context`作 terminal authority。新 attempt若已有 executing attempt則拒絕，避免 interleaved callback錯配。

External `loadArtifactGroupRequest`只可呼叫 coordinator一次並 consume一次 `pending -> executing`；composition完成後，以程式內建立、不可由DataChannel payload偽造的 immutable attempt context呼叫 internal authorized stage-open primitive。該 internal delegate MUST NOT再次 authorization／consume。Direct external `openStageRequest`則自行 authorization一次，再呼叫同一 internal primitive。不得用 payload布林旗標（例如 `already_authorized:true`）跳過驗證；只有 verifier成功後建立的 private context型別／object reference可進 internal primitive。

`loadArtifactGroupResult {result:"accepted"}` 明定為 non-terminal。只有 already-open、async open或 load-status path觀察到真 `openedStageResult:success` 時，Kit才呼叫 internal confirmation：

```text
POST /api/internal/review-sessions/:sessionId/stage-binding-confirmations
X-Internal-Token + X-Viewer-Lease-Token
body: {stage_binding_authorization_id, binding_revision_id, request_id, outcome:"success"|"failed"}
```

正常 confirmation allow/deny同樣使用 HTTP 200 structured decision。Coordinator重新驗 current session/lease與 executing transaction：`outcome:"success"`才 atomic更新 active/last-good、append一次 `stageBindingApplied`；`outcome:"failed"`只關閉為failed。Exact duplicate completion可 idempotent replay同一結果且不得重複 audit；mismatched request/revision/outcome deny。Kit只有 success confirmation被證實後才 emit `openedStageResult:success`。

若 GPU stage已觀察成功但 confirmation timeout、transport失敗或正常deny，Kit emit單一 correlated `commandRejected {runtime_state:"changed_unconfirmed"}`；last-good不變、不得宣稱 applied、不得自動逆轉 GPU stage或盲 retry。Viewer將 stage標為unproven，並透過已authenticated/self-only的 lease status取得 caller可見 `stage_binding {transaction_status, active_binding_revision, last_good_binding_revision}`：若 status證實同revision已active才解除；否則保持阻擋並要求重新同步／新 authorization。Pre-mutation拒絕一律 `runtime_state:"unchanged"`。

Process restart清除 pending/completed/active in-memory authority；A4與後續 mutation fail closed直到重新套用。這與現有 process-local viewer lease語意一致。

### 7. Late lease只重排既有 deferred-open

`viewer_lease_token` parent handler收到trusted non-empty lease token與optional user token時，只ephemeral更新review env；只有embedded mode、selected asset仍存在、stage status不是 `matched`、且 `_canOpenSelectedAsset()`成立，才呼叫 `_scheduleDeferredOpenStage(0)`。既有scheduler先清舊timer；matched guard避免成功後因重複token重開。不得修改target stage、直接呼叫未授權send或改 `_openSelectedAsset` 的authority gate。User token本身不得觸發send或出現在log/UI。

### 8. Deploy與docs只改可自動驗證面

Host-native Kit從 private env取得 loopback base與既有 internal token；tracked sample只留空 placeholder，deploy/debug log不得輸出值。更新 service README/runbook與 `docs/contracts/streaming-datachannel-events.md`，但不直接改 `docs/plans/*.html`、manifest或baseline。任何手寫 canon wording另走 `design-canon-change-control` 的獨立 human-only提案，不納入本 PR的自動 merge範圍。

## Risks / Trade-offs

- Coordinator暫時不可達會阻擋所有 mutator：以短 timeout、`retryable:true/detail_code:authority_unavailable`與可見 UI緩解；不用 stale cache。
- 同步 HTTP會增加 Kit event-thread latency：mutator為低頻人工操作，host-native P95必須量測；超標另案改 async preauthorization，不在本 change新增 queue。
- Kit已改 stage但 confirmation失敗：以 `changed_unconfirmed`揭露 runtime truth、保留 last-good並阻擋盲 retry/handoff，先用authenticated status resync；無法證實才要求 operator建立新 authorization。
- Atomic consume的 HTTP response若遺失，transaction會停在executing直到 bounded deadline：這是防 replay的可用性取捨；不得重放 authority或建立第二個並行 attempt。
- Claim/status/stage-binding為 breaking API：coordinator、viewer、Kit同 PR原子 rollout，不能只部署一半。
- Local-dev identity仍可自選：只算 lab，production mutation route fail closed；A4 production full仍需要外部 IdP contract。
- Canonical protocol由已 archive change提升時仍保留 optional request correlation與較窄的 rejection payload：本 change以 delta spec、`tests/contracts` canonical schema/contract tests與producer/consumer原子更新避免建立第二套 wire authority；archive source保持唯讀。
- `LoadingManager._on_load_artifact_group`／`_on_open_stage`未被 GitNexus索引：以 source inspection、all terminal path tests與host-native evidence補償 UNKNOWN。

## Migration Plan

1. 先加 coordinator opaque-principal、transaction store/routes與 failing tests；Kit尚未呼叫時不改 runtime mutation。
2. 同步切換 Kit verifier/rejection與viewer/FakeKit consumer，success event additive echo request ID，rejection明示 runtime state。
3. 切換兩種 production stage-load caller到 server preauthorization、atomic consume與Kit observed-success completion；`accepted`保持 non-terminal，changed-unconfirmed走 status resync。
4. 更新 canonical protocol/embedded/viewport delta、private deploy wiring與可自動合併 docs，跑CPU/unit/contract/browser。
5. Windows host-native Kit驗 valid、forged、released、expired、wrong-source、outage、first-frame/stage/DataChannel後才 merge。

Rollback必須回退整個 dependency PR；不得只回退 viewer consumer或 coordinator route。若 host-native gate失敗，PR保持未合併，A4只保留 table/Issue partial且3D/full為 `no`。

## Open Questions

- 2026-07-21 使用者已裁決本輪以 `auth_scope=local_dev_lab` 推進且 `production full=no`。A4 production identity仍需 external owner另行提供 OIDC issuer、audience、JWKS與stable subject claim；未提供前不得宣告 production full。
- Host-native同步 authorization若 P95超過500 ms，需另案評估 async preauthorization；不得以positive cache降低 freshness。
- Canonical `kit-datachannel-protocol` 的 tracked JSON schema在本 change落地時必須一起反映 mandatory correlation與完整 rejection fields；若 schema、spec與runtime有任何不一致，dependency PR保持未合併。
