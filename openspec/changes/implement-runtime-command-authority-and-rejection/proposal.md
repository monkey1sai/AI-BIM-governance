## Why

Kit 目前只檢查 `role` 與 lease token 是否非空，無法辨識偽造、過期、已釋放、跨 session 或 wrong-source lease；各 handler 的拒絕結果也不是同一個 terminal contract。另一方面，viewer lease replay 未綁 server-authenticated principal，stage binding 在 Kit 證實載入成功前就被記為 applied，embedded viewer 第一次 open 因 lease 晚到失敗後也不會恢復。A4 primary-only 3D handoff 因此無法取得可信 runtime authority、active binding 與 rejection evidence。

## What Changes

- 由 `bim-review-coordinator` 提供 internal-only、既有 internal token 保護的 narrow runtime-command authorization；權威仍使用 coordinator-owned Review Session 與 `ViewerLeaseStore`，不新增通用 operations endpoint。
- Viewer lease claim 在查 session 與採用 body identity 前先由 `UserAuthProvider` 驗證；idempotent replay 綁定 principal，conflict/status response 不再洩漏其他 principal 的 lease detail。
- Stage binding 改為 server-generated authorization/revision 的 bounded `pending -> executing -> active|failed` transaction。Coordinator 解析完整 ordered artifact tuple，`openStageRequest` 與 `loadArtifactGroupRequest` 都必須在 mutation 前原子 consume 同一 transaction，且只有 observed `openedStageResult:success` 後的 internal confirmation 才能寫 active/last-good 與 audit。
- `bim-streaming-server` 在每次 runtime mutator 改變 USD、selection 或 stage 前，即時向 coordinator 驗證 exact session、source client、primary lease、expiry、lifecycle 與 event context；authority unavailable 時 bounded fail closed，無 positive cache。
- **BREAKING**：Kit 拒絕 runtime mutator 時只回正式 `commandRejected` terminal event，不再回各 command 的 legacy unauthorized error result；成功 result 維持既有 event type並 additive echo `request_id`。拒絕另帶 `runtime_state:"unchanged"|"changed_unconfirmed"`，避免 post-mutation confirmation failure 被誤報為 zero mutation。
- **BREAKING**：viewer lease claim 與 status 需要 user auth；stage-binding response 從立即 `status:"applied"` 改為 pending authorization。Standalone viewer 與 console client 同步更新，不做分階段不相容 rollout。
- Viewer 顯示 aria-live rejection；`changed_unconfirmed` 時將 stage 標為 unproven並阻擋盲 retry／handoff直到 resync。FakeKit 提供 deterministic one-shot replay；embedded primary lease 晚到時只在 stage 尚未 matched 且仍可開啟時重排既有 deferred-open。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `viewer-runtime-command-bridge`：把 Kit 權限檢查從 payload 形狀提升為 coordinator-backed authentic lease verification，定義唯一 terminal rejection、principal-bound replay、Kit-confirmed stage binding 與 late-lease recovery。
- `kit-datachannel-protocol`：將每個 well-formed mutator 的 `request_id`、stage transaction envelope，以及 `commandRejected` 的 retry/runtime-state/detail fields 納入 canonical producer wire contract。
- `embedded-viewer-bridge`：在既有受限 postMessage 安全通道additive傳遞 ephemeral lab user token與stage active/unproven狀態，並定義 trusted lease晚到時只恢復一次既有deferred open。
- `viewer-viewport`：把 lease conflict 改為不揭露holder的generic狀態，新增authority-unavailable與changed-unconfirmed可見阻擋／resync語意。

## 與已 archive `viewer-redesign` 的邊界

`origin/main` 的 `99cd722` 已 archive `viewer-redesign`，並將 `kit-datachannel-protocol`、`embedded-viewer-bridge`、`viewer-viewport` 提升為 canonical specs。本 change 不回寫 archive source、不新增 vg01 event type，也不直接編輯手寫 design canon；但它 **確實修改現行 producer wire contract**（mandatory request correlation、stage transaction、`commandRejected` retry/runtime-state fields）、existing postMessage payload與visible failure semantics。因此本 change 必須直接提供三個 canonical capability 的 delta spec，不能再把 reconciliation 延後給已結束的 change。若 delta、schema、producer、consumer 任一面未同步，dependency PR 不得 merge。

## Impact

- Owning folders：`bim-review-coordinator/`、`bim-streaming-server/`、`web-viewer-sample/`。
- Contracts/docs：既有 service tests、root focused contract tests、`docs/contracts/streaming-datachannel-events.md`、service runbooks，以及 canonical `kit-datachannel-protocol`／`embedded-viewer-bridge`／`viewer-viewport` delta；不回寫 archived change source。
- API：新增 internal-only runtime authorization／stage confirmation routes；修改 viewer lease claim/status 與 stage-binding public response semantics。
- Runtime：每次 mutator 增加一次 bounded loopback authorization call；stage load success 另有一次 confirmation；readonly/video 不受 outage 阻擋。
- Dependencies：不新增 production package；使用 Node/Python 既有 HTTP、internal auth、crypto 與 test infrastructure。
- Rollout：coordinator、Kit、viewer 必須同一 dependency PR 原子升級；若 host-native gate 未通過，PR 不 merge，A4 3D/full completion 維持 `no`。
- Non-goals：不實作公司雲端 OIDC/SSO、不把 lab identity 宣稱 production-ready、不實作 A4 search/Issue/handoff UI、不控制 GPU viewport、不直接改手寫正本或 visual baseline。
