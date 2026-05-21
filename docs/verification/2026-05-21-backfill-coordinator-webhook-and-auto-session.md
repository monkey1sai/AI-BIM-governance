# Verification — backfill-coordinator-webhook-and-auto-session

**Date**: 2026-05-21
**Change**: `backfill-coordinator-webhook-and-auto-session`
**Predecessor archive**: `2026-05-21-coordinator-ifc-ready-worker-webhook` (documentation lag)
**Retro-audit anchor**: commit `a32fcd6`

> **2026-05-21 re-apply supplement**：目前 `main` 已包含 PR #85 / PR #86 的 implementation + archive；本輪補上圖片中實際外部 IFC Worker payload 的 contract/test guard：`ifc_path="http://192.168.20.234:9000/bim-control/899/xxx/model.ifc"`、`project_id="899"`、`version="xxx"`、`task_id="task_img_001"`。Production coordinator 程式碼未新增變更；本輪變更集中在 contract / test fixture / verification evidence。

## 1. 範圍

補 archive 的 spec drift：把已 ratified 但 code 從未實作的 11 個 spec scenarios（intake 4 + auto-session 4 + webhook seam 3）一次性落地。

## 2. 11 個 spec scenarios → tests 對應

### A. Worker compatibility intake — `local-coordinator-ifc-ready-intake-boundary` §"Coordinator accepts worker ifc-ready compatibility payload"

| # | Scenario | Test |
|---|---|---|
| A1 | Worker payload is accepted and normalized | `bim-review-coordinator/tests/external-ifc-ready.test.ts` →「worker payload is accepted and normalized → 202 with canonical fields」 |
| A2 | Non-ready worker status is rejected | →「non-ready worker status → 4xx，不建 local job 也不 dispatch」 |
| A3 | Missing worker fields are rejected | →「worker payload 缺 ifc_path → 4xx」、「worker payload 缺 task_id → 4xx」 |
| A4 | Worker payload does not leak into streaming contract | →「worker payload 經 normalize 後 dispatch 給 streaming 仍走 canonical shape，不洩漏 worker 形狀」 |

額外覆蓋（D11 idempotency / explicit header priority）：
- 「contract captures the image-derived absolute IFC URL worker payload」
- 「accepts image-derived IFCWorker payload with absolute S3 URL shape」
- 「worker 缺 X-Correlation-Id / X-Idempotency-Key 時從 project_id+version+task_id 派生穩定 idempotency」
- 「explicit X-Correlation-Id 優先於 task_id 派生」

### B. Conversion-ready → auto review session — `review-session-request-lifecycle` §"Coordinator session is bound back to the request"

| # | Scenario | Test |
|---|---|---|
| B1 | Conversion-ready ingestion auto-creates a review session under retired `_bim-control` | `bim-review-coordinator/tests/host-native-conversion-ingest.test.ts` →「ready ingestion 自動建立綁 USDC + Kit binding 的 session」 |
| B2 | Duplicate conversion-ready does not create duplicate sessions | →「duplicate ready ingestion 不建重複 active session」 |
| B3 | Non-ready conversion does not create a streamable session | →「failed ingestion 不建可串流 session」 |
| B4 | Coordinator-triggered creation stays control-plane only | →「auto-creation 不啟動 Kit 進程、不開 USD stage、不渲染」 |

### C. Webhook seam — `conversion-webhook-lifecycle` §"Terminal conversion-ready ingestion triggers local review session handoff"

| # | Scenario | Test |
|---|---|---|
| C1 | Ready ingestion triggers session handoff alongside callback outbox | B1 + 「pending cloud callback 不阻塞 local session handoff」皆覆蓋 |
| C2 | Pending cloud callback does not block local session handoff | →「pending cloud callback 不阻塞 local session handoff」 |
| C3 | Failed conversion creates no local session | →「failed ingestion 不建可串流 session」 |

額外覆蓋（Risk mitigation：lifecycle audit event parity）：
- 「lifecycle audit event 仍與 explicit /api/review-sessions caller 路徑等價」

## 3. Verification Evidence

| 層 | 命令 | 結果 |
|---|---|---|
| Coordinator focused | `cd bim-review-coordinator && npm test -- external-ifc-ready.test.ts auth-provider.test.ts host-native-conversion-ingest.test.ts` | **18 + 3 + 10 = 31 passed** |
| Coordinator full | `cd bim-review-coordinator && npm run verify` (= `tsc + vitest`) | **11 files / 167 tests passed**；tsc clean |
| Root contracts baseline | `python -m pytest tests -p no:cacheprovider` | **9 passed** |
| Whitespace | `git -c safe.directory=C:/Repos/active/iot/AI-BIM-governance/.worktrees/backfill-coordinator-webhook-and-auto-session diff --check` | clean |
| OpenSpec strict | `npx openspec validate --specs --strict` | **25 passed / 0 failed**（active duplicate change 已移除；正式權威為 archived specs） |
| Affected scope | `npx gitnexus detect-changes --repo AI-BIM-governance` + `git diff --stat` | GitNexus：`No changes detected`（本輪無 production symbol 變更）；diff 僅 contract/test/evidence/roadmap 補強，無範圍擴張 |

## 4. Tier 分層 — Render tier `not_observed`

依 archive Decision 一致，本 change 僅落 **control-plane auto-wiring tier**：

- `single_kit_render` / WebRTC `49100` / browser visual：**not_observed**
- 原因：需 Kit build + GPU host 前置；本 worktree 在 WSL2 + linked-worktree state，受 memory `kit-gpu-render-needs-windows-native` / `WSL-ubuntu-24-04-container-toolkit-setup` ceiling 阻擋
- 本 change 不升等該 tier、不宣稱 passed

## 5. GitNexus 對齊

PR #85 apply 時的 production affected symbols如下；本輪 re-apply supplement 已跑 `npx gitnexus detect-changes --repo AI-BIM-governance`，結果為 `No changes detected`，符合「只補 contract/test/evidence，未改 production symbols」。

PR #85 原始 affected scope：

```
bim-review-coordinator/src/app.ts                            +225 / -4
bim-review-coordinator/src/services/externalIfcReadyStore.ts  +15 / -0
bim-review-coordinator/src/types.ts                           +5  / -0
bim-review-coordinator/tests/external-ifc-ready.test.ts       +137 / -0
bim-review-coordinator/tests/host-native-conversion-ingest.ts +141 / -0
tests/contracts/ifc_ready_payload.json                        +19 / -0
tests/fakes/external_ifc_worker_client.py                     +13 / -0
```

Affected symbols 與 §0.2 預期一致（無 HIGH/CRITICAL surprise）：
- `ingestConversionReport`：terminal `ready` 分支接 `autoCreateOrActivateSession`（新 helper）
- `SessionStore.create`：被 `autoCreateOrActivateSession` 透過既有 path 呼叫，不改 signature
- `allocateKitInstanceBindings` / `chooseReadyUsdc`：被新 helper 透過既有 path 呼叫
- `/api/external/ifc-ready` route handler：插入 `normalizeIntakePayload`（新 helper）；既有 canonical caller 行為不變
- `/api/internal/conversion-result` / `/api/internal/conversions/:id/ingest`：response 加 `session` / `session_replay` / `session_reason` 欄位（additive）
- `ExternalIfcReadyStore`：新增 `recordReviewSession(jobId, sessionId)` method（additive）
- `IfcReadyIntakeJob` type：新增 optional `review_session_id` field（additive）

## 6. Not solved by this change

沿用 archive `2026-05-21-coordinator-ifc-ready-worker-webhook` Non-Goals：

- OQ1 雲端 callback endpoint/auth — 凍結契約緩解，real wiring 待外部平台
- OQ5 SSO — local web view user auth 仍走 LocalDevUserAuthProvider
- Kit/WebRTC/browser visual evidence — Kit build + GPU host 前置；render tier 維持 `not_observed`
- worker payload 補真實 `source_ifc.etag` checksum — 待 worker 端契約升級
- intranet-dev tenant fallback 升級為 production machine identity / mTLS / SSO introspection — 待 AuthProvider 升級
