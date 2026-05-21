## Context

本 change 對應 archive `2026-05-21-coordinator-ifc-ready-worker-webhook` 的 documentation lag，retro-audit（commit `a32fcd6`）已確認 spec drift。本 design 不重新發明 architecture — 沿用 archive design（仍保留於 `openspec/changes/archive/2026-05-21-coordinator-ifc-ready-worker-webhook/design.md`），只把 implementation-level 細節寫清楚，並標出與 archive design 對應的 Decision 編號以便 reviewer 對照。

### Code-level seam mapping

```
external customer-edge IFC Worker
        │
        │ POST /api/external/ifc-ready
        │   { status, ifc_path, project_id, version, task_id }   ← worker compat (NEW branch)
        │   or canonical { event, source_ifc, ... }              ← unchanged
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  bim-review-coordinator/src/app.ts                               │
│                                                                  │
│  ① intake route handler ──────────► normalizeIntakePayload()     │ NEW helper (D9)
│        │                              │                          │
│        │                              ▼                          │
│        │                         canonical ExternalIfcReadyEvent │
│        ▼                                                         │
│  ② ExternalIfcReadyStore.recordIntake(event)  ◄── unchanged      │
│        │                                                         │
│        ▼                                                         │
│  ③ StreamingConversionClient.dispatch(event)  ◄── unchanged      │
│        │                                                         │
│        ▼                                                         │
│  ④ (時間流逝) coordinator pull ingest /                          │
│      /api/internal/conversion-result POST                        │
│        │                                                         │
│        ▼                                                         │
│  ⑤ ingestConversionReport(report)                                │
│      │                                                           │
│      ├─ normalizedStatus="ready"                                 │
│      │    │                                                      │
│      │    ├─ callbackOutbox.enqueue()         ◄── unchanged      │
│      │    │                                                      │
│      │    └─ autoCreateOrActivateSession()    ◄── NEW (D10, parallel)
│      │        │                                                  │
│      │        ├─ chooseReadyUsdc()                               │
│      │        ├─ allocateKitInstanceBindings()                   │
│      │        └─ SessionStore.create() (idempotent by corr_id)   │
│      │                                                           │
│      ├─ normalizedStatus="failed"                                │
│      │    ├─ callbackOutbox.enqueue()                            │
│      │    └─ MUST NOT auto-create streamable session ◄── NEW guard
│      │                                                           │
│      └─ recordConversionOutcome()                                │
└──────────────────────────────────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals**：

- 把 archive 已 ratified 的 11 個 spec scenarios 全部對應到 code path + test。
- 保持 implementation 最小：重用既有 helper / store / kitPool，不新增 runtime service。
- 不破壞 canonical caller — 既有 `event="ifc_ready"` payload 行為不變。
- intake / auto-session / outbox 三條路徑狀態獨立分類；任一失敗不阻塞他者。

**Non-Goals**：

- 不修改 newer specs。
- 不開新 capability。
- 不啟動 / 控制 Kit 進程或開 USD（control-plane only）。
- 不引入 production dependency。
- 不解 OQ1（公司雲端 callback endpoint/auth）/ OQ5（SSO）。
- 不把 `single_kit_render` / WebRTC `49100` / browser visual 升等為 passed。

## Decisions

對照 archive design Decision 編號（D1–D8 沿用），新增 D9–D11 為 implementation-level：

- **D1–D8** — 沿用 archive design `2026-05-21-coordinator-ifc-ready-worker-webhook/design.md` Decisions（input normalization at coordinator boundary、status=="ifc_ready" only、field mapping、header-first idempotency、不轉送 raw worker payload 到 streaming、ready branch 觸發 session、reuse existing session-create logic、idempotency by correlation/model_version）；不重述。
- **D9** — `normalizeIntakePayload(rawBody): ExternalIfcReadyEvent` 抽為 module-local helper；canonical payload 直接 pass-through，worker compatibility 才走 mapping。
   - Rationale：避免在 route handler 內塞 branching；helper 單元測試獨立。
- **D10** — `autoCreateOrActivateSession(correlationId, externalModelVersionId, conversionJobId, artifacts)` 抽為 module-local helper；與既有 `POST /api/review-sessions` route handler 共用 `SessionStore.create` + `allocateKitInstanceBindings` + `chooseReadyUsdc`。
   - Rationale：避免兩條 session 建立路徑漂移；route handler 仍走原 path 不變。
- **D11** — Idempotency key 採 `correlation_id || external_model_version_id`（先 correlation_id，缺則退 model_version_id），與既有 `ExternalIfcReadyStore` 對應。重入回既有 session 而非新建。
   - Rationale：對應 spec scenario「Duplicate conversion-ready does not create duplicate sessions」。

## Risks / Trade-offs

沿用 archive design 全部 risks（worker `version` 對應、`task_id` global uniqueness、`source_ifc.etag` 缺、intranet-dev tenant fallback、auto-session vs explicit caller 競爭、GPU 無容量 `queued_for_instance`、誤讀「轉檔好就有畫面」、`_bim-control` 主詞）。新增 implementation-level risks：

- [Risk] `autoCreateOrActivateSession` 抽 helper 時若不慎把 `SessionStore.create` 內的 lifecycle event emission 改路徑，可能漏發 audit event。
   - Mitigation：tests 斷言 lifecycle audit event 仍與 explicit caller 路徑等價（reuse 既有 `session-lifecycle.test.ts` pattern）。
- [Risk] Worker payload 大量重送（task retry storm）時，`ExternalIfcReadyStore` 與 `SessionStore` idempotency 都要靠 correlation_id；若兩 store idempotency window 不一致，可能造成 store-A 認為 dup、store-B 認為 new。
   - Mitigation：apply 階段加 unit test 覆蓋同一 task_id 短時間重送 N 次的不變式（exactly one job + exactly one session）。
- [Risk] Spec 已 ratified，code 落後超過數日，期間 `ExternalIfcReadyStore` / `SessionStore` 內部 API 可能已隨其他 change 漂移（例：PR #76 stabilize 改 viewer artifact flow）。
   - Mitigation：apply 啟動先跑 GitNexus impact analysis，列出所有 affected symbols 的當前 signature，必要時調整 D10 helper 簽名。

## Verification strategy

- Apply 啟動先跑 `npx gitnexus impact --symbol ingestConversionReport --symbol SessionStore.create --symbol allocateKitInstanceBindings`，HIGH/CRITICAL 先回報。
- 對應 spec scenarios 的 unit/contract tests 必須先寫（RED）再實作（GREEN）。
- 跑 `cd bim-review-coordinator && npm run verify` 全綠（tsc + vitest）為 commit gate。
- 跑 `python -m pytest tests -p no:cacheprovider` 為 root contract baseline check。
- Render tier 不跑 — 維持 `not_observed`（與 archive Decision 一致；memory `kit-gpu-render-needs-windows-native`）。
- GitNexus detect-changes 用 `git diff --stat` 作 fallback（memory `opsx-worktree-closeout-gotchas`）。

## Open Questions

無 — 全部 architectural decisions 已凍結於 archive design。本 change 只負責把它真的寫進 code。
