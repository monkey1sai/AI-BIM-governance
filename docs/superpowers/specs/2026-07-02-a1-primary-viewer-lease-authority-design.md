# A1 primary viewer lease authority follow-up

> 日期：2026-07-02
> 類型：A1 live viewer 權限閉環 follow-up（formal spec evidence）
> Scope：`bim-review-coordinator` viewer lease API、`web-viewer-sample` A1 embedded viewer、standalone `/ui/open` viewer

## 背景

A1 治理模型檢核頁的閉環是「規則檢核失敗 → 看到失敗構件 → 在真實模型位置高亮 → 建立 Issue / 匯出 BCF」。這條鏈路需要 live viewer 能對 Kit 送出 mutating DataChannel 指令，例如 stage binding / highlight / focus。

在 primary / spectator 拓樸下，前端不得只用 query string 或 client intent 自稱 primary；coordinator 必須是 viewer role 的權威。此 follow-up 將 primary viewer lease 明確化為 A1 viewer 操作的授權來源，並補齊 standalone viewer 的同一條權限路徑。

## 需求

### 1. Coordinator 是 primary viewer role 權威

- A1 console 在 mount embedded live viewer 前 SHALL 透過 coordinator claim primary viewer lease。
- `stage-binding` SHALL require valid primary viewer lease token；沒有 token 或 token 不屬於 active primary lease 時 SHALL reject。
- viewer lease token SHALL NOT appear in iframe URL query；embedded viewer SHALL receive token through parent-to-iframe `postMessage`.

### 2. Standalone `/ui/open` viewer 不得繞過 lease gate

- Standalone viewer 指 `window.parent === window` 且沒有 parent 注入 token 的 `/ui/open?session=...` viewer。
- 當 standalone viewer 需要套用 stage binding 且尚無 `viewerLeaseToken` 時，viewer SHALL claim a primary viewer lease from coordinator before calling `stage-binding`.
- 若 coordinator 回應不是 active primary lease，或 primary 已被其他 viewer 佔用，viewer SHALL show honest failed binding state and SHALL NOT send `composeStageRequest`.
- Embedded viewer (`window.parent !== window`) SHALL NOT self-claim primary lease; primary lease remains owned by A1 console.

### 3. First-frame audit 與 lease heartbeat 分流

- A1 first-frame report SHALL only report the review session first-frame event.
- A1 SHALL NOT write viewer lease id into `endpoint_id`, because `endpoint_id` is intended for Kit endpoint identity.
- Lease-specific first-frame / loaded-stage / DataChannel readiness evidence SHALL be recorded through viewer lease heartbeat.

### 4. Loaded stage URL length must match API schema

- `loaded_stage_url` heartbeat payload accepts up to 2048 characters.
- The in-memory viewer lease store SHALL preserve `loaded_stage_url` up to the same 2048-character limit before stage match comparison.
- Long artifact URLs SHALL NOT be truncated to a shorter helper default that can produce false stage mismatch.

## Out of scope

- No Kit process lifecycle management change.
- No GPU fleet allocation change.
- No primary / spectator port allocation change.
- No new runtime dependency.

## Verification contract

Minimum validation for this follow-up:

- Coordinator viewer lease tests cover claim / heartbeat / stage-binding authorization, including a `loaded_stage_url` longer than 500 characters.
- A1 embedded viewer tests cover parent-owned primary lease token handoff and first-frame reporting without endpoint id misuse.
- Window DOM/internals tests cover standalone claim → `stage-binding` with token → `composeStageRequest`, and embedded mode not self-claiming.
- Viewer UI build must pass after import conflict resolution with current `origin/main`.
