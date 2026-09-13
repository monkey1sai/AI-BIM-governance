# Streaming DataChannel Events

These events are exchanged between `web-viewer-sample` and `bim-streaming-server`.

## Verified trace carrier

The supported vendor `ApplicationMessage` ABI is exactly `{event_type,payload}`; it does not expose a separately supported root envelope field. Every one of the 26 event types enumerated by `tests/contracts/kit-datachannel-v1.schema.json` therefore carries the case-exact verified review root in `payload.trace_id`. A top-level `trace_id` is not a valid substitute.

Viewer sends no DataChannel message before the coordinator Socket.IO acknowledgement verifies the session root. Kit rejects every viewer→Kit message with a missing or mismatched payload trace before any stage read or mutation, and propagates the verified trace on every response/result/rejection/progress/unsolicited event. Viewer rejects every Kit→viewer message with a missing or mismatched trace before correlation bookkeeping, pending-request completion, accepted logging, or UI/state mutation. Mutators still require coordinator runtime authority; trace matching never replaces lease authorization.

Every viewer→Kit catalog payload also carries the Socket-verified `session_id` beside `trace_id`. Both values are untrusted resolver candidates at the Kit boundary: Kit must verify their case-exact pair through the coordinator internal API before any read or mutation. `session_id` is correlation context, not an independent authority and never replaces the runtime mutator lease check.

## Open Stage

Request:

```json
{
  "event_type": "openStageRequest",
  "payload": {
    "trace_id": "ifcready_1779687625000_064c6813",
    "request_id": "stage-open-001",
    "session_id": "review_session_xxx",
    "source_client_id": "viewer_lease_xxx",
    "role": "primary",
    "viewer_lease_token": "<ephemeral bearer; never log>",
    "stage_binding_authorization_id": "stage_auth_xxx",
    "binding_revision_id": "binding_rev_xxx",
    "url": "http://127.0.0.1:49101/artifacts/tenants/.../model.usdc",
    "stage_composition": {
      "primary": {
        "artifact_id": "artifact_usdc_xxx",
        "role": "primary",
        "load_order": 0,
        "usdc_url": "http://127.0.0.1:49101/artifacts/tenants/.../model.usdc"
      },
      "secondary_layers": []
    }
  }
}
```

Production `openStageRequest` and `loadArtifactGroupRequest` are server-owned
stage transactions. The viewer first claims an authenticated primary lease,
then calls `POST /api/review-sessions/{session_id}/stage-binding` with ordered
artifact IDs. The coordinator resolves the exact ready URLs and returns the
authorization ID, revision, and canonical composition shown above. Browser
`url` fields are display/correlation only and never grant mutation authority.

Response:

```json
{
  "event_type": "openedStageResult",
  "payload": {
    "trace_id": "ifcready_1779687625000_064c6813",
    "request_id": "stage-open-001",
    "url": "http://127.0.0.1:49101/artifacts/tenants/.../model.usdc",
    "result": "success",
    "error": "",
    "binding_revision_id": "binding_rev_xxx",
    "applied_mode": "artifact_bindings_multi_layer_payload",
    "primary_binding": {
      "artifact_id": "artifact_usdc_xxx",
      "load_order": 0,
      "url": "http://127.0.0.1:49101/artifacts/tenants/.../model.usdc"
    },
    "loaded_bindings": [
      {
        "artifact_id": "artifact_usdc_xxx",
        "load_order": 0,
        "composition_strategy": "primary_stage"
      },
      {
        "artifact_id": "artifact_overlay_xxx",
        "load_order": 10,
        "composition_strategy": "session_sublayer"
      }
    ],
    "failed_bindings": [],
    "partial_load": false,
    "missing_paths": [],
    "fallback_paths": []
  }
}
```

Kit authorizes and atomically consumes the coordinator transaction before the
first stage mutation. `loadArtifactGroupResult.result="accepted"` is only a
non-terminal acknowledgement. Kit emits `openedStageResult.result="success"`
only after it observes the requested stage and the coordinator confirms the
same revision as active. A URL-only direct open is rejected in production;
legacy URL-only parsing remains harness compatibility and is not acceptance
evidence.

`applied_mode` values:

```txt
legacy_single_url (harness compatibility only)
stage_composition
artifact_bindings_single (legacy harness)
artifact_bindings_multi_layer_payload (legacy harness)
```

Missing binding URLs are returned in `missing_paths`. Secondary binding load
failures are returned in `failed_bindings` and set `partial_load=true`. For a
coordinator-issued exact transaction, any such partial application completes
the transaction as `failed`, emits an error terminal, and never promotes the
revision to `active`; a primary stage being visible is not evidence that the
whole multi-artifact composition succeeded. That terminal carries
`runtime_state="changed_failed"`, `partial_load=true`, and `failed_bindings[]`.
Unlike `commandRejected.changed_unconfirmed`, the coordinator has confirmed
this transaction failed: the viewer clears active evidence and reports
`stage_loaded.status="unproven"` to its parent, while an explicit new
transaction may retry. If the failed completion call itself is denied or
unavailable, Kit instead emits the single correlated
`commandRejected.runtime_state="changed_unconfirmed"`; it must not claim the
transaction is known-failed until the coordinator confirms that terminal.

GPU / Kit manual validation when hardware is available:

1. Start local services with `.\scripts\start-all.ps1`, or start Kit manually with `.\bim-streaming-server\scripts\start-streaming-server.ps1 -SkipAutoLoad`.
2. Create Phase B conversion/session evidence with `.\scripts\smoke-bscheme-intake.ps1 -SkipKitLauncher`, then open `web-viewer-sample` with the returned `review_request_id` or `session_id` when runtime services are available.
3. Confirm the viewer obtains a pending stage transaction, sends `openStageRequest` with the same authorization ID, revision, and exact `stage_composition`, then receives exactly one correlated terminal result. A success is valid only when authenticated lease status reports the same revision as active.
4. Send `highlightPrimsRequest` against a known mapped `usd_prim_path`; streaming conversion mappings may also expose `primary_usd_prim_path` and `usd_prim_paths`, with `usd_prim_path` kept as the current viewer-compatible focus alias. Real validation requires `missing_paths=[]` and `fallback_paths=[]`.
5. Treat `/World` fallback as stream/DataChannel liveness only, not mapping correctness.

## Highlight Prims

目前 Kit 使用 `applied_mode: material_overlay`。只有明確「在模型中顯示問題」才送出
`highlightPrimsRequest`；檢核完成與閱讀明細都不發 3D mutator。
請求繼續使用既有 authority envelope、request_id 與 mode=replace；items 最多4096個，
每個 prim_path 為確切 mapped USD prim path。color 為3/4個0..1有限數字，預設alpha=1。
新增可省略的 severity 字串：critical > high > error=required > medium=warning > low > info/unknown。
IDS 失敗結果的 required 在問題篩選與著色時歸入 error 紅色；原始 severity 與 pass/fail 狀態保持不變。
同 prim／重疊 render target 依最高嚴重度仲裁；同順位按 path、RGBA 排序以確保順序無關。
A1 的問題列不去重，送出構件與模型 applied_paths 分別計數。

成功回覆範例（每個請求仍須先通過 coordinator 的逐次授權）：

~~~json
{
  "event_type": "highlightPrimsResult",
  "payload": {
    "trace_id": "ifcready_material_example",
    "request_id": "material-example-001",
    "result": "success",
    "applied_mode": "material_overlay",
    "applied_paths": ["/World/WallA", "/World/DoorB"],
    "missing_paths": [],
    "unsupported_paths": [],
    "renderer_mode": "RaytracedLighting"
  }
}
~~~

- applied_paths 是已驗證 composed material 勝出的 requested paths；missing_paths、unsupported_paths
  必須保留。較低嚴重度的重疊路徑仍列 applied，但共享 render target 使用最高嚴重度顏色。
- Instance root 可使用唯一 instance opinion；不改 shared prototype，不支援直接 instance proxy、
  prototype、PointInstancer 或無可繪製幾何。外部更強 material opinion 無法克服時回 unsupported。
- Overlay 僅寫入自己持有的匿名 session sublayer；不保存 root/source USDC、不更換 edit target 的永久狀態。
  替換驗證失敗會回 error 並恢復舊圖層。關閉只移除自己的 layer，保留相機、選取與其他 layers。
- 同 Stage ASSETS_LOADED 保留效果；新 Stage、CLOSED、shutdown 清除舊效果。
- focus_first 保留協定相容，但材質高亮不聚焦、不選取；定位必須另送 focusPrimRequest。
  高亮／定位不再以 /World fallback 冒充 mapped component。
- Viewer 僅在 trace、request、binding 與觀看 context 相符時處理 ACK；父介面的 highlight_result
  等待真正 Kit 回覆。缺路徑、unsupported、unmapped、舊 selection ACK、拒絕／逾時均不聲稱多色完成。
- renderer_mode 只讀 /rtx/rendermode，unknown 保持未知，不切換 renderer。
  它不能單獨證明可見 RTX 效果；必須另外保留實際 first frame、Stage、DataChannel、ACK及畫面。
  舊 applied_mode=selection 仍可解析為選取資訊，但不能作為多色高亮驗收。

## Focus Prim

定位只接受存在的 absolute prim path。成功時在 session edit context 執行 viewport framing，
加入 selection outline，回覆 framed=true；不改 severity materials。clear selection 使用
selectPrimsRequest(paths=[])，不重置相機；clearHighlightRequest 只恢復材質。
官方 framing API：https://docs.omniverse.nvidia.com/kit/docs/omni.kit.viewport.utility/1.0.17/omni.kit.viewport.utility/omni.kit.viewport.utility.frame_viewport_prims.html

Request:

```json
{
  "event_type": "focusPrimRequest",
  "payload": {
    "trace_id": "ifcready_1779687625000_064c6813",
    "request_id": "mapping-focus-001",
    "prim_path": "/World/IFCWALL/tn__115cm551956_body"
  }
}
```

Response:

```json
{
  "event_type": "focusPrimResult",
  "payload": {
    "trace_id": "ifcready_1779687625000_064c6813",
    "result": "success",
    "request_id": "mapping-focus-001",
    "prim_path": "/World/IFCWALL/tn__115cm551956_body",
    "requested_prim_path": "/World/IFCWALL/tn__115cm551956_body",
    "applied_mode": "selection"
  }
}
```

Every well-formed runtime mutator requires a unique `request_id`; success or
the single terminal rejection echoes the same value. Read-only
`loadingStateQuery` / `getChildrenRequest` remain outside the mutator rule.

The remaining command-specific success events are also part of the closed
catalog and retain the same request correlation:

| Event | Required payload |
|---|---|
| `selectPrimsResult` | `result`, `error`, `selected_paths[]`, `request_id` |
| `makePrimsPickableResponse` | `result`, `error`, `request_id` |
| `resetStageResponse` | `result`, `error`, `request_id` |
| `clearHighlightResult` | `result`, `applied_mode:"material_overlay"`, `request_id`；error 時含 `error` |

The root contract test extracts every literal production Kit
`dispatch_event(...)` and requires it to appear in
`tests/contracts/kit-datachannel-v1.schema.json`, preventing producer/catalog
drift from being hidden by hand-written fixtures.

## Runtime Mutation Authority and Terminal Rejection

The closed production mutator catalog is:

```txt
openStageRequest
loadArtifactGroupRequest
highlightPrimsRequest
focusPrimRequest
clearHighlightRequest
selectPrimsRequest
makePrimsPickable
resetStage
```

`composeStageRequest` uses the same request envelope but is harness-only and is
rejected by production Kit. Every mutator carries `request_id`, `role`,
`source_client_id`, `session_id`, and the current ephemeral
`viewer_lease_token`. Kit calls the loopback coordinator authority before any
USD, stage, selection, highlight, focus, pickability, or reset mutation and
does not cache positive decisions.

When a mutator is denied, Kit emits exactly one terminal event and does not
also emit a command-specific unauthorized result:

```json
{
  "event_type": "commandRejected",
  "payload": {
    "trace_id": "ifcready_1779687625000_064c6813",
    "rejected_event_type": "highlightPrimsRequest",
    "reason": "lease_invalid",
    "request_id": "mapping-highlight-001",
    "session_id": "review_session_xxx",
    "retryable": true,
    "runtime_state": "unchanged",
    "detail_code": "authority_unavailable"
  }
}
```

`reason` is one of `spectator_readonly`, `lease_invalid`,
`session_lifecycle_blocked`, `unauthorized_source_client`,
`unsupported_command`, or `invalid_payload`. `runtime_state` is
`unchanged` or `changed_unconfirmed`. Timeout, network, redirect, non-JSON,
non-200, and malformed authority responses fail closed as
`lease_invalid + retryable:true + detail_code:authority_unavailable`; a normal
forged, released, or expired lease denial is not retryable.

`changed_unconfirmed` is reserved for the case where Kit observed a stage
change but coordinator completion was not proven. The viewer clears its
handoff-ready stage, blocks blind retry and A4 handoff, and only unblocks after
an authenticated self-only status resync confirms the same revision active.
User credentials, lease/internal tokens, authorization headers, and raw
upstream responses must never enter event payloads, UI diagnostics, logs, or
test artifacts.

## Web Viewer Demo Panel

`web-viewer-sample` exposes a local demo panel when `VITE_SHOW_DEMO_PANEL=true` (default for this MVP). The panel can manually send:

```txt
openStageRequest
loadingStateQuery
getChildrenRequest /World
highlightPrimsRequest /World (smoke-only; not mapping correctness)
focusPrimRequest /World (smoke-only; not mapping correctness)
clearHighlightRequest
```

Demo `highlightPrimsRequest` payload:

```json
{
  "event_type": "highlightPrimsRequest",
  "payload": {
    "trace_id": "ifcready_1779687625000_064c6813",
    "request_id": "world-smoke-001",
    "mode": "replace",
    "items": [
      {
        "prim_path": "/World",
        "ifc_guid": "2VJ3sK9L000fake001",
        "color": [1, 0, 0, 1],
        "label": "Demo highlight from Web Viewer Demo Panel",
        "source": "web_viewer_demo_panel",
        "issue_id": "ISSUE-DEMO-001"
      }
    ],
    "focus_first": true
  }
}
```

Demo panel incoming/outgoing logs are UI diagnostics only. `/World` fallback proves only that the stream/DataChannel path is alive; it is not evidence that `element_mapping.json` is correct. Mapping correctness requires a real `element_mapping.json.items[*].usd_prim_path` response with `missing_paths=[]` and `fallback_paths=[]`; `usd_prim_path` is the current viewer-compatible alias for `primary_usd_prim_path` when streaming conversion emits one-to-many mapping data. Persistent review data is coordinated through `bim-review-coordinator` shadow metadata / external control-plane callbacks, while collaboration broadcast belongs to `bim-review-coordinator`.

## `stage_composition`（server-owned single source）

`openStageRequest.payload.stage_composition` and
`loadArtifactGroupRequest.payload.stage_composition` are byte-for-byte copies
of the coordinator-issued transaction. The browser selects artifact IDs and
roles; it does not select trusted URLs or revisions.

| Field | Type / semantics |
|---|---|
| `primary` | Exactly one `{artifact_id, role:"primary", load_order, usdc_url}` |
| `secondary_layers` | Ordered `[{artifact_id, role:"secondary", load_order, usdc_url}]`; may be empty |

The authority path is mirrored deliberately and must change atomically:

| Site | Ownership |
|---|---|
| `bim-review-coordinator/src/app.ts` | Owns transport validation, authentication, correlation, and wire/domain mapping |
| `bim-review-coordinator/src/services/runtimeMutationAuthority/runtimeMutationAuthority.ts` | Owns mutation policy, validates requested artifact IDs, resolves canonical ready URLs, and preserves the exact transaction through one public authority seam |
| `bim-streaming-server/.../messaging/runtime_authority.py` | Sends the exact composition for authorization and confirmation |
| `bim-streaming-server/.../messaging/stage_loading.py` | Executes the already-authorized immutable attempt |
| `web-viewer-sample/src/Window.tsx` | Relays the coordinator response; URL fields remain non-authoritative |

Any artifact ID, role, order, URL, authorization ID, revision, session, source
client, or request ID mismatch is a zero-mutation rejection. The active and
last-good summaries are coordinator control-plane confirmation evidence; the
actual GPU stage remains owned and observed by Kit.

When a later exact composition reuses the same primary stage, Kit replaces the
secondary sublayers previously added by this LoadingManager before applying the
new tuple. It does not remove unrelated session-layer entries or entries owned
by a different stage/session layer; a stale manager-owned secondary may never
survive into a newly confirmed revision.
