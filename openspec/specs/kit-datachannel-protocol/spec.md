# kit-datachannel-protocol Specification

## Purpose
TBD - created by archiving change viewer-redesign. Update Purpose after archive.
## Requirements
### Requirement: DataChannel 訊息 SHALL 全部具名並有 schema 定義

console↔Kit 的 DataChannel 訊息 SHALL 固定為 envelope `{event_type: string, payload: object}`，且每個訊息 SHALL 依 `contracts/kit-datachannel-v1.schema.json` 定義欄位（落地實作時遷入 `tests/contracts/` 並接 CI）。訊息目錄封閉如下；新增訊息 SHALL 走 change 提案，MUST NOT 靜默擴充：

**OUT（console→Kit；★=runtime mutator）**

| event_type | payload 要點 |
|---|---|
| ★ openStageRequest | `url`、`requested_stage_url`、`stage_composition? {primary, secondary_layers[]}`、`artifact_bindings?[]` |
| loadingStateQuery | `{}` |
| getChildrenRequest | `prim_path`（預設 `/World`）、`filters:["USDGeom"]` |
| ★ highlightPrimsRequest | `request_id?`、`mode:"replace"`、`items[] {prim_path, ifc_guid?, color?, label?, source?, issue_id?, mapping_method?, mapping_confidence?}`、`focus_first` |
| ★ focusPrimRequest | `request_id?`、`prim_path` |
| ★ clearHighlightRequest | `{}` |
| ★ selectPrimsRequest | `paths[]`（空陣列=清空選取） |
| ★ composeStageRequest | `binding_revision_id`、`artifacts[]`（harness 路徑） |
| ★ loadArtifactGroupRequest | `binding_revision_id`、`stage_composition {primary{artifact_id,usdc_url,...}, ...}`（production 路徑） |
| ★ makePrimsPickable | `paths[]` |
| ★ resetStage | `{}` |

**IN（Kit→console）**

| event_type | payload 要點 |
|---|---|
| openedStageResult | `result:"success"\|"error"`、`url`、`error?`、`binding_revision_id?` |
| loadingStateResponse | `url`、`loading_state:"idle"\|"busy"` |
| getChildrenResponse | `prim_path`、`children[] {name, path, children?}` |
| highlightPrimsResult | `result`、`request_id?`、`selected_paths[]`、`missing_paths[]`、`fallback_paths[]` |
| focusPrimResult | `result`、`request_id?`、`prim_path?`、`fallback_path?` |
| stageSelectionChanged | `prims[]`（USD prim path 字串） |
| updateProgressAmount | 進度數值（Kit 內建） |
| updateProgressActivity | `text`（`"None"`=載入活動結束） |
| bindingApplied | `binding_revision_id` |
| loadArtifactGroupResult | `result`、`binding_revision_id?`、`error?` |
| commandRejected | 見下方獨立 Requirement（本 change 首次定義） |

#### Scenario: 未知訊息前向相容

- **WHEN** console 收到目錄外的 `event_type`
- **THEN** console SHALL 忽略該訊息（不 crash、不誤路由）
- **AND** SHALL 記入觀測 log 供診斷

### Requirement: runtime mutator SHALL 攜帶 runtime authority envelope

`runtimeMutatingEvents` 集合（openStageRequest、loadArtifactGroupRequest、composeStageRequest、highlightPrimsRequest、focusPrimRequest、clearHighlightRequest、selectPrimsRequest、makePrimsPickable、resetStage）的 payload SHALL 由送出端統一注入：`role:"primary"|"spectator"`、`source_client_id`、`viewer_lease_token?`（有 lease 才帶）、`session_id?`。前端 SHALL 於送出前套三道 gate（spectator view-only / session lifecycle blocked / primary 需 lease token），並於攔下時誠實記事件（非靜默）；Kit 端 runtime authority SHALL 為第二道 defense-in-depth 驗證。

#### Scenario: spectator 送 mutator 被前端攔下

- **WHEN** spectator 模式下觸發 highlightPrimsRequest
- **THEN** 前端 SHALL 不送出並記錄「略過 highlightPrimsRequest：spectator view-only」

### Requirement: commandRejected SHALL 為權威拒絕的唯一回饋訊息

Kit/streaming 端拒絕 runtime mutator 時 SHALL 回傳：

```json
{
  "event_type": "commandRejected",
  "payload": {
    "rejected_event_type": "<被拒的 OUT event_type>",
    "reason": "spectator_readonly | lease_invalid | session_lifecycle_blocked | unauthorized_source_client | unsupported_command | invalid_payload",
    "request_id": "<原請求的 request_id（原請求有帶才回）>",
    "session_id": "<被拒請求所屬 session（可判定時）>",
    "detail": "<人可讀補充（選填，不含 secret）>"
  }
}
```

`reason` 為封閉列舉；`viewer_lease_token` 等 secret MUST NOT 出現在 payload/log。console 與 viewer origin 收到後 SHALL 以可見回饋呈現（toast/事件列），MUST NOT 靜默丟棄；fakeKit harness SHALL 支援回放本訊息供 E2E。

#### Scenario: 後端拒絕 spectator 寫入

- **WHEN** spectator 繞過前端 gate 直送 highlightPrimsRequest（defense-in-depth 情境）
- **THEN** Kit 端 SHALL 回 `commandRejected {rejected_event_type:"highlightPrimsRequest", reason:"spectator_readonly"}`
- **AND** viewer UI SHALL 顯示拒絕回饋、3D 選取狀態 SHALL 不變

#### Scenario: lease 失效

- **WHEN** primary 的 lease 已過期而仍送出 mutator
- **THEN** Kit 端 SHALL 回 `commandRejected {reason:"lease_invalid"}`
- **AND** console SHALL 轉入 lease-expired 失敗態（見 viewer-viewport 矩陣）
